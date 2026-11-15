import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { DiffAction, Message } from '@fc/contracts';
import { randomUUID } from 'node:crypto';

import { ImportBatch } from './import-batch.entity';

/** Журнал: что и почему сделали с календарём. */
@Entity({ tableName: 'sync_log' })
export class SyncLog {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => ImportBatch, { nullable: true, deleteRule: 'set null' })
  batch: ImportBatch | null = null;

  @Index()
  @Property({ type: 'string', length: 10 })
  workDate!: string;

  @Property({ type: 'text' })
  action!: DiffAction | 'reconcile';

  @Property({ type: 'json', nullable: true })
  before: unknown = null;

  @Property({ type: 'json', nullable: true })
  after: unknown = null;

  @Property({ type: 'text', nullable: true })
  googleEventId: string | null = null;

  @Property({ type: 'boolean' })
  ok: boolean = true;

  /** что пошло не так при записи в календарь: код и подстановки, см. D-023 */
  @Property({ type: 'json', nullable: true })
  error: Message | null = null;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
