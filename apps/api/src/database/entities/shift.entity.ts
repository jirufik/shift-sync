import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import type { Message, SyncState } from '@fc/contracts';
import { randomUUID } from 'node:crypto';

import { ImportBatch } from './import-batch.entity';

/**
 * Целевое состояние: что должно быть в календаре.
 * Источник правды — эта таблица, календарь считается её проекцией.
 */
@Entity({ tableName: 'shifts' })
@Unique({ properties: ['workDate', 'startsAt'] })
export class Shift {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `YYYY-MM-DD`; см. D-006 */
  @Index()
  @Property({ type: 'string', length: 10 })
  workDate!: string;

  /** `HH:MM`. Смены не пересекают полночь, поэтому endsAt > startsAt всегда. */
  @Property({ type: 'string', length: 5 })
  startsAt!: string;

  @Property({ type: 'string', length: 5 })
  endsAt!: string;

  @Property({ type: 'text', nullable: true })
  label: string | null = null;

  @Property({ type: 'text', nullable: true })
  location: string | null = null;

  @Property({ type: 'text' })
  tz: string = 'Europe/Helsinki';

  @Property({ type: 'text', nullable: true })
  googleEventId: string | null = null;

  @Index()
  @Property({ type: 'text' })
  syncState: SyncState = 'pending';

  /** что ответил Google, если запись не прошла; код и подстановки, см. D-023 */
  @Property({ type: 'json', nullable: true })
  syncError: Message | null = null;

  @ManyToOne(() => ImportBatch, { nullable: true, deleteRule: 'set null' })
  sourceBatch: ImportBatch | null = null;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
