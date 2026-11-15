import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ImportBatch, RecognizedRow, Screenshot } from '../../database/entities';
import { GcalModule } from '../gcal/gcal.module';
import { RecognitionModule } from '../recognition/recognition.module';
import { ShiftsModule } from '../shifts/shifts.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { StorageService } from './storage.service';

@Module({
  imports: [
    MikroOrmModule.forFeature([ImportBatch, Screenshot, RecognizedRow]),
    RecognitionModule,
    ShiftsModule,
    GcalModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, StorageService],
  exports: [ImportsService],
})
export class ImportsModule {}
