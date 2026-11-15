import { Injectable, Logger } from '@nestjs/common';
import { google, type calendar_v3 } from 'googleapis';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { DomainError } from '../../common/domain-error';
import { retry } from '../../common/retry.util';
import { AppConfigService } from '../../config/app-config.service';
import { GoogleNotConfiguredError, type CalendarShift, type TaggedEvent } from './gcal.types';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

@Injectable()
export class GcalService {
  private readonly logger = new Logger(GcalService.name);
  private client: calendar_v3.Calendar | null = null;

  constructor(private readonly cfg: AppConfigService) {}

  get isConfigured(): boolean {
    return this.cfg.isGoogleConfigured;
  }

  /**
   * Авторизация сервисным аккаунтом. Никакого OAuth: целевой календарь открыт
   * на адрес вида `...@....iam.gserviceaccount.com` с правом «Внесение изменений
   * в мероприятия», токен аккаунт выписывает себе сам и он не протухает.
   */
  private getClient(): calendar_v3.Calendar {
    if (this.client) return this.client;
    if (!this.isConfigured) throw new GoogleNotConfiguredError();

    const keyFile = resolve(process.cwd(), this.cfg.get('GOOGLE_SERVICE_ACCOUNT_JSON'));
    if (!existsSync(keyFile)) {
      throw new GoogleNotConfiguredError();
    }

    const auth = new google.auth.GoogleAuth({ keyFile, scopes: [CALENDAR_SCOPE] });
    this.client = google.calendar({ version: 'v3', auth });
    return this.client;
  }

  private get calendarId(): string {
    return this.cfg.get('GCAL_CALENDAR_ID');
  }

  private get appTag(): string {
    return this.cfg.get('GCAL_APP_TAG');
  }

  /**
   * Любой вызов Google идёт через повторы: сеть и квоты — это не исключительная
   * ситуация, а нормальный режим работы внешнего сервиса. Постоянные ошибки
   * (нет прав, календарь не найден) повторами не маскируются — они пролетают
   * сразу, см. `isTransientError`.
   */
  private call<T>(label: string, operation: () => Promise<T>): Promise<T> {
    return retry(operation, {
      label,
      onRetry: (error, attempt, delayMs) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`${label}: попытка ${attempt} не удалась (${message}), повтор через ${delayMs} мс`);
      },
    });
  }

  /** `2027-03-13` + `08:00` → `2027-03-13T08:00:00`, без зоны — она едет отдельным полем. */
  private localDateTime(workDate: string, time: string): string {
    return `${workDate}T${time}:00`;
  }

  private buildEvent(shift: CalendarShift): calendar_v3.Schema$Event {
    const prefix = this.cfg.get('GCAL_EVENT_PREFIX');
    const description = [shift.location, shift.label].filter(Boolean).join('\n');

    return {
      summary: `${prefix} ${shift.startsAt}–${shift.endsAt}`.trim(),
      description: description || undefined,
      colorId: this.cfg.get('GCAL_COLOR_ID') || undefined,
      // локальное время + зона: тогда переход на зимнее время Google обрабатывает
      // сам. При отправке UTC смены после перевода часов поехали бы на час.
      start: { dateTime: this.localDateTime(shift.workDate, shift.startsAt), timeZone: shift.tz },
      end: { dateTime: this.localDateTime(shift.workDate, shift.endsAt), timeZone: shift.tz },
      extendedProperties: {
        private: {
          app: this.appTag,
          workDate: shift.workDate,
          fingerprint: `${shift.workDate}T${shift.startsAt}/${shift.endsAt}`,
        },
      },
    };
  }

  async createEvent(shift: CalendarShift): Promise<string> {
    const res = await this.call(`создание события на ${shift.workDate}`, () =>
      this.getClient().events.insert({
        calendarId: this.calendarId,
        requestBody: this.buildEvent(shift),
      }),
    );
    const id = res.data.id;
    if (!id) throw new DomainError('err.gcal-no-event-id');
    this.logger.log(`Создано событие ${id} на ${shift.workDate}`);
    return id;
  }

  async updateEvent(eventId: string, shift: CalendarShift): Promise<string> {
    const res = await this.call(`обновление события на ${shift.workDate}`, () =>
      this.getClient().events.update({
        calendarId: this.calendarId,
        eventId,
        requestBody: this.buildEvent(shift),
      }),
    );
    this.logger.log(`Обновлено событие ${eventId} на ${shift.workDate}`);
    return res.data.id ?? eventId;
  }

  /** Удаление идемпотентно: уже удалённое событие не считается ошибкой. */
  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.call(`удаление события ${eventId}`, () =>
        this.getClient().events.delete({ calendarId: this.calendarId, eventId }),
      );
      this.logger.log(`Удалено событие ${eventId}`);
    } catch (error) {
      const status = (error as { code?: number }).code;
      if (status === 404 || status === 410) {
        this.logger.warn(`Событие ${eventId} уже отсутствует в календаре`);
        return;
      }
      throw error;
    }
  }

  /**
   * Только свои события. Выборка идёт строго по приватной метке, поэтому
   * личные события владельца календаря сервис не видит и тронуть не может.
   */
  async listOwnEvents(timeMin: string, timeMax: string): Promise<TaggedEvent[]> {
    const res = await this.call('выборка своих событий', () =>
      this.getClient().events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: [`app=${this.appTag}`],
        timeMin: `${timeMin}T00:00:00Z`,
        timeMax: `${timeMax}T23:59:59Z`,
        singleEvents: true,
        maxResults: 2500,
      }),
    );

    return (res.data.items ?? [])
      .filter((e): e is calendar_v3.Schema$Event & { id: string } => Boolean(e.id))
      .map((e) => {
        const props = e.extendedProperties?.private ?? {};
        const startRaw = e.start?.dateTime ?? '';
        const endRaw = e.end?.dateTime ?? '';
        return {
          eventId: e.id,
          workDate: props.workDate ?? startRaw.slice(0, 10),
          startsAt: startRaw.slice(11, 16),
          endsAt: endRaw.slice(11, 16),
          summary: e.summary ?? '',
        };
      });
  }
}
