import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';

import { Shift } from '../../database/entities';
import { GcalService } from '../gcal/gcal.service';

export interface ReconcileIssue {
  kind:
    /** в базе есть, в календаре нет */
    | 'missing_in_calendar'
    /** в календаре есть, в базе нет — осиротевшее событие */
    | 'orphan_in_calendar'
    /** время разошлось: событие правили руками в Google */
    | 'time_drift';
  workDate: string;
  shiftId: string | null;
  eventId: string | null;
  inDb: string | null;
  inCalendar: string | null;
}

export interface ReconcileReport {
  from: string;
  to: string;
  checkedShifts: number;
  checkedEvents: number;
  issues: ReconcileIssue[];
}

const DEFAULT_WINDOW_DAYS = 60;

/**
 * Сверка базы с календарём. Лечит дрейф: событие удалили руками в Google,
 * поправили время, осталось событие без записи в базе. Только читает и
 * сообщает — что делать с расхождением, решает человек.
 */
@Injectable()
export class ReconcileProcess {
  private readonly logger = new Logger(ReconcileProcess.name);

  constructor(
    private readonly em: EntityManager,
    private readonly gcal: GcalService,
  ) {}

  async run(windowDays = DEFAULT_WINDOW_DAYS): Promise<ReconcileReport> {
    const today = new Date();
    const shift = (days: number): string =>
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days))
        .toISOString()
        .slice(0, 10);

    const from = shift(-windowDays);
    const to = shift(windowDays);

    const shifts = await this.em.find(Shift, { workDate: { $gte: from, $lte: to } });
    const events = await this.gcal.listOwnEvents(from, to);

    const byEventId = new Map(events.map((e) => [e.eventId, e]));
    const seenEventIds = new Set<string>();
    const issues: ReconcileIssue[] = [];

    for (const row of shifts) {
      const inDb = `${row.startsAt}–${row.endsAt}`;
      if (!row.googleEventId) {
        issues.push({
          kind: 'missing_in_calendar',
          workDate: row.workDate,
          shiftId: row.id,
          eventId: null,
          inDb,
          inCalendar: null,
        });
        continue;
      }
      const event = byEventId.get(row.googleEventId);
      if (!event) {
        issues.push({
          kind: 'missing_in_calendar',
          workDate: row.workDate,
          shiftId: row.id,
          eventId: row.googleEventId,
          inDb,
          inCalendar: null,
        });
        continue;
      }
      seenEventIds.add(event.eventId);
      if (event.startsAt !== row.startsAt || event.endsAt !== row.endsAt) {
        issues.push({
          kind: 'time_drift',
          workDate: row.workDate,
          shiftId: row.id,
          eventId: event.eventId,
          inDb,
          inCalendar: `${event.startsAt}–${event.endsAt}`,
        });
      }
    }

    for (const event of events) {
      if (seenEventIds.has(event.eventId)) continue;
      issues.push({
        kind: 'orphan_in_calendar',
        workDate: event.workDate,
        shiftId: null,
        eventId: event.eventId,
        inDb: null,
        inCalendar: `${event.startsAt}–${event.endsAt}`,
      });
    }

    this.logger.log(
      `Сверка ${from}…${to}: ${shifts.length} смен, ${events.length} событий, расхождений ${issues.length}`,
    );
    return { from, to, checkedShifts: shifts.length, checkedEvents: events.length, issues };
  }
}
