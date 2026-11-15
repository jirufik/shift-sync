import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { resolve } from 'node:path';

import { MikroORM } from '@mikro-orm/postgresql';

import { AppModule } from './app.module';
import { createSpaMiddleware } from './common/spa.middleware';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const cfg = app.get(AppConfigService);
  const logger = app.get(Logger);

  // Схема приводится к актуальной до того, как сервис начнёт принимать запросы.
  // В контейнере запускать CLI миграций неоткуда, а расхождение схемы и кода —
  // худший способ узнать об этом из первого же запроса.
  if (cfg.get('DB_AUTO_MIGRATE')) {
    const migrator = app.get(MikroORM).getMigrator();
    const pending = await migrator.getPendingMigrations();
    if (pending.length > 0) {
      logger.log(`Применяю миграции: ${pending.map((m) => m.name).join(', ')}`);
      await migrator.up();
    }
  }

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.use(cookieParser());

  // Фронт раздаётся до маршрутов Nest, но middleware само пропускает
  // /api и /health дальше, поэтому пересечений нет.
  const spa = createSpaMiddleware(resolve(__dirname, '../../web/.output/public'));
  if (spa) app.use(spa);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  if (!cfg.isProduction) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Shift Sync API').setVersion('0.1').build(),
    );
    SwaggerModule.setup('api/docs', app, doc);
  }

  const port = cfg.get('PORT');
  await app.listen(port, '0.0.0.0');
  logger.log(`Shift Sync слушает :${port}`);
}

void bootstrap();
