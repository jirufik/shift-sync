import { DomainError } from '../../../common/domain-error';
import { isRealDate, toIsoDate } from '../../../common/time.util';
import type { PdfLine, PdfPageText } from '../types';
import { parseTitleRange, type TimeRange } from './ortec-ess.parser';

/**
 * Разбор выгрузки ORTEC «Henkilön työvuorolista» в PDF.
 *
 * От скриншотов отличается тем, что гадать не приходится: в файле лежит
 * настоящий текстовый слой с точными координатами каждой строки. Поэтому здесь
 * нет ни словаря, ни нечёткого сопоставления — только геометрия таблицы.
 *
 * Устройство отчёта: одна строка на календарный день, слева направо семь
 * колонок. День без смены присутствует в таблице, но с пустыми колонками —
 * это то же утверждение, что фраза «Sinulla ei ole työvuoroa» на экране
 * приложения. У одного дня может быть несколько смен (разрывная смена), у
 * каждой смены — несколько активностей, включая перерыв `Lepoaika`.
 */

/** Заголовки колонок, слева направо. `Alkaen - Asti` встречается дважды. */
const COLUMN_HEADERS = [
  'Päivämäärä', // дата
  'Yksikkö', // место работы
  'Alkaen - Asti', // начало и конец смены
  'Vuoro', // код смены, например `410 8-14`
  'Selite', // примечание
  'Alkaen - Asti', // начало и конец активности
  'Aktiviteetti', // чем занят в этот отрезок
] as const;

/** Индексы колонок, чтобы не считать по пальцам. */
const COL = {
  date: 0,
  unit: 1,
  shiftRange: 2,
  vuoro: 3,
  note: 4,
  activityRange: 5,
  activity: 6,
} as const;

/** Заголовки колонок не всегда лежат ровно на одной высоте: 101 и 104. */
const HEADER_BAND_PT = 6;
/** Строка принадлежит колонке, если начинается не левее её начала минус допуск. */
const COLUMN_SLACK_PT = 2;
/** Строка на той же высоте, что и якорь, должна попасть в его полосу. */
const ROW_SLACK_PT = 1;

const DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
/** Подпись внизу страницы: `5.3.2027 10.12.44`. Ниже неё данных нет. */
const FOOTER_RE = /^\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}\.\d{2}\.\d{2}$/;
const TIME_RANGE_RE = /^(\d{1,2})\.(\d{2})\s*-\s*(\d{1,2})\.(\d{2})$/;
/** `Demo Market: 1.2.2027 asti 5.4.2027 - Julkaistu` */
const PUBLISHED_RE =
  /(\d{1,2}\.\d{1,2}\.\d{4})\s+asti\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*-\s*Julkaistu/i;
/** `Jakso: 1.3.2027 asti 1.4.2027` — запрошенный период, справочно. */
const PERIOD_RE = /^\s*(\d{1,2}\.\d{1,2}\.\d{4}\s+asti\s+\d{1,2}\.\d{1,2}\.\d{4})/;

export interface PdfActivity {
  /** отрезок активности внутри смены */
  range: TimeRange | null;
  /** `1-Kassalinjasto`, `Lepoaika`, `Vuosiloma` */
  name: string;
}

export interface PdfShift {
  /** диапазон из колонки `Alkaen - Asti` — основной источник времени */
  range: TimeRange | null;
  /** код смены из колонки `Vuoro` */
  label: string | null;
  /**
   * Диапазон, закодированный в коде смены.
   *
   * Проверкой служить не может: в образце 4.4.2027 помечено шаблоном `410 7-14`, а
   * работа идёт 06:45–13:45. Код — это имя шаблона, а не расписание. Нужен
   * только как запасной источник, если колонка со временем пуста.
   */
  labelRange: TimeRange | null;
  note: string | null;
  activities: PdfActivity[];
}

export interface PdfDay {
  /** `YYYY-MM-DD` */
  workDate: string;
  /** как записано в отчёте: `8.3.2027` */
  rawDate: string;
  location: string | null;
  /** пустой массив = день есть в таблице, но смены в этот день нет */
  shifts: PdfShift[];
  /** страница, на которой нашлась строка дня */
  pageIndex: number;
}

export interface ParsedPdf {
  days: PdfDay[];
  /**
   * Дата, ДО которой график опубликован, `YYYY-MM-DD`, не включая её саму.
   *
   * Отчёт честно предупреждает: «Shifts in schedules with status plan are not
   * shown». Значит день за этой границей выглядит пустым не потому, что он
   * выходной, а потому, что расписание ещё черновик. Считать его выходным и
   * стирать событие из календаря нельзя.
   */
  publishedUntil: string | null;
  /** `Jakso` из шапки, как написано */
  periodText: string | null;
}

interface Column {
  index: number;
  x: number;
}

/** Колонки берём из строки заголовка: жёстко зашитые координаты пережили бы не всякий отчёт. */
function findColumns(pages: PdfPageText[]): Column[] {
  for (const page of pages) {
    const anchor = page.lines.find((line) => line.text.trim() === 'Aktiviteetti');
    if (!anchor) continue;

    const band = page.lines
      .filter(
        (line) =>
          Math.abs(line.y - anchor.y) <= HEADER_BAND_PT &&
          (COLUMN_HEADERS as readonly string[]).includes(line.text.trim()),
      )
      .sort((a, b) => a.x - b.x);

    if (band.length !== COLUMN_HEADERS.length) continue;
    if (band.some((line, i) => line.text.trim() !== COLUMN_HEADERS[i])) continue;

    return band.map((line, index) => ({ index, x: line.x }));
  }
  return [];
}

function columnOf(columns: Column[], x: number): number {
  let found = -1;
  for (const column of columns) {
    if (x >= column.x - COLUMN_SLACK_PT) found = column.index;
  }
  return found;
}

/**
 * Ячейка, разложенная отчётом на несколько строк, собирается простой склейкой.
 *
 * Перенос внутри ячейки бывает и по слову, и посреди слова, но пробел, на
 * котором произошёл перенос, сохраняется в конце строки (режим
 * `preserve-whitespace` при чтении). Поэтому `410 ` + `Tupakka/k` + `assa`
 * даёт `410 Tupakka/kassa`, а `1-` + `Kassalinjasto` — `1-Kassalinjasto`,
 * и угадывать, был ли там пробел, не нужно.
 */
function joinCell(lines: PdfLine[]): string {
  return lines
    .map((line) => line.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRange(text: string): TimeRange | null {
  const m = TIME_RANGE_RE.exec(text.trim());
  if (!m) return null;

  const startMin = Number(m[1]) * 60 + Number(m[2]);
  const endMin = Number(m[3]) * 60 + Number(m[4]);
  if (startMin >= endMin || endMin > 24 * 60) return null;
  return { startMin, endMin };
}

function isoFromRaw(raw: string): string | null {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!isRealDate(year, month - 1, day)) return null;
  return toIsoDate(year, month - 1, day);
}

/** Позднейшая дата окончания среди опубликованных расписаний. */
function findPublishedUntil(pages: PdfPageText[]): string | null {
  let latest: string | null = null;
  for (const page of pages) {
    for (const line of page.lines) {
      const m = PUBLISHED_RE.exec(line.text);
      if (!m) continue;
      const until = isoFromRaw(m[2]);
      if (until && (latest === null || until > latest)) latest = until;
    }
  }
  return latest;
}

function findPeriodText(pages: PdfPageText[]): string | null {
  const page = pages[0];
  if (!page) return null;

  const label = page.lines.find((line) => line.text.trim().startsWith('Jakso'));
  if (!label) return null;

  const value = page.lines.find(
    (line) => Math.abs(line.y - label.y) <= HEADER_BAND_PT && line.x > label.x && PERIOD_RE.test(line.text),
  );
  return value ? (PERIOD_RE.exec(value.text)?.[1] ?? null) : null;
}

/** Активности отрезка: каждой строке времени — своё название, возможно перенесённое. */
function collectActivities(
  columns: Column[],
  band: PdfLine[],
): PdfActivity[] {
  const anchors = band
    .filter((line) => columnOf(columns, line.x) === COL.activityRange)
    .sort((a, b) => a.y - b.y);
  const names = band
    .filter((line) => columnOf(columns, line.x) === COL.activity)
    .sort((a, b) => a.y - b.y);

  if (anchors.length === 0) {
    const name = joinCell(names);
    return name ? [{ range: null, name }] : [];
  }

  const buckets: PdfLine[][] = anchors.map(() => []);
  for (const line of names) {
    // название прижато к своей строке времени сверху: продолжение перенесённого
    // названия лежит ниже якоря, но выше следующего
    let index = 0;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].y <= line.y + ROW_SLACK_PT) index = i;
    }
    buckets[index].push(line);
  }

  return anchors.map((anchor, i) => ({
    range: parseRange(anchor.text),
    name: joinCell(buckets[i]),
  }));
}

function parseShifts(columns: Column[], band: PdfLine[], bandBottom: number): PdfShift[] {
  const anchors = band
    .filter((line) => columnOf(columns, line.x) === COL.shiftRange)
    .sort((a, b) => a.y - b.y);

  // колонка со временем пуста, но что-то в строке есть: код смены, активности.
  // Одна смена на весь день, время придётся брать из кода — см. `labelRange`
  const starts: number[] =
    anchors.length > 0
      ? anchors.map((a) => a.y)
      : band.length > 0
        ? [Math.min(...band.map((line) => line.y))]
        : [];

  return starts.map((startY, i) => {
    const endY = i + 1 < starts.length ? starts[i + 1] : bandBottom;
    const sub = band.filter((line) => line.y >= startY - ROW_SLACK_PT && line.y < endY - ROW_SLACK_PT);

    const label = joinCell(sub.filter((line) => columnOf(columns, line.x) === COL.vuoro)) || null;
    const note = joinCell(sub.filter((line) => columnOf(columns, line.x) === COL.note)) || null;

    return {
      range: anchors[i] ? parseRange(anchors[i].text) : null,
      label,
      labelRange: label ? parseTitleRange(label) : null,
      note,
      activities: collectActivities(columns, sub),
    };
  });
}

/** Разбор всего документа: строки дней, границы публикации, период из шапки. */
export function parsePdf(pages: PdfPageText[]): ParsedPdf {
  const columns = findColumns(pages);
  if (columns.length === 0) throw new DomainError('err.pdf-not-ortec');

  const days: PdfDay[] = [];

  for (const page of pages) {
    // подпись внизу страницы стоит в колонках даты и кода смены; без этой
    // отсечки `Alihankkijan vuorohistoria` уехало бы в код последней смены
    const footer = page.lines.find((line) => FOOTER_RE.test(line.text.trim()));
    const contentBottom = footer ? footer.y : page.height;

    const dateLines = page.lines
      .filter(
        (line) =>
          columnOf(columns, line.x) === COL.date &&
          line.y < contentBottom &&
          DATE_RE.test(line.text.trim()),
      )
      .sort((a, b) => a.y - b.y);

    for (let i = 0; i < dateLines.length; i++) {
      const rawDate = dateLines[i].text.trim();
      const workDate = isoFromRaw(rawDate);
      if (!workDate) continue;

      const bandTop = dateLines[i].y;
      const bandBottom = i + 1 < dateLines.length ? dateLines[i + 1].y : contentBottom;
      const band = page.lines.filter(
        (line) =>
          line.y >= bandTop - ROW_SLACK_PT &&
          line.y < bandBottom - ROW_SLACK_PT &&
          columnOf(columns, line.x) > COL.date,
      );

      days.push({
        workDate,
        rawDate,
        location: joinCell(band.filter((line) => columnOf(columns, line.x) === COL.unit)) || null,
        shifts: parseShifts(columns, band, bandBottom),
        pageIndex: page.index,
      });
    }
  }

  days.sort((a, b) => a.workDate.localeCompare(b.workDate));

  return {
    days,
    publishedUntil: findPublishedUntil(pages),
    periodText: findPeriodText(pages),
  };
}
