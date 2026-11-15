import { Controller, Get } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/core';

import { Public } from '../auth/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly orm: MikroORM) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; db: boolean }> {
    let db = false;
    try {
      db = await this.orm.em.getConnection().execute('select 1').then(() => true);
    } catch {
      db = false;
    }
    return { status: db ? 'ok' : 'degraded', db };
  }
}
