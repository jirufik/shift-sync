import { DomainError } from '../../common/domain-error';

export interface CalendarShift {
  workDate: string;
  startsAt: string;
  endsAt: string;
  label: string | null;
  location: string | null;
  tz: string;
}

export interface TaggedEvent {
  eventId: string;
  workDate: string;
  startsAt: string;
  endsAt: string;
  summary: string;
}

export class GoogleNotConfiguredError extends DomainError {
  constructor() {
    super('err.gcal-not-configured');
    this.name = 'GoogleNotConfiguredError';
  }
}
