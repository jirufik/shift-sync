import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePdf } from '../src/modules/recognition/parsers/ortec-pdf.parser';
import { PdfService } from '../src/modules/recognition/pdf.service';
import { validatePdfDay } from '../src/modules/recognition/validation/pdf-gate';
import type { Expected } from './fixtures/ground-truth';
import { recognizeFixture } from './fixtures/ground-truth';
import { loadOcrFixture } from './fixtures/load-fixture';

/**
 * Регрессия на собственных образцах — настоящих снимках и выгрузках, которые
 * в репозиторий не попадают (`private/` в `.gitignore`). Без этой папки тесты
 * пропускаются; основная проверка идёт на синтетике из `samples/`.
 *
 *   private/samples/ess/ocr.json        выдача OCR (`tools/ocr-bench/run.mjs <каталог> <файл>`)
 *   private/samples/ess/expected.json   { groundTruth: {дата: Expected}, fallbackDates: [...] }
 *   private/samples/pdf/*.pdf           выгрузки; разбор сверяется со снимком
 *                                       `<имя>.expected.json` рядом, первый прогон его создаёт
 */
const ROOT = join(__dirname, '../../../private/samples');
const ESS = join(ROOT, 'ess');
const PDF = join(ROOT, 'pdf');

const hasEss = existsSync(join(ESS, 'ocr.json')) && existsSync(join(ESS, 'expected.json'));
const pdfFiles = existsSync(PDF) ? readdirSync(PDF).filter((f) => f.endsWith('.pdf')).sort() : [];

describe.skipIf(!hasEss)('свои снимки экрана', () => {
  const { groundTruth, fallbackDates } = hasEss
    ? (JSON.parse(readFileSync(join(ESS, 'expected.json'), 'utf8')) as {
        groundTruth: Record<string, Expected>;
        fallbackDates?: string[];
      })
    : { groundTruth: {}, fallbackDates: [] };
  const byDate = hasEss ? recognizeFixture(loadOcrFixture(join(ESS, 'ocr.json'))) : new Map();

  it('распознанные дни совпадают с эталоном', () => {
    const got = Object.fromEntries(
      Object.keys(groundTruth).map((date) => {
        const row = byDate.get(date);
        if (!row) return [date, null];
        return [date, row.kind === 'shift' ? { kind: row.kind, startsAt: row.startsAt, endsAt: row.endsAt } : { kind: row.kind }];
      }),
    );
    expect(got).toEqual(groundTruth);
  });

  it('смены проходят шлюз, служебные метки — нет', () => {
    for (const [date, expected] of Object.entries(groundTruth)) {
      const row = byDate.get(date);
      if (expected.kind === 'shift') expect(row?.ok, date).toBe(true);
      if (expected.kind === 'non_work_marker') expect(row?.ok, date).toBe(false);
    }
  });

  it.skipIf(!fallbackDates)('время из заголовка карточки взято там же, где раньше', () => {
    const fallback = [...byDate.values()].filter((r) => r.usedFallback).map((r) => r.workDate);
    expect(fallback.sort()).toEqual(fallbackDates);
  });
});

class TestPdfService extends PdfService {
  protected override async lib() {
    return import('mupdf');
  }
}

describe.skipIf(pdfFiles.length === 0)('свои PDF-выгрузки', () => {
  const pdf = new TestPdfService();

  for (const file of pdfFiles) {
    it(`${file}: разбор не изменился`, async () => {
      const parsed = parsePdf(await pdf.readPages(readFileSync(join(PDF, file))));
      const rows = parsed.days.flatMap(validatePdfDay).map((r) => ({
        workDate: r.workDate,
        kind: r.kind,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        ok: r.ok,
        usedFallback: r.usedFallback,
      }));
      const snapshot = { publishedUntil: parsed.publishedUntil, periodText: parsed.periodText, rows };
      await expect(JSON.stringify(snapshot, null, 2) + '\n').toMatchFileSnapshot(
        join(PDF, file.replace(/\.pdf$/, '.expected.json')),
      );
    }, 30_000);
  }
});
