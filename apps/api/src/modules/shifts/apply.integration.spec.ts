import type { MikroORM } from '@mikro-orm/postgresql';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DiffEntryDto } from '@fc/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestOrm } from '../../../test/orm-test';
import { ImportBatch, Shift, SyncLog } from '../../database/entities';
import { ApplyProcess } from './apply.process';
import type { GcalService } from '../gcal/gcal.service';
import type { CalendarShift } from '../gcal/gcal.types';

/** Подставной календарь: записывает вызовы, ничего никуда не отправляет. */
class FakeGcal {
  created: CalendarShift[] = [];
  updated: Array<{ eventId: string; shift: CalendarShift }> = [];
  deleted: string[] = [];
  failNext = false;
  private counter = 0;

  isConfigured = true;

  createEvent(shift: CalendarShift): Promise<string> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('Google недоступен'));
    }
    this.created.push(shift);
    return Promise.resolve(`evt-${++this.counter}`);
  }

  updateEvent(eventId: string, shift: CalendarShift): Promise<string> {
    this.updated.push({ eventId, shift });
    return Promise.resolve(eventId);
  }

  deleteEvent(eventId: string): Promise<void> {
    this.deleted.push(eventId);
    return Promise.resolve();
  }
}

const cfg = {
  get: (key: string) => (key === 'GCAL_TIMEZONE' ? 'Europe/Helsinki' : ''),
} as never;

describe('применение плана в базу и календарь', () => {
  let orm: MikroORM;
  let em: EntityManager;
  let gcal: FakeGcal;
  let apply: ApplyProcess;
  let batch: ImportBatch;

  beforeAll(async () => {
    orm = await createTestOrm();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  beforeEach(async () => {
    await orm.schema.clearDatabase();
    em = orm.em.fork();
    gcal = new FakeGcal();
    apply = new ApplyProcess(em, gcal as unknown as GcalService, cfg);
    batch = em.create(ImportBatch, {
      status: 'applying',
      sourceMonth: '2027-03-01',
      stats: null,
      error: null,
      warnings: [],
      createdAt: new Date(),
      appliedAt: null,
    });
    em.persist(batch);
    await em.flush();
  });

  const entry = (over: Partial<DiffEntryDto>): DiffEntryDto => ({
    workDate: '2027-03-13',
    action: 'create',
    before: null,
    after: { startsAt: '08:00', endsAt: '14:00', label: '410 8-14' },
    rowId: null,
    reason: null,
    needsAttention: false,
    ...over,
  });

  it('создаёт смену в базе и событие в календаре', async () => {
    const result = await apply.apply(batch, [entry({})], new Set(['2027-03-13']));

    expect(result).toMatchObject({ applied: 1, failed: 0 });
    expect(gcal.created).toHaveLength(1);
    expect(gcal.created[0]).toMatchObject({
      workDate: '2027-03-13',
      startsAt: '08:00',
      endsAt: '14:00',
      tz: 'Europe/Helsinki',
    });

    const shifts = await em.fork().find(Shift, {});
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toMatchObject({
      workDate: '2027-03-13',
      startsAt: '08:00',
      endsAt: '14:00',
      syncState: 'synced',
      googleEventId: 'evt-1',
    });
  });

  it('не трогает даты, которых нет в подтверждённом списке', async () => {
    const entries = [entry({}), entry({ workDate: '2027-03-14' })];
    const result = await apply.apply(batch, entries, new Set(['2027-03-13']));

    expect(result.applied).toBe(1);
    const shifts = await em.fork().find(Shift, {});
    expect(shifts.map((s) => s.workDate)).toEqual(['2027-03-13']);
  });

  it('обновляет существующее событие, сохраняя его идентификатор', async () => {
    await apply.apply(batch, [entry({})], new Set(['2027-03-13']));
    const created = await em.fork().findOneOrFail(Shift, { workDate: '2027-03-13' });

    const em2 = orm.em.fork();
    const apply2 = new ApplyProcess(em2, gcal as unknown as GcalService, cfg);
    const batch2 = await em2.findOneOrFail(ImportBatch, { id: batch.id });
    await apply2.apply(
      batch2,
      [
        entry({
          action: 'update',
          before: { startsAt: '08:00', endsAt: '14:00', shiftId: created.id },
          after: { startsAt: '08:00', endsAt: '15:30', label: '410 8-15.30' },
        }),
      ],
      new Set(['2027-03-13']),
    );

    expect(gcal.updated).toHaveLength(1);
    expect(gcal.updated[0].eventId).toBe('evt-1');

    const after = await orm.em.fork().findOneOrFail(Shift, { id: created.id });
    expect(after.endsAt).toBe('15:30');
    expect(after.googleEventId).toBe('evt-1');
  });

  it('удаляет смену и её событие', async () => {
    await apply.apply(batch, [entry({})], new Set(['2027-03-13']));
    const created = await em.fork().findOneOrFail(Shift, { workDate: '2027-03-13' });

    const em2 = orm.em.fork();
    const apply2 = new ApplyProcess(em2, gcal as unknown as GcalService, cfg);
    const batch2 = await em2.findOneOrFail(ImportBatch, { id: batch.id });
    await apply2.apply(
      batch2,
      [
        entry({
          action: 'delete',
          before: { startsAt: '08:00', endsAt: '14:00', shiftId: created.id },
          after: null,
        }),
      ],
      new Set(['2027-03-13']),
    );

    expect(gcal.deleted).toEqual(['evt-1']);
    expect(await orm.em.fork().find(Shift, {})).toHaveLength(0);
  });

  it('при падении календаря смена остаётся в базе со следом об ошибке', async () => {
    gcal.failNext = true;
    const result = await apply.apply(batch, [entry({})], new Set(['2027-03-13']));

    expect(result).toMatchObject({ applied: 0, failed: 1 });
    const shifts = await orm.em.fork().find(Shift, {});
    expect(shifts).toHaveLength(1);
    expect(shifts[0].syncState).toBe('failed');
    // текст от Google своего кода не имеет и едет подстановкой в общую фразу
    expect(shifts[0].syncError).toEqual({
      code: 'msg.google-failed',
      params: { detail: 'Google недоступен' },
    });
    expect(result.entries[0].error).toEqual(shifts[0].syncError);
  });

  it('пишет журнал по каждому действию', async () => {
    await apply.apply(batch, [entry({})], new Set(['2027-03-13']));
    const log = await orm.em.fork().find(SyncLog, {});
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ workDate: '2027-03-13', action: 'create', ok: true });
  });
});
