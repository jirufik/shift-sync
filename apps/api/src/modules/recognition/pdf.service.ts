import { Injectable, Logger } from '@nestjs/common';
import type * as MuPdfModule from 'mupdf';

import { DomainError } from '../../common/domain-error';
import type { PdfLine, PdfPageText } from './types';

/**
 * `mupdf` — ESM-only, а backend собирается в CommonJS (D-002). Обычный
 * `await import()` компилятор превратил бы в `require()`, что для ESM-пакета
 * падает с ERR_REQUIRE_ESM. Обёртка через `Function` не даёт компилятору
 * тронуть выражение — тот же приём, что и для OCR, см. D-008.
 */
const esmImport = new Function('specifier', 'return import(specifier)') as <T>(
  specifier: string,
) => Promise<T>;

type MuPdf = typeof MuPdfModule;

/**
 * Во сколько раз страница увеличивается при рендере в картинку для ревью.
 * A4 в двойном масштабе — это 1191×1684 и около 240 КБ PNG: текст читается
 * без увеличения, а вес сопоставим со скриншотом с телефона.
 */
const RENDER_SCALE = 2;

/** Первые байты файла: `%PDF-`. Тип из заголовка запроса присылает клиент. */
const PDF_MAGIC = '%PDF-';

interface StructuredLine {
  bbox: { x: number; y: number; w: number; h: number };
  text: string;
}

interface StructuredBlock {
  lines?: StructuredLine[];
}

/**
 * Чтение PDF: текст с координатами и рендер страниц в картинки.
 *
 * Модуль поднимается лениво и живёт до остановки процесса — это WebAssembly,
 * инициализация стоит заметно дороже одного разбора.
 */
@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private loading: Promise<MuPdf> | null = null;

  /**
   * `protected`, а не `private`, намеренно: функция, собранная через
   * `Function`, создаётся в контексте без обработчика динамического импорта,
   * и под тестовым прогонщиком такой импорт не работает. Тест наследует сервис
   * и подменяет одну эту загрузку обычным `import`, оставляя весь остальной
   * путь — чтение, координаты, отрисовку — настоящим.
   */
  protected async lib(): Promise<MuPdf> {
    this.loading ??= esmImport<MuPdf>('mupdf').catch((error: unknown) => {
      // сбрасываем обещание: иначе единственный сбой загрузки закешируется
      // навсегда и все последующие импорты будут падать без попытки
      this.loading = null;
      throw error;
    });
    return this.loading;
  }

  /** Похож ли буфер на PDF. Заголовку `Content-Type` от клиента доверять нельзя. */
  static looksLikePdf(buffer: Buffer): boolean {
    return buffer.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC;
  }

  /**
   * Весь текст документа со строками и их прямоугольниками.
   *
   * Режим `preserve-whitespace` важен: в узкой ячейке отчёт переносит текст
   * посреди слова (`410 ` + `Tupakka/k` + `assa`), и пробел, на котором
   * произошёл перенос, сохраняется в конце строки. Благодаря этому ячейка
   * собирается обратно простой склейкой, без догадок о том, был ли там пробел.
   */
  async readPages(buffer: Buffer): Promise<PdfPageText[]> {
    const started = Date.now();
    try {
      const mupdf = await this.lib();
      const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
      const pages: PdfPageText[] = [];

      for (let index = 0; index < doc.countPages(); index++) {
        const page = doc.loadPage(index);
        const [x0, y0, x1, y1] = page.getBounds();
        const structured = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON()) as {
          blocks: StructuredBlock[];
        };

        const lines: PdfLine[] = [];
        for (const block of structured.blocks) {
          for (const line of block.lines ?? []) {
            if (!line.text) continue;
            lines.push({
              text: line.text,
              x: line.bbox.x,
              right: line.bbox.x + line.bbox.w,
              y: line.bbox.y,
              height: line.bbox.h,
            });
          }
        }
        lines.sort((a, b) => a.y - b.y || a.x - b.x);

        pages.push({ index, width: x1 - x0, height: y1 - y0, lines });
      }

      this.logger.debug(`PDF прочитан: ${pages.length} страниц за ${Date.now() - started} мс`);
      return pages;
    } catch (error) {
      this.logger.error(`Чтение PDF не удалось: ${describe(error)}`);
      throw new DomainError('err.pdf-unreadable', { detail: describe(error) });
    }
  }

  /**
   * Каждая страница — в PNG. Ревью показывает их там же, где кадры со
   * скриншотов: экран проверки не должен зависеть от того, чем загрузили.
   */
  async renderPages(buffer: Buffer): Promise<Buffer[]> {
    const started = Date.now();
    try {
      const mupdf = await this.lib();
      const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
      const images: Buffer[] = [];

      for (let index = 0; index < doc.countPages(); index++) {
        const pixmap = doc
          .loadPage(index)
          .toPixmap(
            mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE),
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
        images.push(Buffer.from(pixmap.asPNG()));
      }

      this.logger.debug(`PDF отрисован: ${images.length} страниц за ${Date.now() - started} мс`);
      return images;
    } catch (error) {
      this.logger.error(`Отрисовка PDF не удалась: ${describe(error)}`);
      throw new DomainError('err.pdf-unreadable', { detail: describe(error) });
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
