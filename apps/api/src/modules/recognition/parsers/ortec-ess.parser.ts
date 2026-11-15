import { minutesToTime } from '../../../common/time.util';
import { isNoShiftPhrase, matchVocab, MONTHS, WEEKDAYS } from '../vocabulary/finnish';
import type { OcrItem, OcrPage } from '../types';

/** Шапка списка: «syyskuuta 2026». Единственное место, откуда берётся год. */
export interface MonthHeader {
  monthIndex: number;
  year: number;
}

/** Заголовок дня: «sunnuntai, syyskuuta 13». */
export interface DayHeader {
  weekdayIndex: number;
  monthIndex: number;
  day: number;
  /** как прочиталось, до сопоставления со словарём */
  rawText: string;
  /** суммарное расстояние Левенштейна по дню недели и месяцу */
  distance: number;
  y: number;
  height: number;
}

export interface TimeRange {
  startMin: number;
  endMin: number;
}

/** Блок одного дня: заголовок и всё, что под ним до следующего заголовка. */
export interface ParsedDayBlock {
  header: DayHeader;
  /** времена из левой колонки карточки, сверху вниз */
  columnTimes: number[];
  /** диапазон, закодированный в заголовке карточки: «410 8.30-15.30» */
  titleRange: TimeRange | null;
  /** заголовок карточки целиком */
  label: string | null;
  /** «Demo Market» */
  location: string | null;
  /** «Vuoroaika: 6 h, Työaika: 6 h» как прочитано */
  durationText: string | null;
  /** длительность из Vuoroaika в минутах */
  vuoroaikaMin: number | null;
  /** найдена фраза «смены нет» */
  noShift: boolean;
  /** карточка обрезана нижней кромкой кадра — данные заведомо неполные */
  clipped: boolean;
  /** средняя уверенность OCR по боксам блока */
  confidence: number;
  items: OcrItem[];
}

export interface ParsedScreenshot {
  month: MonthHeader | null;
  blocks: ParsedDayBlock[];
}

const TIME_RE = /^(\d{1,2})[:.](\d{2})$/;
const MONTH_HEADER_RE = /([A-Za-zÄÖÅäöå]+kuuta)\s+(\d{4})/;
const TITLE_RANGE_RE = /(\d{1,2})(?:[.:](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[.:](\d{2}))?\s*$/;
const VUOROAIKA_RE = /vuoroaika/i;
const LOCATION_RE = /^[A-Za-zÄÖÅäöå][A-Za-zÄÖÅäöå\s.'-]{3,}$/;

/** Левая колонка карточки: времена начала и конца. Всё правее — содержимое. */
const LEFT_COLUMN_MAX_X = 140;
/** Насколько близко к нижней кромке блок считается обрезанным. */
const CLIP_MARGIN_PX = 24;

export function parseMonthHeader(text: string): MonthHeader | null {
  const m = MONTH_HEADER_RE.exec(text);
  if (!m) return null;
  const month = matchVocab(m[1], MONTHS);
  if (!month) return null;
  const year = Number(m[2]);
  if (year < 2000 || year > 2100) return null;
  return { monthIndex: month.index, year };
}

export function parseDayHeader(text: string): Omit<DayHeader, 'y' | 'height'> | null {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  if (parts.length < 3) return null;

  const weekday = matchVocab(parts[0], WEEKDAYS);
  const month = matchVocab(parts[1], MONTHS);
  if (!weekday || !month) return null;

  const day = Number.parseInt(parts[2], 10);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;

  return {
    weekdayIndex: weekday.index,
    monthIndex: month.index,
    day,
    rawText: text,
    distance: weekday.distance + month.distance,
  };
}

/**
 * Диапазон из заголовка карточки. OCR регулярно слипает код смены с временем
 * (`410 9-15.30` → `4109-15.30`), поэтому якоримся на конец строки.
 */
export function parseTitleRange(text: string): TimeRange | null {
  const m = TITLE_RANGE_RE.exec(text);
  if (!m) return null;

  const startMin = Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  const endMin = Number(m[3]) * 60 + (m[4] ? Number(m[4]) : 0);
  if (startMin >= endMin || endMin > 24 * 60) return null;
  return { startMin, endMin };
}

/**
 * Длительность из `Vuoroaika`.
 *
 * Ловушка: в строке `Vuoroaika: 8 h, Työaika: 7 h ja 30 min` наивный разбор
 * приплюсует `30 min` из Työaika и получит 8 ч 30 мин вместо 8 ч. Сегмент
 * обязательно режется по запятой и по слову Työaika.
 */
export function parseVuoroaika(text: string): number | null {
  if (!VUOROAIKA_RE.test(text)) return null;

  const afterLabel = text.split(/vuoroaika\s*:?/i)[1] ?? '';
  const segment = afterLabel.split(/[,;]|ty[oö]aika/i)[0];

  const hours = /(\d+)\s*h/i.exec(segment);
  const mins = /(\d+)\s*min/i.exec(segment);
  if (!hours && !mins) return null;

  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

function parseColumnTime(item: OcrItem): number | null {
  if (item.box.x > LEFT_COLUMN_MAX_X) return null;
  const m = TIME_RE.exec(item.text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Разбор одного скриншота в блоки по дням. */
export function parseScreenshot(page: OcrPage): ParsedScreenshot {
  const items = [...page.items].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);

  let month: MonthHeader | null = null;
  for (const item of items) {
    const parsed = parseMonthHeader(item.text);
    if (parsed) {
      month = parsed;
      break;
    }
  }

  const headers: DayHeader[] = [];
  for (const item of items) {
    const parsed = parseDayHeader(item.text);
    if (parsed) headers.push({ ...parsed, y: item.box.y, height: item.box.height });
  }
  headers.sort((a, b) => a.y - b.y);

  const blocks: ParsedDayBlock[] = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const yFrom = header.y + header.height;
    const yTo = i + 1 < headers.length ? headers[i + 1].y : page.height;

    const band = items.filter((it) => it.box.y >= yFrom - 4 && it.box.y < yTo - 4);

    const columnTimes = band
      .map((it) => ({ minutes: parseColumnTime(it), y: it.box.y }))
      .filter((t): t is { minutes: number; y: number } => t.minutes !== null)
      .sort((a, b) => a.y - b.y)
      .map((t) => t.minutes);

    let titleRange: TimeRange | null = null;
    let label: string | null = null;
    let location: string | null = null;
    let durationText: string | null = null;
    let vuoroaikaMin: number | null = null;
    let noShift = false;

    for (const it of band) {
      const text = it.text.trim();
      if (isNoShiftPhrase(text)) {
        noShift = true;
        continue;
      }
      if (VUOROAIKA_RE.test(text)) {
        durationText ??= text;
        vuoroaikaMin ??= parseVuoroaika(text);
        continue;
      }
      if (it.box.x <= LEFT_COLUMN_MAX_X) continue;

      if (!titleRange) {
        const range = parseTitleRange(text);
        if (range) {
          titleRange = range;
          label = text;
          continue;
        }
      }
      // первый осмысленный текст правее колонки, не заголовок и не длительность
      if (!label && text.length > 3 && !TIME_RE.test(text)) {
        label = text;
        continue;
      }
      if (!location && LOCATION_RE.test(text)) location = text;
    }

    const hasAnyContent = band.length > 0;
    const clipped =
      yTo >= page.height - CLIP_MARGIN_PX &&
      hasAnyContent &&
      columnTimes.length < 2 &&
      !noShift &&
      !titleRange;

    const confidence = band.length
      ? band.reduce((sum, it) => sum + it.confidence, 0) / band.length
      : 0;

    blocks.push({
      header,
      columnTimes,
      titleRange,
      label,
      location,
      durationText,
      vuoroaikaMin,
      noShift,
      clipped,
      confidence,
      items: band,
    });
  }

  return { month, blocks };
}

/** Для отладки: краткое человекочитаемое представление блока. */
export function describeBlock(block: ParsedDayBlock): string {
  const times = block.columnTimes.map(minutesToTime).join('/');
  return `${block.header.rawText} · колонка=[${times}] · заголовок=${block.label ?? '—'} · vuoroaika=${block.vuoroaikaMin ?? '—'}`;
}
