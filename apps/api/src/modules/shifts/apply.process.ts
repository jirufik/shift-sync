import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import { message, type ApplyImportResultDto, type DiffEntryDto, type Message } from '@fc/contracts';

import { DomainError } from '../../common/domain-error';
import { AppConfigService } from '../../config/app-config.service';
import { ImportBatch, Shift, SyncLog } from '../../database/entities';
import { GcalService } from '../gcal/gcal.service';
import type { CalendarShift } from '../gcal/gcal.types';

/**
 * Применение плана: сначала база, потом календарь.
 *
 * Порядок важен. База — источник правды, календарь её проекция. Если запись в
 * Google упала, смена остаётся в базе со `sync_state = failed` и её можно
 * повторить, не перезапуская распознавание. Обратный порядок оставил бы
 * события в календаре без следа в базе.
 */
@Injectable()
export class ApplyProcess {
  private readonly logger = new Logger(ApplyProcess.name);

  constructor(
    private readonly em: EntityManager,
    private readonly gcal: GcalService,
    private readonly cfg: AppConfigService,
  ) {}

  async apply(
    batch: ImportBatch,
    entries: DiffEntryDto[],
    allowedDates: Set<string>,
  ): Promise<ApplyImportResultDto> {
    const tz = this.cfg.get('GCAL_TIMEZONE');
    const result: ApplyImportResultDto = { applied: 0, failed: 0, entries: [] };

    for (const entry of entries) {
      if (!allowedDates.has(entry.workDate)) continue;
      if (entry.action === 'skip_identical' || entry.action === 'skip_invalid') continue;

      try {
        await this.applyOne(batch, entry, tz);
        result.applied += 1;
        result.entries.push({
          workDate: entry.workDate,
          action: entry.action,
          ok: true,
          error: null,
        });
      } catch (error) {
        const reason = describe(error);
        this.logger.error(
          `${entry.action} на ${entry.workDate} не удалось: ${plain(error)}`,
        );
        result.failed += 1;
        result.entries.push({
          workDate: entry.workDate,
          action: entry.action,
          ok: false,
          error: reason,
        });
        this.em.persist(this.log(batch, entry, null, false, reason));
      }
    }

    await this.em.flush();
    return result;
  }

  private async applyOne(batch: ImportBatch, entry: DiffEntryDto, tz: string): Promise<void> {
    switch (entry.action) {
      case 'create':
        return this.create(batch, entry, tz);
      case 'update':
        return this.update(batch, entry, tz);
      case 'delete':
        return this.remove(batch, entry);
      default:
        return;
    }
  }

  private toCalendarShift(shift: Shift): CalendarShift {
    return {
      workDate: shift.workDate,
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
      label: shift.label,
      location: shift.location,
      tz: shift.tz,
    };
  }

  private async create(batch: ImportBatch, entry: DiffEntryDto, tz: string): Promise<void> {
    if (!entry.after) throw new DomainError('err.create-without-target');

    const shift = this.em.create(Shift, {
      workDate: entry.workDate,
      startsAt: entry.after.startsAt,
      endsAt: entry.after.endsAt,
      label: entry.after.label,
      location: null,
      tz,
      googleEventId: null,
      syncState: 'pending',
      syncError: null,
      sourceBatch: batch,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    this.em.persist(shift);
    await this.em.flush();

    try {
      const eventId = await this.gcal.createEvent(this.toCalendarShift(shift));
      shift.googleEventId = eventId;
      shift.syncState = 'synced';
      shift.syncError = null;
      this.em.persist(this.log(batch, entry, eventId, true, null));
    } catch (error) {
      // смена остаётся в базе со следом об ошибке: повтор возможен без
      // перезапуска распознавания, а reconcile покажет расхождение
      shift.syncState = 'failed';
      shift.syncError = describe(error);
      await this.em.flush();
      throw error;
    }
  }

  private async update(batch: ImportBatch, entry: DiffEntryDto, tz: string): Promise<void> {
    if (!entry.after || !entry.before) throw new DomainError('err.update-without-sides');

    const shift = await this.em.findOne(Shift, { id: entry.before.shiftId });
    if (!shift) throw new DomainError('err.shift-missing', { id: entry.before.shiftId });

    shift.startsAt = entry.after.startsAt;
    shift.endsAt = entry.after.endsAt;
    shift.label = entry.after.label;
    shift.tz = tz;
    shift.sourceBatch = batch;
    shift.updatedAt = new Date();
    await this.em.flush();

    try {
      // событие могло не создаться в прошлый раз — тогда создаём, а не обновляем
      const eventId = shift.googleEventId
        ? await this.gcal.updateEvent(shift.googleEventId, this.toCalendarShift(shift))
        : await this.gcal.createEvent(this.toCalendarShift(shift));

      shift.googleEventId = eventId;
      shift.syncState = 'synced';
      shift.syncError = null;
      this.em.persist(this.log(batch, entry, eventId, true, null));
    } catch (error) {
      shift.syncState = 'failed';
      shift.syncError = describe(error);
      await this.em.flush();
      throw error;
    }
  }

  private async remove(batch: ImportBatch, entry: DiffEntryDto): Promise<void> {
    if (!entry.before) throw new DomainError('err.delete-without-source');

    const shift = await this.em.findOne(Shift, { id: entry.before.shiftId });
    if (!shift) return;

    if (shift.googleEventId) await this.gcal.deleteEvent(shift.googleEventId);
    this.em.persist(this.log(batch, entry, shift.googleEventId, true, null));
    this.em.remove(shift);
  }

  private log(
    batch: ImportBatch,
    entry: DiffEntryDto,
    eventId: string | null,
    ok: boolean,
    error: Message | null,
  ): SyncLog {
    return this.em.create(SyncLog, {
      batch,
      workDate: entry.workDate,
      action: entry.action,
      before: entry.before,
      after: entry.after,
      googleEventId: eventId,
      ok,
      error,
      createdAt: new Date(),
    });
  }
}

/**
 * Ошибка в виде сообщения.
 *
 * Своя доменная ошибка уже несёт код; всё остальное прилетело от Google или из
 * сети — свой код ему не придумать, поэтому текст провайдера едет подстановкой
 * в общую фразу. Иначе пришлось бы либо переводить чужие сообщения, либо
 * показывать их без всякого пояснения.
 */
function describe(error: unknown): Message {
  if (error instanceof DomainError) return error.toMessage();
  return message('msg.google-failed', { detail: plain(error) });
}

function plain(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
