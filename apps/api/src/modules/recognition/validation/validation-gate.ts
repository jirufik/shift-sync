import { message, type Message, type RowChecks, type RowKind } from '@fc/contracts';

import { isoWeekday, isRealDate, minutesToTime, toIsoDate } from '../../../common/time.util';
import { WEEKDAYS } from '../vocabulary/finnish';
import type { ParsedDayBlock } from '../parsers/ortec-ess.parser';

/** Смена короче этого — не смена, а служебная метка вроде `TES V` на одну минуту. */
export const MIN_SHIFT_MINUTES = 15;
/** Смена длиннее этого — почти наверняка ошибка разбора. */
export const MAX_SHIFT_MINUTES = 16 * 60;

export interface ValidatedRow {
  kind: RowKind;
  workDate: string | null;
  /** как прочиталось название дня недели; в PDF его нет */
  weekdayText: string | null;
  startsAt: string | null;
  endsAt: string | null;
  label: string | null;
  location: string | null;
  durationText: string | null;
  isClipped: boolean;
  confidence: number;
  checks: RowChecks;
  /** сколько независимых источников времени участвовало */
  sources: number;
  /** время взято из кода смены, потому что колонка со временем неполная */
  usedFallback: boolean;
  ok: boolean;
  reason: Message | null;
}

const EMPTY_CHECKS: RowChecks = {
  weekday: false,
  timesAgree: null,
  duration: null,
  sane: false,
  notClipped: true,
};

/**
 * Шлюз валидации — то, что делает систему честной.
 *
 * Мы не полагаемся на то, что распозналось верно: одна и та же смена закодирована
 * на экране трижды (левая колонка, заголовок карточки, строка Vuoroaika), плюс
 * рядом с числом стоит день недели. Шлюз сверяет эти независимые сигналы между
 * собой и отбраковывает всё, что не сошлось. Это работает офлайн, ничего не стоит
 * и ловит ошибку любой модели распознавания.
 */
export function validateBlock(block: ParsedDayBlock, yearHint: number): ValidatedRow {
  const { header } = block;
  const monthIndex = header.monthIndex;
  const checks: RowChecks = { ...EMPTY_CHECKS };

  const base = {
    weekdayText: header.rawText,
    label: block.label,
    location: block.location,
    durationText: block.durationText,
    isClipped: block.clipped,
    confidence: block.confidence,
  };

  // дата вообще существует?
  if (!isRealDate(yearHint, monthIndex, header.day)) {
    return {
      ...base,
      kind: 'unparsed',
      workDate: null,
      startsAt: null,
      endsAt: null,
      checks,
      sources: 0,
      usedFallback: false,
      ok: false,
      reason: message('msg.date-not-real', {
        day: header.day,
        weekday: WEEKDAYS[header.weekdayIndex],
      }),
    };
  }

  const workDate = toIsoDate(yearHint, monthIndex, header.day);

  // ── проверка 1: день недели против реального календаря ────────────────────
  const realWeekday = isoWeekday(yearHint, monthIndex, header.day);
  checks.weekday = realWeekday === header.weekdayIndex;

  // «смены нет» — самостоятельное утверждение, времени у него не бывает
  if (block.noShift) {
    checks.sane = true;
    checks.notClipped = !block.clipped;
    const ok = checks.weekday === true && checks.notClipped;
    return {
      ...base,
      kind: 'no_shift',
      workDate,
      startsAt: null,
      endsAt: null,
      checks,
      sources: 1,
      usedFallback: false,
      ok,
      reason: ok ? null : weekdayReason(checks, header.weekdayIndex, realWeekday),
    };
  }

  // ── источники времени ─────────────────────────────────────────────────────
  const fromColumn =
    block.columnTimes.length >= 2
      ? {
          startMin: block.columnTimes[0],
          endMin: block.columnTimes[block.columnTimes.length - 1],
        }
      : null;
  const fromTitle = block.titleRange;

  // ── проверка 2: колонка против заголовка карточки ─────────────────────────
  checks.timesAgree =
    fromColumn && fromTitle
      ? fromColumn.startMin === fromTitle.startMin && fromColumn.endMin === fromTitle.endMin
      : null;

  const source = fromColumn ?? fromTitle;
  if (!source) {
    checks.notClipped = !block.clipped;
    return {
      ...base,
      kind: 'unparsed',
      workDate,
      startsAt: null,
      endsAt: null,
      checks,
      sources: 0,
      usedFallback: false,
      ok: false,
      reason: message(block.clipped ? 'msg.clipped' : 'msg.no-times'),
    };
  }

  const durationMin = source.endMin - source.startMin;

  // ── проверка 3: длительность против Vuoroaika ─────────────────────────────
  checks.duration = block.vuoroaikaMin === null ? null : durationMin === block.vuoroaikaMin;

  // ── проверка 4: длительность в разумных пределах ──────────────────────────
  checks.sane = durationMin >= MIN_SHIFT_MINUTES && durationMin <= MAX_SHIFT_MINUTES;

  // ── проверка 5: карточка не обрезана ──────────────────────────────────────
  checks.notClipped = !block.clipped;

  const sources =
    (fromColumn ? 1 : 0) + (fromTitle ? 1 : 0) + (block.vuoroaikaMin !== null ? 1 : 0);

  const kind: RowKind = checks.sane ? 'shift' : 'non_work_marker';
  const hardOk = checks.weekday === true && checks.sane && checks.notClipped;
  const softOk = [checks.timesAgree, checks.duration].every((v) => v === null || v === true);
  const ok = hardOk && softOk;

  return {
    ...base,
    kind,
    workDate,
    startsAt: minutesToTime(source.startMin),
    endsAt: minutesToTime(source.endMin),
    checks,
    sources,
    usedFallback: !fromColumn,
    ok,
    reason: ok
      ? null
      : failureReason(checks, {
          header,
          realWeekday,
          durationMin,
          vuoroaikaMin: block.vuoroaikaMin,
        }),
  };
}

function weekdayReason(checks: RowChecks, claimed: number, real: number): Message | null {
  if (!checks.weekday) {
    return message('msg.weekday-mismatch', {
      claimed: WEEKDAYS[claimed],
      real: WEEKDAYS[real],
    });
  }
  if (!checks.notClipped) return message('msg.clipped');
  return null;
}

/**
 * Причина отбраковки — одна, самая веская из непройденных проверок.
 *
 * Раньше несовпадения склеивались в одну фразу через «;». С кодами так нельзя,
 * да и не нужно: человеку в ревью хватает решающей причины, чтобы снять
 * галочку, а полная картина никуда не делась — все проверки лежат рядом в
 * `checks` как есть, без слов.
 *
 * Порядок — по тому, насколько проверка обесценивает строку: не тот день
 * недели значит, что дата прочитана неверно, и остальное уже неважно.
 */
function failureReason(
  checks: RowChecks,
  ctx: {
    header: ParsedDayBlock['header'];
    realWeekday: number;
    durationMin: number;
    vuoroaikaMin: number | null;
  },
): Message {
  if (!checks.weekday) {
    return message('msg.weekday-mismatch', {
      claimed: WEEKDAYS[ctx.header.weekdayIndex],
      real: WEEKDAYS[ctx.realWeekday],
    });
  }
  if (!checks.notClipped) return message('msg.clipped');
  if (!checks.sane) {
    return message(
      ctx.durationMin < MIN_SHIFT_MINUTES ? 'msg.duration-too-short' : 'msg.duration-too-long',
      { duration: ctx.durationMin },
    );
  }
  if (checks.timesAgree === false) return message('msg.times-disagree');
  if (checks.duration === false) {
    return message('msg.duration-mismatch', {
      duration: ctx.durationMin,
      expected: ctx.vuoroaikaMin ?? 0,
    });
  }
  return message('msg.not-validated');
}
