import type { IsoDate, Message, TimeOfDay } from './common.js';

export type SyncState = 'pending' | 'synced' | 'failed';

export interface ShiftDto {
  id: string;
  workDate: IsoDate;
  startsAt: TimeOfDay;
  endsAt: TimeOfDay;
  label: string | null;
  location: string | null;
  tz: string;
  googleEventId: string | null;
  syncState: SyncState;
  /** что ответил Google, если запись не прошла */
  syncError: Message | null;
}

/** Что сервис собирается сделать с одной датой. */
export type DiffAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'skip_identical'
  | 'skip_invalid';

export interface DiffEntryDto {
  workDate: IsoDate;
  action: DiffAction;
  /** что сейчас в базе (и, соответственно, в календаре) */
  before: { startsAt: TimeOfDay; endsAt: TimeOfDay; shiftId: string } | null;
  /** что предлагается записать */
  after: { startsAt: TimeOfDay; endsAt: TimeOfDay; label: string | null } | null;
  /** идентификатор распознанной строки, из которой получился `after` */
  rowId: string | null;
  /** причина, если действие пропускается или требует внимания */
  reason: Message | null;
  /** требует ручного подтверждения: шлюз не пройден или кадры противоречат друг другу */
  needsAttention: boolean;
}

export interface DiffPlanDto {
  entries: DiffEntryDto[];
  summary: Record<DiffAction, number> & { needsAttention: number };
}
