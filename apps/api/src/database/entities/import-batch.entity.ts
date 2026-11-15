import { Collection, Entity, Index, OneToMany, PrimaryKey, Property } from '@mikro-orm/core';
import type { ImportStatus, Message } from '@fc/contracts';
import { randomUUID } from 'node:crypto';

import { RecognizedRow } from './recognized-row.entity';
import { Screenshot } from './screenshot.entity';

/** Одна загрузка скриншотов и всё, что из неё выросло. */
@Entity({ tableName: 'import_batches' })
export class ImportBatch {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @Property({ type: 'text' })
  status: ImportStatus = 'pending';

  /** месяц из шапки списка ORTEC, `YYYY-MM-01`; см. D-006 */
  @Property({ type: 'string', length: 10, nullable: true })
  sourceMonth: string | null = null;

  /** сводка по итогам разбора и применения */
  @Property({ type: 'json', nullable: true })
  stats: Record<string, number> | null = null;

  /** почему распознавание не удалось: код и подстановки, см. D-023 */
  @Property({ type: 'json', nullable: true })
  error: Message | null = null;

  /**
   * Что распознавание решило само и о чём человеку стоит знать: например, что
   * год пришлось взять текущий, потому что шапки с месяцем в кадрах не было.
   * Не ошибки — импорт при них доходит до ревью.
   */
  @Property({ type: 'json' })
  warnings: Message[] = [];

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  appliedAt: Date | null = null;

  @OneToMany(() => Screenshot, (s) => s.batch, { orphanRemoval: true })
  screenshots = new Collection<Screenshot>(this);

  @OneToMany(() => RecognizedRow, (r) => r.batch, { orphanRemoval: true })
  rows = new Collection<RecognizedRow>(this);
}
