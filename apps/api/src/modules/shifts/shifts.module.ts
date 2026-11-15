import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';

import { ImportBatch, Shift, SyncLog } from '../../database/entities';
import { GcalModule } from '../gcal/gcal.module';
import { ApplyProcess } from './apply.process';
import { ReconcileProcess } from './reconcile.process';
import { ShiftsController } from './shifts.controller';
import { ShiftsRepository } from './shifts.repository';

@Module({
  imports: [MikroOrmModule.forFeature([Shift, SyncLog, ImportBatch]), GcalModule],
  controllers: [ShiftsController],
  providers: [ShiftsRepository, ApplyProcess, ReconcileProcess],
  exports: [ShiftsRepository, ApplyProcess],
})
export class ShiftsModule {}
