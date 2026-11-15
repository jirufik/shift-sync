import { Entity, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { Message, RowChecks, RowKind } from '@fc/contracts';
import { randomUUID } from 'node:crypto';

import { ImportBatch } from './import-batch.entity';
import { Screenshot } from './screenshot.entity';

/** Сырой результат разбора одного блока дня, до склейки и диффа. */
@Entity({ tableName: 'recognized_rows' })
export class RecognizedRow {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => ImportBatch, { deleteRule: 'cascade', index: true })
  batch!: ImportBatch;

  @ManyToOne(() => Screenshot, { deleteRule: 'cascade', index: true })
  screenshot!: Screenshot;

  @Property({ type: 'text' })
  kind: RowKind = 'unparsed';

  /** `YYYY-MM-DD`; см. D-006 */
  @Property({ type: 'string', length: 10, nullable: true })
  workDate: string | null = null;

  /** как прочиталось название дня недели, до сопоставления со словарём */
  @Property({ type: 'text', nullable: true })
  weekdayText: string | null = null;

  /** `HH:MM`; см. D-006 */
  @Property({ type: 'string', length: 5, nullable: true })
  startsAt: string | null = null;

  @Property({ type: 'string', length: 5, nullable: true })
  endsAt: string | null = null;

  /** заголовок карточки, например `410 8-14` */
  @Property({ type: 'text', nullable: true })
  label: string | null = null;

  @Property({ type: 'text', nullable: true })
  location: string | null = null;

  /** исходная строка `Vuoroaika: 6 h, Työaika: 6 h` */
  @Property({ type: 'text', nullable: true })
  durationText: string | null = null;

  /** карточка обрезана кромкой изображения — данные неполные */
  @Property({ type: 'boolean' })
  isClipped: boolean = false;

  @Property({ type: 'decimal', precision: 4, scale: 3, nullable: true })
  confidence: string | null = null;

  /** результат каждой проверки шлюза */
  @Property({ type: 'json' })
  checks!: RowChecks;

  /** сколько независимых источников времени сошлось */
  @Property({ type: 'integer' })
  sources: number = 0;

  /** время взято из заголовка карточки, потому что левая колонка неполная */
  @Property({ type: 'boolean' })
  usedFallback: boolean = false;

  @Property({ type: 'boolean' })
  ok: boolean = false;

  /**
   * Причина, по которой строка не прошла шлюз: код и подстановки (D-023).
   * Колонка json, а не text: фразу собирает интерфейс на своём языке.
   */
  @Property({ type: 'json', nullable: true })
  reason: Message | null = null;

  /** что вернул OCR по этому блоку — для отладки и разбора инцидентов */
  @Property({ type: 'json', nullable: true })
  raw: unknown = null;

  /** правил ли строку человек в ревью */
  @Property({ type: 'boolean' })
  editedByUser: boolean = false;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
