import type { IsoDate, Message, TimeOfDay } from './common.js';

/** Что распознано в блоке одного дня. */
export type RowKind =
  /** рабочая смена */
  | 'shift'
  /** «Sinulla ei ole työvuoroa tänä päivänä» — в этот день смены нет */
  | 'no_shift'
  /** служебная метка вроде `TES V` на одну минуту — не смена */
  | 'non_work_marker'
  /** блок дня найден, но извлечь время не удалось */
  | 'unparsed';

/** Результат каждой проверки шлюза. `null` = проверку выполнить было не на чем. */
export interface RowChecks {
  /** название дня недели совпадает с реальным днём для этой даты; в PDF дня недели нет */
  weekday: boolean | null;
  /** независимые источники времени сошлись: колонка и заголовок на экране, смена и её активности в PDF */
  timesAgree: boolean | null;
  /** (end − start) совпало с `Vuoroaika` */
  duration: boolean | null;
  /** длительность в разумных пределах: 15 мин … 16 ч */
  sane: boolean;
  /** карточка не обрезана кромкой изображения; в PDF обрезаться нечему */
  notClipped: boolean;
}

export interface RecognizedRowDto {
  id: string;
  screenshotId: string;
  kind: RowKind;
  workDate: IsoDate | null;
  /** как прочиталось название дня недели, до сопоставления со словарём */
  weekdayText: string | null;
  startsAt: TimeOfDay | null;
  endsAt: TimeOfDay | null;
  label: string | null;
  location: string | null;
  durationText: string | null;
  isClipped: boolean;
  confidence: number | null;
  checks: RowChecks;
  /** сколько независимых источников времени сошлось */
  sources: number;
  /** время взято из кода смены, потому что колонка со временем неполная */
  usedFallback: boolean;
  /** прошла ли строка шлюз валидации целиком */
  ok: boolean;
  /** причина, если не прошла: код и подстановки, фразу собирает интерфейс */
  reason: Message | null;
}
