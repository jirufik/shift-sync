import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { minutesToTime } from '../../common/time.util';
import { mergeRecognized, buildDiffPlan, type RecognizedInput } from '../shifts/diff';
import { parsePdf, type ParsedPdf, type PdfDay } from './parsers/ortec-pdf.parser';
import { PdfService } from './pdf.service';
import { lastPublishedDay, splitByPublication } from './recognition.service';
import { validatePdfDay } from './validation/pdf-gate';
import type { ValidatedRow } from './validation/validation-gate';

/**
 * Разбор идёт по самим PDF из `samples/pdf`, а не по сохранённому слепку, как у
 * скриншотов: у PDF нет ни модели, ни сети, ни случайности — чтение файла
 * быстрое и повторяемое, и проверять полезнее весь путь целиком, вместе с
 * чтением текстового слоя.
 *
 * Выгрузки синтетические (`tools/samples/make-pdf.mjs`): геометрия настоящего
 * отчёта ORTEC, выдуманные человек, магазин и смены.
 */
const SAMPLES = join(__dirname, '../../../../../samples/pdf');

/**
 * Загрузка модуля подменена: `new Function('return import(s)')` в рантайме
 * теста не работает, потому что у такой функции нет обработчика динамического
 * импорта. Всё остальное — настоящее: тот же сервис, те же файлы.
 */
class TestPdfService extends PdfService {
  protected override async lib() {
    return import('mupdf');
  }
}

const pdf = new TestPdfService();
let march: ParsedPdf;
let april: ParsedPdf;

async function parse(file: string): Promise<ParsedPdf> {
  return parsePdf(await pdf.readPages(readFileSync(join(SAMPLES, file))));
}

beforeAll(async () => {
  march = await parse('report-2027-03.pdf');
  april = await parse('report-2027-04.pdf');
}, 30_000);

const dayOf = (parsed: ParsedPdf, workDate: string): PdfDay => {
  const day = parsed.days.find((d) => d.workDate === workDate);
  if (!day) throw new Error(`нет дня ${workDate}`);
  return day;
};

const range = (r: { startMin: number; endMin: number } | null): string | null =>
  r ? `${minutesToTime(r.startMin)}–${minutesToTime(r.endMin)}` : null;

describe('разбор PDF-выгрузки ORTEC', () => {
  it('читает весь период подряд, вместе с пустыми днями', () => {
    expect(march.days).toHaveLength(31);
    expect(march.days[0].workDate).toBe('2027-03-01');
    expect(march.days.at(-1)?.workDate).toBe('2027-03-31');

    // выходные присутствуют в таблице как строки без смены — это утверждение,
    // а не пропуск, и на нём держится удаление отменённой смены
    const empty = march.days.filter((d) => d.shifts.length === 0).map((d) => d.workDate);
    expect(empty).toEqual([
      '2027-03-05',
      '2027-03-06',
      '2027-03-10',
      '2027-03-14',
      '2027-03-19',
      '2027-03-21',
      '2027-03-26',
      '2027-03-27',
    ]);
  });

  it('продолжает читать на второй странице, где шапки таблицы уже нет', () => {
    const last = dayOf(march, '2027-03-31');
    expect(last.pageIndex).toBe(1);
    expect(range(last.shifts[0].range)).toBe('06:00–13:00');
  });

  it('подпись внизу страницы не уезжает в код смены', () => {
    // `Alihankkijan vuorohistoria` стоит ровно в колонке `Vuoro`
    expect(dayOf(march, '2027-03-31').shifts[0].label).toBe('410 Tupakka/kassa');
  });

  it('собирает обратно ячейку, разорванную переносом', () => {
    // `410 ` + `Tupakka/k` + `assa` — перенос посреди слова и по пробелу сразу
    expect(dayOf(march, '2027-03-07').shifts[0].label).toBe('410 Tupakka/kassa');
    // `410 10-` + `16.30` — перенос после дефиса, пробела там быть не должно
    expect(dayOf(march, '2027-03-08').shifts[0].label).toBe('410 10-16.30');
    expect(dayOf(march, '2027-03-12').shifts[0].label).toBe('410 8.30-15');
  });

  it('читает активности смены вместе с перерывом', () => {
    const shift = dayOf(march, '2027-03-09').shifts[0];
    expect(shift.activities.map((a) => `${range(a.range)} ${a.name}`)).toEqual([
      '09:00–12:30 1-Kassalinjasto',
      '12:30–13:00 Lepoaika',
      '13:00–17:00 1-Kassalinjasto',
    ]);
  });

  it('время берёт из колонки, а не из кода смены', () => {
    // 4 апреля помечено шаблоном `410 7-14`, а работа идёт 06:45–13:45
    const shift = dayOf(april, '2027-04-04').shifts[0];
    expect(shift.label).toBe('410 7-14');
    expect(range(shift.labelRange)).toBe('07:00–14:00');
    expect(range(shift.range)).toBe('06:45–13:45');
  });

  it('читает место работы и границу публикации из шапки', () => {
    expect(dayOf(march, '2027-03-13').location).toBe('Demo Market');
    expect(march.publishedUntil).toBe('2027-04-05');
    expect(april.publishedUntil).toBe('2027-04-05');
    expect(march.periodText).toBe('1.3.2027 asti 1.4.2027');
  });
});

describe('шлюз для PDF', () => {
  const rowsOf = (parsed: ParsedPdf): ValidatedRow[] => parsed.days.flatMap(validatePdfDay);

  it('раскладывает март на смены, отсутствия и выходные', () => {
    const rows = rowsOf(march);
    const byKind = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => r.workDate);

    expect(byKind('shift')).toHaveLength(15);
    expect(byKind('no_shift')).toHaveLength(8);
    expect(byKind('non_work_marker')).toEqual([
      '2027-03-01',
      '2027-03-02',
      '2027-03-03',
      '2027-03-04',
      '2027-03-11',
      '2027-03-16',
      '2027-03-24',
      '2027-03-25',
    ]);
    expect(rows.filter((r) => r.kind === 'unparsed')).toEqual([]);
  });

  it('отпуск опознан уверенно: проверка пройдена, но в календарь он не пойдёт', () => {
    const [row] = validatePdfDay(dayOf(march, '2027-03-01'));
    expect(row.kind).toBe('non_work_marker');
    // строка прочитана верно — это не сбой разбора, и внимания она не требует
    expect(row.ok).toBe(true);
    expect(row.reason).toEqual({ code: 'msg.pdf-non-work', params: { activity: 'Vuosiloma' } });
    // время остаётся видимым в ревью, чтобы было понятно, о какой строке речь
    expect([row.startsAt, row.endsAt]).toEqual(['09:00', '15:00']);
  });

  it('служебная метка TES V тоже опознана, а не отбракована по длительности', () => {
    const [row] = validatePdfDay(dayOf(march, '2027-03-11'));
    expect(row.kind).toBe('non_work_marker');
    expect(row.ok).toBe(true);
    expect(row.reason?.params?.activity).toBe('TES V');
  });

  it('сверяет смену с её активностями, а код смены в проверке не участвует', () => {
    const [row] = validatePdfDay(dayOf(april, '2027-04-04'));
    expect(row.kind).toBe('shift');
    expect(row.ok).toBe(true);
    expect(row.checks.timesAgree).toBe(true);
    // дня недели в отчёте нет — проверку выполнять не на чем
    expect(row.checks.weekday).toBeNull();
    expect([row.startsAt, row.endsAt]).toEqual(['06:45', '13:45']);
  });

  it('ловит смену, края которой не сходятся с активностями', () => {
    const day = structuredClone(dayOf(march, '2027-03-18'));
    day.shifts[0].activities[0].range = { startMin: 9 * 60, endMin: 14 * 60 };

    const [row] = validatePdfDay(day);
    expect(row.ok).toBe(false);
    expect(row.checks.timesAgree).toBe(false);
    expect(row.reason?.code).toBe('msg.pdf-activities-disagree');
  });

  it('берёт время из кода смены, когда колонка пуста, и помечает это', () => {
    const day = structuredClone(dayOf(march, '2027-03-18'));
    day.shifts[0].range = null;
    day.shifts[0].activities = [];

    const [row] = validatePdfDay(day);
    expect(row.usedFallback).toBe(true);
    expect([row.startsAt, row.endsAt]).toEqual(['08:00', '14:00']);
    expect(row.ok).toBe(true);
  });
});

describe('граница опубликованного графика', () => {
  const day = (workDate: string): PdfDay => ({
    workDate,
    rawDate: workDate,
    location: null,
    shifts: [],
    pageIndex: 0,
  });

  it('`asti` не включает названную дату: опубликован день накануне', () => {
    expect(lastPublishedDay('2027-04-05')).toBe('2027-04-04');
    expect(lastPublishedDay('2026-01-01')).toBe('2025-12-31');
  });

  it('дни за границей откладываются, а не считаются выходными', () => {
    const { kept, skipped } = splitByPublication(
      [day('2027-04-04'), day('2027-04-05'), day('2027-04-06')],
      '2027-04-05',
    );
    expect(kept.map((d) => d.workDate)).toEqual(['2027-04-04']);
    expect(skipped.map((d) => d.workDate)).toEqual(['2027-04-05', '2027-04-06']);
  });

  it('без прочитанной границы ничего не откладывается', () => {
    const { kept, skipped } = splitByPublication([day('2027-04-06')], null);
    expect(kept).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });

  it('на выгрузках, снятых до границы, она ничего не режет', () => {
    expect(splitByPublication(march.days, march.publishedUntil).skipped).toEqual([]);
    expect(splitByPublication(april.days, april.publishedUntil).skipped).toEqual([]);
  });
});

describe('план изменений по PDF', () => {
  const toInputs = (rows: ValidatedRow[]): RecognizedInput[] =>
    rows.map((row, i) => ({
      rowId: `row-${i}`,
      workDate: row.workDate ?? '',
      kind: row.kind,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      label: row.label,
      ok: row.ok,
      reason: row.reason,
      screenshotOrder: 0,
    }));

  const planFor = (parsed: ParsedPdf, current: Array<[string, string, string]>) =>
    buildDiffPlan(
      mergeRecognized(toInputs(parsed.days.flatMap(validatePdfDay))),
      current.map(([workDate, startsAt, endsAt], i) => ({
        id: `shift-${i}`,
        workDate,
        startsAt,
        endsAt,
      })),
      'update',
    );

  it('на пустом календаре предлагает создать все пятнадцать смен', () => {
    const plan = planFor(march, []);
    expect(plan.summary.create).toBe(15);
    expect(plan.summary.update).toBe(0);
    expect(plan.summary.delete).toBe(0);
  });

  it('уже записанные смены не трогает, остальные добавляет', () => {
    const plan = planFor(march, [
      ['2027-03-07', '07:00', '14:00'],
      ['2027-03-08', '10:00', '16:30'],
      ['2027-03-09', '09:00', '17:00'],
      ['2027-03-12', '08:30', '15:00'],
      ['2027-03-13', '12:00', '20:00'],
      ['2027-03-15', '07:00', '14:00'],
      ['2027-03-17', '11:00', '18:00'],
    ]);
    expect(plan.summary.skip_identical).toBe(7);
    expect(plan.summary.create).toBe(8);
    expect(plan.summary.delete).toBe(0);
  });

  it('изменившееся время обновляет на месте', () => {
    const plan = planFor(march, [['2027-03-18', '08:00', '16:00']]);
    const entry = plan.entries.find((e) => e.workDate === '2027-03-18' && e.action === 'update');
    expect(entry?.before).toMatchObject({ startsAt: '08:00', endsAt: '16:00' });
    expect(entry?.after).toMatchObject({ startsAt: '08:00', endsAt: '14:00' });
  });

  it('отменённую смену удаляет — и на выходном, и на дне отпуска', () => {
    const plan = planFor(march, [
      ['2027-03-05', '08:00', '14:00'], // день в отчёте пуст
      ['2027-03-01', '08:00', '14:00'], // день отпуска
    ]);
    const deletions = plan.entries.filter((e) => e.action === 'delete');
    expect(deletions.map((e) => e.workDate).sort()).toEqual(['2027-03-01', '2027-03-05']);
    for (const entry of deletions) {
      expect(entry.reason?.code).toBe('msg.explicit-no-shift');
    }
  });

  it('отпуск и служебные метки видны в плане, но внимания не требуют', () => {
    const plan = planFor(march, []);
    const skipped = plan.entries.filter((e) => e.action === 'skip_invalid');

    expect(skipped).toHaveLength(8);
    expect(plan.summary.needsAttention).toBe(0);
    expect(skipped.every((e) => e.reason?.code === 'msg.pdf-non-work')).toBe(true);
  });
});
