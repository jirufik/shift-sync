import { message } from '@fc/contracts';
import { describe, expect, it } from 'vitest';

import { buildDiffPlan, mergeRecognized, type CurrentShift, type RecognizedInput } from './diff';

function row(over: Partial<RecognizedInput> = {}): RecognizedInput {
  return {
    rowId: 'r1',
    workDate: '2027-03-13',
    kind: 'shift',
    startsAt: '08:00',
    endsAt: '14:00',
    label: '410 8-14',
    ok: true,
    reason: null,
    screenshotOrder: 0,
    ...over,
  };
}

const shift = (over: Partial<CurrentShift> = {}): CurrentShift => ({
  id: 's1',
  workDate: '2027-03-13',
  startsAt: '08:00',
  endsAt: '14:00',
  ...over,
});

const plan = (rows: RecognizedInput[], current: CurrentShift[], strategy: 'update' | 'recreate' = 'update') =>
  buildDiffPlan(mergeRecognized(rows), current, strategy);

describe('правила из постановки', () => {
  it('графика на дату нет → создать', () => {
    const { entries, summary } = plan([row()], []);
    expect(summary.create).toBe(1);
    expect(entries[0]).toMatchObject({
      workDate: '2027-03-13',
      action: 'create',
      before: null,
      after: { startsAt: '08:00', endsAt: '14:00' },
    });
  });

  it('график есть и время совпадает → ничего не менять', () => {
    const { summary } = plan([row()], [shift()]);
    expect(summary).toMatchObject({ skip_identical: 1, create: 0, update: 0, delete: 0 });
  });

  it('график есть, время не совпадает → обновить на месте', () => {
    const { entries, summary } = plan([row({ endsAt: '15:30' })], [shift()]);
    expect(summary.update).toBe(1);
    expect(entries[0]).toMatchObject({
      action: 'update',
      before: { startsAt: '08:00', endsAt: '14:00', shiftId: 's1' },
      after: { startsAt: '08:00', endsAt: '15:30' },
    });
  });

  it('та же ситуация со стратегией recreate → удалить и создать', () => {
    const { summary } = plan([row({ endsAt: '15:30' })], [shift()], 'recreate');
    expect(summary).toMatchObject({ delete: 1, create: 1, update: 0 });
  });

  it('«Sinulla ei ole työvuoroa» → удалить смену на эту дату', () => {
    const rows = [row({ kind: 'no_shift', startsAt: null, endsAt: null, label: null })];
    const { entries, summary } = plan(rows, [shift()]);
    expect(summary.delete).toBe(1);
    expect(entries[0].reason).toEqual(message('msg.explicit-no-shift'));
  });

  it('«смены нет» и в базе пусто → вообще ничего', () => {
    const rows = [row({ kind: 'no_shift', startsAt: null, endsAt: null })];
    expect(plan(rows, []).entries).toHaveLength(0);
  });
});

describe('область действия импорта', () => {
  it('даты, которых нет в кадрах, не трогаются', () => {
    const current = [
      shift({ id: 'keep-1', workDate: '2027-03-01' }),
      shift({ id: 'keep-2', workDate: '2027-03-20' }),
      shift({ id: 's1', workDate: '2027-03-13' }),
    ];
    const { entries } = plan([row()], current);
    expect(entries.map((e) => e.workDate)).toEqual(['2027-03-13']);
  });
});

describe('служебные записи и брак', () => {
  it('TES V не попадает в календарь и требует внимания', () => {
    const rows = [
      row({
        kind: 'non_work_marker',
        startsAt: '01:00',
        endsAt: '01:01',
        label: 'TES V',
        ok: false,
        reason: message('msg.duration-too-short', { duration: 1 }),
      }),
    ];
    const { entries, summary } = plan(rows, []);
    expect(summary).toMatchObject({ create: 0, skip_invalid: 1, needsAttention: 1 });
    expect(entries[0].needsAttention).toBe(true);
  });

  it('строка, не прошедшая шлюз, не применяется', () => {
    const rows = [row({ ok: false, reason: message('msg.weekday-mismatch', { claimed: 'maanantai', real: 'tiistai' }) })];
    const { summary } = plan(rows, []);
    expect(summary.create).toBe(0);
    expect(summary.needsAttention).toBe(1);
  });
});

describe('перекрытие кадров', () => {
  it('одинаковые записи из двух кадров схлопываются в одну', () => {
    const rows = [row({ rowId: 'a', screenshotOrder: 0 }), row({ rowId: 'b', screenshotOrder: 1 })];
    const { summary } = plan(rows, []);
    expect(summary.create).toBe(1);
  });

  it('противоречие между кадрами не применяется молча', () => {
    const rows = [
      row({ rowId: 'a', screenshotOrder: 0 }),
      row({ rowId: 'b', endsAt: '15:30', screenshotOrder: 1 }),
    ];
    const { entries, summary } = plan(rows, []);
    expect(summary).toMatchObject({ create: 0, update: 0, skip_invalid: 1, needsAttention: 1 });
    expect(entries[0].reason?.code).toBe('msg.frames-disagree');
  });

  it('смена в одном кадре и «смены нет» в другом — тоже противоречие', () => {
    const rows = [
      row({ rowId: 'a', screenshotOrder: 0 }),
      row({ rowId: 'b', kind: 'no_shift', startsAt: null, endsAt: null, screenshotOrder: 1 }),
    ];
    const { entries } = plan(rows, [shift()]);
    expect(entries[0]).toMatchObject({ action: 'skip_invalid', needsAttention: true });
  });
});

describe('несколько смен в один день', () => {
  it('разность множеств: одну оставить, одну создать, одну удалить', () => {
    // обе смены пришли из одного кадра — это сплит-смена, а не противоречие
    const rows = [
      row({ rowId: 'a', startsAt: '08:00', endsAt: '12:00', screenshotOrder: 0 }),
      row({ rowId: 'b', startsAt: '16:00', endsAt: '20:00', screenshotOrder: 0 }),
    ];
    const current = [
      shift({ id: 'keep', startsAt: '08:00', endsAt: '12:00' }),
      shift({ id: 'gone', startsAt: '13:00', endsAt: '15:00' }),
    ];
    const { summary } = plan(rows, current);
    expect(summary).toMatchObject({ skip_identical: 1, create: 1, delete: 1, update: 0 });
  });
});
