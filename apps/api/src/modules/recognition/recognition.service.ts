import { Injectable, Logger } from '@nestjs/common';
import { message, type Message } from '@fc/contracts';

import { parseScreenshot } from './parsers/ortec-ess.parser';
import { parsePdf, type PdfDay } from './parsers/ortec-pdf.parser';
import { OcrService } from './ocr.service';
import { PdfService } from './pdf.service';
import { validateBlock, type ValidatedRow } from './validation/validation-gate';
import { validatePdfDay } from './validation/pdf-gate';

/** Снимок экрана: читается моделью. */
export interface ImageInput {
  id: string;
  buffer: Buffer;
  width: number;
  height: number;
  orderIndex: number;
}

/** Страница PDF, за которой закреплён свой кадр в ревью. */
export interface PdfPageRef {
  screenshotId: string;
  pageIndex: number;
  orderIndex: number;
}

/** PDF целиком: шапка с границей публикации лежит на первой странице, строки идут дальше. */
export interface PdfInput {
  buffer: Buffer;
  pages: PdfPageRef[];
}

export interface RecognitionInput {
  images: ImageInput[];
  pdfs: PdfInput[];
}

export interface RecognizedScreenshot {
  screenshotId: string;
  rows: ValidatedRow[];
  /** «syyskuuta 2026» из шапки, если она попала в кадр; в PDF год есть в каждой строке */
  month: { monthIndex: number; year: number } | null;
  salvagedCount: number;
  durationMs: number;
}

export interface RecognitionResult {
  screenshots: RecognizedScreenshot[];
  /** месяц, определённый по всей пачке */
  sourceMonth: string | null;
  /** что разбор решил сам и о чём человеку стоит знать перед проверкой дат */
  warnings: Message[];
}

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(
    private readonly ocr: OcrService,
    private readonly pdf: PdfService,
  ) {}

  async recognizeBatch(input: RecognitionInput): Promise<RecognitionResult> {
    const warnings: Message[] = [];
    const screenshots: RecognizedScreenshot[] = [];

    const pdfDates: string[] = [];
    for (const document of input.pdfs) {
      const pages = await this.recognizePdf(document, warnings, pdfDates);
      screenshots.push(...pages);
    }

    const images = await this.recognizeImages(input.images, warnings);
    screenshots.push(...images.screenshots);

    // Месяц импорта. У PDF он точный — год написан в каждой строке; у
    // скриншотов берётся из шапки списка, а её может не быть в кадре.
    const sourceMonth =
      pdfDates.length > 0
        ? `${pdfDates.sort()[0].slice(0, 7)}-01`
        : images.header
          ? `${String(images.header.year).padStart(4, '0')}-${String(images.header.monthIndex + 1).padStart(2, '0')}-01`
          : null;

    screenshots.sort((a, b) => a.screenshotId.localeCompare(b.screenshotId));

    const total = screenshots.reduce((n, s) => n + s.rows.length, 0);
    const passed = screenshots.reduce((n, s) => n + s.rows.filter((r) => r.ok).length, 0);
    this.logger.log(`Распознано строк: ${total}, прошли шлюз: ${passed}`);

    return { screenshots, sourceMonth, warnings };
  }

  // ── PDF ───────────────────────────────────────────────────────────────────

  /**
   * Разбор одной выгрузки.
   *
   * Единица разбора — документ, а не страница: граница публикации написана в
   * шапке первой страницы, а строки дней продолжаются на следующих, где шапки
   * таблицы уже нет.
   */
  private async recognizePdf(
    document: PdfInput,
    warnings: Message[],
    collectedDates: string[],
  ): Promise<RecognizedScreenshot[]> {
    const started = Date.now();
    const pages = await this.pdf.readPages(document.buffer);
    const parsed = parsePdf(pages);

    const { kept, skipped } = splitByPublication(parsed.days, parsed.publishedUntil);

    // День за границей публикации выглядит пустым не потому, что он выходной,
    // а потому, что расписание ещё черновик — отчёт сам об этом предупреждает.
    // Стереть по нему событие из календаря значило бы поверить пустоте.
    if (skipped.length > 0 && parsed.publishedUntil) {
      warnings.push(
        message('msg.pdf-unpublished-skipped', {
          date: lastPublishedDay(parsed.publishedUntil),
          count: skipped.length,
        }),
      );
      this.logger.warn(
        `PDF: ${skipped.length} дней после ${parsed.publishedUntil} пропущены — график не опубликован`,
      );
    }
    if (parsed.publishedUntil === null) {
      warnings.push(message('msg.pdf-no-boundary'));
      this.logger.warn('PDF: в шапке не нашлось строки «Julkaistu», границу публикации не проверить');
    }

    for (const day of kept) collectedDates.push(day.workDate);

    const byPage = new Map<number, PdfDay[]>();
    for (const day of kept) {
      const list = byPage.get(day.pageIndex);
      if (list) list.push(day);
      else byPage.set(day.pageIndex, [day]);
    }

    const durationMs = Date.now() - started;
    this.logger.debug(
      `PDF: ${pages.length} страниц, ${parsed.days.length} дней (${kept.length} в работе), ${durationMs} мс`,
    );

    return document.pages.map((ref) => ({
      screenshotId: ref.screenshotId,
      rows: (byPage.get(ref.pageIndex) ?? []).flatMap(validatePdfDay),
      month: null,
      salvagedCount: 0,
      durationMs,
    }));
  }

  // ── скриншоты ─────────────────────────────────────────────────────────────

  private async recognizeImages(
    inputs: ImageInput[],
    warnings: Message[],
  ): Promise<{
    screenshots: RecognizedScreenshot[];
    header: { monthIndex: number; year: number } | null;
  }> {
    if (inputs.length === 0) return { screenshots: [], header: null };

    const ordered = [...inputs].sort((a, b) => a.orderIndex - b.orderIndex);
    const pages: Array<{
      input: ImageInput;
      parsed: ReturnType<typeof parseScreenshot>;
      salvagedCount: number;
      durationMs: number;
    }> = [];

    for (const input of ordered) {
      const page = await this.ocr.recognize(input.buffer, input.width, input.height);
      const parsed = parseScreenshot(page);
      pages.push({
        input,
        parsed,
        salvagedCount: page.salvagedCount,
        durationMs: page.durationMs,
      });
      this.logger.debug(
        `Кадр ${input.orderIndex}: ${page.items.length} боксов (добор ${page.salvagedCount}), ` +
          `${parsed.blocks.length} блоков дней, ${page.durationMs} мс`,
      );
    }

    // Год есть только в шапке списка. Если она не попала ни в один кадр,
    // берём текущий — при загрузке свежего графика это верно.
    const headers = pages
      .map((p) => p.parsed.month)
      .filter((m): m is NonNullable<typeof m> => m !== null);
    const header = headers[0] ?? null;
    const year = header?.year ?? new Date().getUTCFullYear();

    // Догадка про год — не мелочь: ошибка в нём сдвигает весь импорт на год.
    // Поэтому она едет человеку в ревью, а не только в журнал сервера.
    if (!header) {
      warnings.push(message('msg.year-guessed', { year }));
      this.logger.warn(`Шапка с месяцем не найдена ни в одном кадре, год взят текущий (${year})`);
    }

    return {
      header,
      screenshots: pages.map((p) => ({
        screenshotId: p.input.id,
        month: p.parsed.month,
        salvagedCount: p.salvagedCount,
        durationMs: p.durationMs,
        rows: p.parsed.blocks.map((block) => validateBlock(block, year)),
      })),
    };
  }
}

/** Дни за границей публикации откладываются в сторону, а не считаются выходными. */
export function splitByPublication(
  days: PdfDay[],
  publishedUntil: string | null,
): { kept: PdfDay[]; skipped: PdfDay[] } {
  if (!publishedUntil) return { kept: days, skipped: [] };
  return {
    kept: days.filter((day) => day.workDate < publishedUntil),
    skipped: days.filter((day) => day.workDate >= publishedUntil),
  };
}

/** `asti` в отчёте не включает названную дату: опубликован день накануне. */
export function lastPublishedDay(publishedUntil: string): string {
  const date = new Date(`${publishedUntil}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
