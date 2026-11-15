import { MikroORM } from '@mikro-orm/postgresql';
import { ReflectMetadataProvider } from '@mikro-orm/postgresql';

import { ImportBatch, RecognizedRow, Screenshot, Shift, SyncLog } from '../src/database/entities';

/**
 * Отдельная база для тестов. Схема пересоздаётся из сущностей перед каждым
 * файлом тестов, поэтому состояние всегда предсказуемо и не зависит от
 * порядка запуска.
 */
export async function createTestOrm(): Promise<MikroORM> {
  const orm = await MikroORM.init({
    entities: [ImportBatch, Screenshot, RecognizedRow, Shift, SyncLog],
    metadataProvider: ReflectMetadataProvider,
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5481),
    dbName: 'fc_shift_sync_test',
    user: process.env.DB_USER ?? 'fc_admin',
    password: process.env.DB_PASSWORD ?? 'fc_admin',
    debug: false,
    forceUtcTimezone: true,
  });
  await orm.schema.refreshDatabase();
  return orm;
}
