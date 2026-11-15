import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { resolve } from 'node:path';

import type { Env } from './env.schema';

/**
 * Типизированный доступ к конфигурации. Нигде в коде не читаем `process.env` напрямую —
 * только через этот сервис, чтобы валидация была единственной точкой входа.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  /** Абсолютный путь к каталогу со скриншотами. */
  get storageDir(): string {
    return resolve(process.cwd(), this.get('STORAGE_DIR'));
  }

  /** Google-интеграция настроена и её можно вызывать. */
  get isGoogleConfigured(): boolean {
    return Boolean(this.get('GOOGLE_SERVICE_ACCOUNT_JSON') && this.get('GCAL_CALENDAR_ID'));
  }
}
