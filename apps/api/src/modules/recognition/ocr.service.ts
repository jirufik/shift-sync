import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { PaddleOcrService as PaddleOcrServiceType } from 'ppu-paddle-ocr';

import { retry } from '../../common/retry.util';
import { AppConfigService } from '../../config/app-config.service';
import type { OcrBox, OcrItem, OcrPage } from './types';

/**
 * `ppu-paddle-ocr` — ESM-only, а backend собирается в CommonJS (D-002).
 * Обычный `await import()` компилятор TypeScript превратил бы в `require()`,
 * что для ESM-пакета падает с ERR_REQUIRE_ESM. Обёртка через `Function`
 * не даёт компилятору тронуть выражение — см. D-008.
 */
const esmImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

type PaddleModule = typeof import('ppu-paddle-ocr');

/** Текстоподобный бокс: вытянутый по горизонтали и достаточно высокий. */
function isTextLike(box: OcrBox): boolean {
  return box.width / box.height >= 3 && box.height >= 14;
}

@Injectable()
export class OcrService implements OnModuleDestroy {
  private readonly logger = new Logger(OcrService.name);
  private service: PaddleOcrServiceType | null = null;
  private initializing: Promise<PaddleOcrServiceType> | null = null;

  constructor(private readonly cfg: AppConfigService) {}

  /**
   * Модель поднимается лениво и живёт до остановки процесса: инициализация
   * стоит около секунды, а держать её в памяти между импортами дешевле,
   * чем платить эту секунду на каждый кадр.
   */
  private async getService(): Promise<PaddleOcrServiceType> {
    if (this.service) return this.service;
    this.initializing ??= this.initialize();
    this.service = await this.initializing;
    return this.service;
  }

  private async initialize(): Promise<PaddleOcrServiceType> {
    const started = Date.now();
    try {
      const mod = await esmImport<PaddleModule>('ppu-paddle-ocr');
      const service = new mod.PaddleOcrService({
        model: mod.V5_LATIN_MOBILE_MODEL,
        detection: { maxSideLength: this.cfg.get('OCR_MAX_SIDE_LENGTH') },
      });

      // при первом запуске веса (~15 МБ) скачиваются из сети — единственное
      // место, где сервис зависит от интернета, и единственное, где повтор
      // имеет смысл: само распознавание потом полностью локально
      await retry(() => service.initialize(), {
        label: 'загрузка весов PP-OCRv5',
        attempts: 3,
        baseDelayMs: 1_000,
        onRetry: (error, attempt, delayMs) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Загрузка весов: попытка ${attempt} не удалась (${message}), повтор через ${delayMs} мс`,
          );
        },
      });

      this.logger.log(`PP-OCRv5 (latin mobile) готов за ${Date.now() - started} мс`);
      return service;
    } catch (error) {
      // сбрасываем обещание, иначе неудачная инициализация закешируется
      // навсегда и все последующие импорты будут падать без попытки
      this.initializing = null;
      this.logger.error(
        `Инициализация PP-OCRv5 не удалась: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Распознавание кадра с добором.
   *
   * Основной батч-проход изредка возвращает пустоту для бокса, который детекция
   * нашла: на проверочных кадрах так потерялся заголовок `torstai, syyskuuta 10`,
   * при том что тот же кроп поодиночке читается с уверенностью 0.99. Поэтому
   * текстоподобные боксы без результата до-распознаются по одному. Без этого
   * шага на исходных данных получалось 8/9 вместо 9/9.
   */
  async recognize(image: Buffer, width: number, height: number): Promise<OcrPage> {
    const started = Date.now();
    const service = await this.getService();
    const buffer = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;

    const [detection, recognition] = await Promise.all([
      service.detect(buffer, { crop: true }),
      service.recognize(buffer, { flatten: true }),
    ]);

    const primary: OcrItem[] = ('results' in recognition ? recognition.results : [])
      .filter((r) => r.text.trim().length > 0)
      .map((r) => ({
        text: r.text,
        box: { x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height },
        confidence: r.confidence,
        salvaged: false,
      }));

    const covered = (box: OcrBox): boolean =>
      primary.some(
        (r) => Math.abs(r.box.y - box.y) < 12 && Math.abs(r.box.x - box.x) < 20,
      );

    const salvaged: OcrItem[] = [];
    if (detection.crops) {
      for (let i = 0; i < detection.boxes.length; i++) {
        const box = detection.boxes[i];
        if (covered(box) || !isTextLike(box)) continue;

        const crop = detection.crops[i];
        if (!crop) continue;

        const result = await service.recognize(crop, { flatten: true });
        const items = 'results' in result ? result.results : [];
        for (const item of items) {
          if (!item.text.trim()) continue;
          salvaged.push({
            text: item.text,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            confidence: item.confidence,
            salvaged: true,
          });
        }
      }
    }

    const items = [...primary, ...salvaged].sort(
      (a, b) => a.box.y - b.box.y || a.box.x - b.box.x,
    );

    return {
      items,
      width,
      height,
      salvagedCount: salvaged.length,
      durationMs: Date.now() - started,
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.service) {
      await this.service.destroy();
      this.service = null;
      this.initializing = null;
    }
  }
}
