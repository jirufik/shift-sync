import { parseScreenshot } from '../../src/modules/recognition/parsers/ortec-ess.parser';
import type { OcrPage } from '../../src/modules/recognition/types';
import { validateBlock, type ValidatedRow } from '../../src/modules/recognition/validation/validation-gate';

/**
 * Эталон для синтетических снимков `samples/ess/` — девять дней марта 2027 из
 * выдуманного графика `tools/samples/schedule.mjs`. Человек, магазин и смены
 * не существуют.
 */
export type Expected =
  | { kind: 'shift'; startsAt: string; endsAt: string }
  | { kind: 'no_shift' }
  | { kind: 'non_work_marker' };

export const GROUND_TRUTH: Record<string, Expected> = {
  '2027-03-07': { kind: 'shift', startsAt: '07:00', endsAt: '14:00' },
  '2027-03-08': { kind: 'shift', startsAt: '10:00', endsAt: '16:30' },
  '2027-03-09': { kind: 'shift', startsAt: '09:00', endsAt: '17:00' },
  '2027-03-10': { kind: 'no_shift' },
  // TES V, 01:00–01:01 — служебная метка, сменой не является
  '2027-03-11': { kind: 'non_work_marker' },
  '2027-03-12': { kind: 'shift', startsAt: '08:30', endsAt: '15:00' },
  '2027-03-13': { kind: 'shift', startsAt: '12:00', endsAt: '20:00' },
  '2027-03-14': { kind: 'no_shift' },
  '2027-03-15': { kind: 'shift', startsAt: '07:00', endsAt: '14:00' },
};

/** Дни, где OCR потерял одно из значений левой колонки и время взято из заголовка. */
export const FALLBACK_DATES = ['2027-03-08', '2027-03-12', '2027-03-13'];

/**
 * Разбор всех кадров и склейка по датам — то же, что делает сервис.
 * Год есть только в шапке месяца; если её не прочитали — берётся из соседнего кадра.
 */
export function recognizeFixture(pages: OcrPage[]): Map<string, ValidatedRow> {
  const parsed = pages.map(parseScreenshot);
  const fallbackYear = parsed.find((p) => p.month)?.month?.year ?? new Date().getFullYear();
  const rows = parsed.flatMap((p) => p.blocks.map((b) => validateBlock(b, p.month?.year ?? fallbackYear)));

  const byDate = new Map<string, ValidatedRow>();
  for (const row of rows) {
    if (!row.workDate) continue;
    // при дублях между кадрами оставляем прошедший шлюз
    const prev = byDate.get(row.workDate);
    if (!prev || (!prev.ok && row.ok)) byDate.set(row.workDate, row);
  }
  return byDate;
}
