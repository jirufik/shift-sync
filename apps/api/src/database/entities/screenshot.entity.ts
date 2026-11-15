import { Entity, Index, ManyToOne, PrimaryKey, Property } from '@mikro-orm/core';
import type { SourceKind } from '@fc/contracts';
import { randomUUID } from 'node:crypto';

import { ImportBatch } from './import-batch.entity';

@Entity({ tableName: 'screenshots' })
export class Screenshot {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @ManyToOne(() => ImportBatch, { deleteRule: 'cascade', index: true })
  batch!: ImportBatch;

  /**
   * Картинка кадра, путь относительно STORAGE_DIR.
   *
   * У снимка экрана это сам загруженный файл, у PDF — отрисованная страница:
   * экран проверки показывает их одинаково и не должен знать, чем загрузили.
   */
  @Property({ type: 'text' })
  filePath!: string;

  @Property({ type: 'text' })
  sourceKind: SourceKind = 'image';

  /** исходный PDF, путь относительно STORAGE_DIR; у снимка экрана пусто */
  @Property({ type: 'text', nullable: true })
  sourcePath: string | null = null;

  /** номер страницы внутри PDF, с нуля; у снимка экрана всегда 0 */
  @Property({ type: 'integer' })
  pageIndex: number = 0;

  /** для отсечения повторной загрузки того же файла */
  @Index()
  @Property({ type: 'string', length: 64 })
  sha256!: string;

  @Property({ type: 'integer' })
  width!: number;

  @Property({ type: 'integer' })
  height!: number;

  /** порядок, в котором пользователь загрузил кадры */
  @Property({ type: 'integer' })
  orderIndex: number = 0;

  @Property({ type: 'timestamptz' })
  createdAt: Date = new Date();
}
