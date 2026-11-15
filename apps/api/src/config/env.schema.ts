import { z } from 'zod';

const bool = z
  .string()
  .transform((v) => v === 'true' || v === '1')
  .pipe(z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4080),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // доступ
  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD обязателен'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET должен быть не короче 16 символов'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default('false'),

  // база
  DB_HOST: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(5481),
  DB_NAME: z.string().default('fc_shift_sync'),
  DB_USER: z.string().default('fc_admin'),
  DB_PASSWORD: z.string().default('fc_admin'),
  DB_DEBUG: bool.default('false'),
  /** прогонять миграции при старте — нужно в контейнере, где нет CLI */
  DB_AUTO_MIGRATE: bool.default('true'),

  // хранилище скриншотов
  STORAGE_DIR: z.string().default('../../storage/screenshots'),
  SCREENSHOT_RETENTION_DAYS: z.coerce.number().int().min(0).default(180),

  // распознавание (D-004: единственный путь — PP-OCRv5)
  OCR_MAX_SIDE_LENGTH: z.coerce.number().int().positive().default(1280),

  // Google Календарь
  /** путь относительно рабочего каталога API (apps/api), как и STORAGE_DIR */
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().default('../../secrets/service-account.json'),
  GCAL_CALENDAR_ID: z.string().default(''),
  GCAL_TIMEZONE: z.string().default('Europe/Helsinki'),
  GCAL_UPDATE_STRATEGY: z.enum(['update', 'recreate']).default('update'),
  GCAL_EVENT_PREFIX: z.string().default('Работа'),
  GCAL_COLOR_ID: z.string().default('11'),
  /** метка, по которой сервис узнаёт свои события и не трогает чужие */
  GCAL_APP_TAG: z.string().default('fc-shift-sync'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Некорректная конфигурация окружения:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
