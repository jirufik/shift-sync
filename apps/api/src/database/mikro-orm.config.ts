import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, ReflectMetadataProvider } from '@mikro-orm/postgresql';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

import { ImportBatch, RecognizedRow, Screenshot, Shift, SyncLog } from './entities';

// конфиг читается и NestJS-ом, и CLI миграций, поэтому окружение подхватываем сами
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });

/**
 * Сущности перечислены явно, а не глобом: при CommonJS-сборке пути к `dist`
 * и к `src` различаются, и автопоиск по маске — самый частый источник
 * «entity not discovered» между dev и prod.
 */
export default defineConfig({
  entities: [ImportBatch, Screenshot, RecognizedRow, Shift, SyncLog],
  metadataProvider: ReflectMetadataProvider,

  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5481),
  dbName: process.env.DB_NAME ?? 'fc_shift_sync',
  user: process.env.DB_USER ?? 'fc_admin',
  password: process.env.DB_PASSWORD ?? 'fc_admin',

  debug: process.env.DB_DEBUG === 'true',
  forceUtcTimezone: true,

  extensions: [Migrator],
  migrations: {
    path: resolve(__dirname, 'migrations'),
    pathTs: resolve(process.cwd(), 'src/database/migrations'),
    tableName: 'mikro_orm_migrations',
    transactional: true,
    disableForeignKeys: false,
    allOrNothing: true,
    emit: 'ts',
    snapshot: true,
  },
});
