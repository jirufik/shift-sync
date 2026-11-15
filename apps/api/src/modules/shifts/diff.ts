import { message, type DiffAction, type DiffEntryDto, type DiffPlanDto, type Message } from '@fc/contracts';

/** Строка, прошедшая распознавание и шлюз, приведённая к минимуму нужных полей. */
export interface RecognizedInput {
  rowId: string;
  workDate: string;
  kind: 'shift' | 'no_shift' | 'non_work_marker' | 'unparsed';
  startsAt: string | null;
  endsAt: string | null;
  label: string | null;
  ok: boolean;
  reason: Message | null;
  /** порядковый номер кадра — только для сообщений о конфликте */
  screenshotOrder: number;
}

/** Смена, которая уже есть в базе (и, соответственно, в календаре). */
export interface CurrentShift {
  id: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
}

export type UpdateStrategy = 'update' | 'recreate';

export interface MergedDay {
  workDate: string;
  /** что предлагается видеть в календаре на эту дату */
  desired: Array<{ rowId: string; startsAt: string; endsAt: string; label: string | null }>;
  /** дата явно помечена как выходная («Sinulla ei ole työvuoroa») */
  explicitNoShift: boolean;
  /** строки, не прошедшие шлюз или отброшенные как служебные */
  rejected: RecognizedInput[];
  /** кадры противоречат друг другу по этой дате */
  conflict: Message | null;
}

const key = (s: { startsAt: string; endsAt: string }): string => `${s.startsAt}-${s.endsAt}`;

/**
 * Склейка строк из нескольких кадров в одно состояние на дату.
 *
 * Кадры сняты прокруткой одного списка и перекрываются, поэтому одна дата
 * попадает в два файла. Совпадающие записи схлопываются, расходящиеся —
 * помечаются конфликтом и не применяются молча: порядок кадров задаёт
 * пользователь, и «побеждает последний» здесь было бы произволом.
 */
export function mergeRecognized(rows: RecognizedInput[]): MergedDay[] {
  const byDate = new Map<string, RecognizedInput[]>();
  for (const row of rows) {
    if (!row.workDate) continue;
    const list = byDate.get(row.workDate);
    if (list) list.push(row);
    else byDate.set(row.workDate, [row]);
  }

  const days: MergedDay[] = [];
  for (const [workDate, group] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const accepted = group.filter(
      (r): r is RecognizedInput & { startsAt: string; endsAt: string } =>
        r.ok && r.kind === 'shift' && r.startsAt !== null && r.endsAt !== null,
    );
    // Уверенно опознанное отсутствие — отпуск, выходной по коллективному
    // договору — утверждает про дату ровно то же, что фраза «смены нет» на
    // экране: события на эту дату быть не должно. Разбор скриншотов ставит
    // `non_work_marker` иначе, от неудачной проверки длительности, и такая
    // строка сюда не попадает — у неё `ok` всегда ложь.
    const noShiftRows = group.filter(
      (r) => r.ok && (r.kind === 'no_shift' || r.kind === 'non_work_marker'),
    );
    const rejected = group.filter(
      (r) => !r.ok || r.kind === 'non_work_marker' || r.kind === 'unparsed',
    );

    // Что каждый кадр утверждает про эту дату: набор смен, возможно пустой.
    // Две разные смены в ОДНОМ кадре — это сплит-смена, а не противоречие;
    // противоречие возможно только между РАЗНЫМИ кадрами.
    const claims = new Map<number, Map<string, (typeof accepted)[number]>>();
    const claimOf = (order: number) => {
      let m = claims.get(order);
      if (!m) {
        m = new Map();
        claims.set(order, m);
      }
      return m;
    };
    for (const row of accepted) claimOf(row.screenshotOrder).set(key(row), row);
    for (const row of noShiftRows) claimOf(row.screenshotOrder);

    const signatures = new Map<string, Map<string, (typeof accepted)[number]>>();
    for (const claim of claims.values()) {
      signatures.set([...claim.keys()].sort().join('|'), claim);
    }

    let conflict: Message | null = null;
    if (signatures.size > 1) {
      // варианты собираются из времён, а не из слов: подставить их в готовую
      // фразу можно на любом языке. Пустой набор — «смены нет» — обозначается
      // прочерком, и словарь этот прочерк поясняет
      const shown = [...signatures.keys()].map((s) => (s === '' ? '—' : s.split('|').join(', ')));
      conflict = message('msg.frames-disagree', { variants: shown.join(' / ') });
    }

    const agreed = signatures.size === 1 ? [...signatures.values()][0] : new Map();

    days.push({
      workDate,
      desired: conflict
        ? []
        : [...agreed.values()].map((r) => ({
            rowId: r.rowId,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            label: r.label,
          })),
      explicitNoShift: !conflict && agreed.size === 0 && noShiftRows.length > 0,
      rejected,
      conflict,
    });
  }
  return days;
}

/**
 * План изменений.
 *
 * Ключевое ограничение: трогаются **только те даты, которые явно присутствуют
 * в загруженных кадрах**. Даты, которых в пачке нет, не изменяются никогда —
 * иначе загрузка одного кадра снесла бы весь остальной месяц.
 */
export function buildDiffPlan(
  days: MergedDay[],
  current: CurrentShift[],
  strategy: UpdateStrategy,
): DiffPlanDto {
  const currentByDate = new Map<string, CurrentShift[]>();
  for (const shift of current) {
    const list = currentByDate.get(shift.workDate);
    if (list) list.push(shift);
    else currentByDate.set(shift.workDate, [shift]);
  }

  const entries: DiffEntryDto[] = [];

  for (const day of days) {
    const existing = currentByDate.get(day.workDate) ?? [];

    // конфликт между кадрами — ничего не делаем, показываем человеку
    if (day.conflict) {
      entries.push({
        workDate: day.workDate,
        action: 'skip_invalid',
        before: existing[0]
          ? { startsAt: existing[0].startsAt, endsAt: existing[0].endsAt, shiftId: existing[0].id }
          : null,
        after: null,
        rowId: null,
        reason: day.conflict,
        needsAttention: true,
      });
      continue;
    }

    // строки, не попавшие в календарь, показываем отдельными записями.
    // Внимания требуют только те, что не прошли шлюз: отпуск и служебная
    // метка опознаны уверенно, и помечать их тревожным цветом значило бы
    // звать человека туда, где всё в порядке.
    for (const rejected of day.rejected) {
      entries.push({
        workDate: day.workDate,
        action: 'skip_invalid',
        before: null,
        after:
          rejected.startsAt && rejected.endsAt
            ? { startsAt: rejected.startsAt, endsAt: rejected.endsAt, label: rejected.label }
            : null,
        rowId: rejected.rowId,
        reason: rejected.reason ?? message('msg.not-validated'),
        needsAttention: !rejected.ok,
      });
    }

    // ── обновление на месте, когда на дате ровно одна смена с обеих сторон ──
    if (strategy === 'update' && day.desired.length === 1 && existing.length === 1) {
      const want = day.desired[0];
      const have = existing[0];
      if (have.startsAt === want.startsAt && have.endsAt === want.endsAt) {
        entries.push({
          workDate: day.workDate,
          action: 'skip_identical',
          before: { startsAt: have.startsAt, endsAt: have.endsAt, shiftId: have.id },
          after: { startsAt: want.startsAt, endsAt: want.endsAt, label: want.label },
          rowId: want.rowId,
          reason: null,
          needsAttention: false,
        });
      } else {
        entries.push({
          workDate: day.workDate,
          action: 'update',
          before: { startsAt: have.startsAt, endsAt: have.endsAt, shiftId: have.id },
          after: { startsAt: want.startsAt, endsAt: want.endsAt, label: want.label },
          rowId: want.rowId,
          reason: null,
          needsAttention: false,
        });
      }
      continue;
    }

    // ── общий случай: разность множеств по паре (начало, конец) ─────────────
    const desiredKeys = new Set(day.desired.map(key));
    const existingKeys = new Set(existing.map(key));

    for (const want of day.desired) {
      if (existingKeys.has(key(want))) {
        const have = existing.find((e) => key(e) === key(want))!;
        entries.push({
          workDate: day.workDate,
          action: 'skip_identical',
          before: { startsAt: have.startsAt, endsAt: have.endsAt, shiftId: have.id },
          after: { startsAt: want.startsAt, endsAt: want.endsAt, label: want.label },
          rowId: want.rowId,
          reason: null,
          needsAttention: false,
        });
      } else {
        entries.push({
          workDate: day.workDate,
          action: 'create',
          before: null,
          after: { startsAt: want.startsAt, endsAt: want.endsAt, label: want.label },
          rowId: want.rowId,
          reason: null,
          needsAttention: false,
        });
      }
    }

    for (const have of existing) {
      if (desiredKeys.has(key(have))) continue;
      entries.push({
        workDate: day.workDate,
        action: 'delete',
        before: { startsAt: have.startsAt, endsAt: have.endsAt, shiftId: have.id },
        after: null,
        rowId: null,
        reason: message(day.explicitNoShift ? 'msg.explicit-no-shift' : 'msg.shift-replaced'),
        needsAttention: false,
      });
    }
  }

  return { entries, summary: summarize(entries) };
}

function summarize(entries: DiffEntryDto[]): DiffPlanDto['summary'] {
  const summary = {
    create: 0,
    update: 0,
    delete: 0,
    skip_identical: 0,
    skip_invalid: 0,
    needsAttention: 0,
  } satisfies DiffPlanDto['summary'];

  for (const e of entries) {
    summary[e.action as DiffAction] += 1;
    if (e.needsAttention) summary.needsAttention += 1;
  }
  return summary;
}
