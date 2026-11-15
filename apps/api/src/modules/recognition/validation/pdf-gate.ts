import { message, type RowChecks, type RowKind } from '@fc/contracts';

import { minutesToTime } from '../../../common/time.util';
import type { PdfDay, PdfShift } from '../parsers/ortec-pdf.parser';
import { isNonWorkActivity } from '../vocabulary/ortec-activities';
import { MAX_SHIFT_MINUTES, MIN_SHIFT_MINUTES, type ValidatedRow } from './validation-gate';

/**
 * Шлюз для PDF.
 *
 * Проверять здесь нужно другое, чем на скриншотах. Текст точный, ошибок чтения
 * не бывает, дата написана целиком вместе с годом — сверять её с днём недели не
 * с чем и незачем. Зато у смены есть независимая расшифровка: строки
 * активностей, из которых она состоит. Их края обязаны сойтись с диапазоном
 * смены — это и есть здешняя перекрёстная проверка.
 *
 * Код смены (`Vuoro`) в проверке НЕ участвует намеренно: в образце 4.4.2027 помечено
 * шаблоном `410 7-14`, а работа идёт 06:45–13:45. Код — имя шаблона, а не
 * расписание, и сверка по нему давала бы ложные отбраковки. Он берётся только
 * тогда, когда колонка со временем пуста, и это отмечается в ревью.
 */

const CHECKS: RowChecks = {
  weekday: null,
  timesAgree: null,
  duration: null,
  sane: false,
  notClipped: true,
};

/** Строки дня: одна на каждую смену, либо одна «смены нет» на пустой день. */
export function validatePdfDay(day: PdfDay): ValidatedRow[] {
  if (day.shifts.length === 0) return [noShiftRow(day)];
  return day.shifts.map((shift) => validateShift(day, shift));
}

function noShiftRow(day: PdfDay): ValidatedRow {
  return {
    kind: 'no_shift',
    workDate: day.workDate,
    weekdayText: null,
    startsAt: null,
    endsAt: null,
    label: null,
    location: day.location,
    durationText: null,
    isClipped: false,
    confidence: 1,
    checks: { ...CHECKS, sane: true },
    sources: 1,
    usedFallback: false,
    ok: true,
    reason: null,
  };
}

function validateShift(day: PdfDay, shift: PdfShift): ValidatedRow {
  const checks: RowChecks = { ...CHECKS };
  const source = shift.range ?? shift.labelRange;

  const base = {
    workDate: day.workDate,
    weekdayText: null,
    label: shift.label,
    location: day.location,
    durationText: describeActivities(shift) || null,
    isClipped: false,
    confidence: 1,
    usedFallback: shift.range === null && shift.labelRange !== null,
    startsAt: source ? minutesToTime(source.startMin) : null,
    endsAt: source ? minutesToTime(source.endMin) : null,
  };

  const sources =
    (shift.range ? 1 : 0) +
    (shift.labelRange ? 1 : 0) +
    (shift.activities.some((a) => a.range) ? 1 : 0);

  // ── отпуск и прочие отсутствия ────────────────────────────────────────────
  // распознаны уверенно: это не сбой разбора, а известный вид строки, поэтому
  // проверка считается пройденной, а в календарь строка всё равно не пойдёт
  const absence = absenceName(shift);
  if (absence) {
    return {
      ...base,
      kind: 'non_work_marker',
      checks: { ...checks, sane: true },
      sources,
      ok: true,
      reason: message('msg.pdf-non-work', { activity: absence }),
    };
  }

  if (!source) {
    return {
      ...base,
      kind: 'unparsed',
      checks,
      sources,
      ok: false,
      reason: message('msg.pdf-no-times'),
    };
  }

  const durationMin = source.endMin - source.startMin;
  checks.sane = durationMin >= MIN_SHIFT_MINUTES && durationMin <= MAX_SHIFT_MINUTES;

  // ── смена против своих активностей ────────────────────────────────────────
  const covered = coverage(shift);
  checks.timesAgree = covered
    ? covered.startMin === source.startMin && covered.endMin === source.endMin
    : null;

  const kind: RowKind = checks.sane ? 'shift' : 'non_work_marker';
  const ok = checks.sane && checks.timesAgree !== false;

  return {
    ...base,
    kind,
    checks,
    sources,
    ok,
    reason: ok ? null : failureReason(checks, durationMin, source, covered),
  };
}

/** Название отсутствия, если вся строка — про отсутствие, а не про работу. */
function absenceName(shift: PdfShift): string | null {
  const names = shift.activities.map((a) => a.name).filter((name) => name.length > 0);
  if (names.length > 0 && names.every(isNonWorkActivity)) return names[0];
  if (shift.label && isNonWorkActivity(shift.label)) return shift.label;
  return null;
}

/** Что накрывают активности смены: от начала первой до конца последней. */
function coverage(shift: PdfShift): { startMin: number; endMin: number } | null {
  const ranges = shift.activities
    .map((a) => a.range)
    .filter((range): range is NonNullable<typeof range> => range !== null);
  if (ranges.length === 0) return null;

  return {
    startMin: Math.min(...ranges.map((r) => r.startMin)),
    endMin: Math.max(...ranges.map((r) => r.endMin)),
  };
}

/** Расшифровка смены по активностям — в том виде, в каком она в отчёте. */
function describeActivities(shift: PdfShift): string {
  return shift.activities
    .map((a) =>
      a.range
        ? `${minutesToTime(a.range.startMin)}–${minutesToTime(a.range.endMin)} ${a.name}`.trim()
        : a.name,
    )
    .filter(Boolean)
    .join(', ');
}

function failureReason(
  checks: RowChecks,
  durationMin: number,
  source: { startMin: number; endMin: number },
  covered: { startMin: number; endMin: number } | null,
): ReturnType<typeof message> {
  if (!checks.sane) {
    return message(
      durationMin < MIN_SHIFT_MINUTES ? 'msg.duration-too-short' : 'msg.duration-too-long',
      { duration: durationMin },
    );
  }
  if (checks.timesAgree === false && covered) {
    return message('msg.pdf-activities-disagree', {
      shift: `${minutesToTime(source.startMin)}–${minutesToTime(source.endMin)}`,
      activities: `${minutesToTime(covered.startMin)}–${minutesToTime(covered.endMin)}`,
    });
  }
  return message('msg.not-validated');
}
