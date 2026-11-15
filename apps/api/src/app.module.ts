import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { AppConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
import mikroOrmConfig from './database/mikro-orm.config';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthModule } from './modules/auth/auth.module';
import { GcalModule } from './modules/gcal/gcal.module';
import { HealthModule } from './modules/health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { RecognitionModule } from './modules/recognition/recognition.module';
import { ShiftsModule } from './modules/shifts/shifts.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.get('LOG_LEVEL'),
          transport: cfg.isProduction
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true, translateTime: 'HH:MM:ss' } },
          // пароль не должен попасть в логи ни при каких условиях
          redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body.password'],
          autoLogging: { ignore: (req) => req.url === '/api/health' },
        },
      }),
    }),
    MikroOrmModule.forRoot(mikroOrmConfig),

    AuthModule,
    HealthModule,
    RecognitionModule,
    ImportsModule,
    ShiftsModule,
    GcalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
