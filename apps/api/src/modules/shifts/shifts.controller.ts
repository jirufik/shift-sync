import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import type { ShiftDto } from '@fc/contracts';

import { DomainError } from '../../common/domain-error';
import { processHttpError } from '../../common/error-patterns';
import type { Shift } from '../../database/entities';
import { GcalService } from '../gcal/gcal.service';
import { RangeQueryDto } from './dto/range.dto';
import { ReconcileProcess, type ReconcileReport } from './reconcile.process';
import { ShiftsRepository } from './shifts.repository';

function toDto(shift: Shift): ShiftDto {
  return {
    id: shift.id,
    workDate: shift.workDate,
    startsAt: shift.startsAt,
    endsAt: shift.endsAt,
    label: shift.label,
    location: shift.location,
    tz: shift.tz,
    googleEventId: shift.googleEventId,
    syncState: shift.syncState,
    syncError: shift.syncError,
  };
}

@Controller()
export class ShiftsController {
  constructor(
    private readonly shifts: ShiftsRepository,
    private readonly reconcile: ReconcileProcess,
    private readonly gcal: GcalService,
  ) {}

  @Get('shifts')
  async list(@Query() query: RangeQueryDto): Promise<ShiftDto[]> {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const from = query.from ?? `${today.slice(0, 8)}01`;
      const to = query.to ?? '9999-12-31';
      const rows = await this.shifts.findInRange(from, to);
      return rows.map(toDto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @HttpCode(200)
  @Post('gcal/reconcile')
  async runReconcile(): Promise<ReconcileReport> {
    try {
      if (!this.gcal.isConfigured) throw new DomainError('err.gcal-not-configured');
      return await this.reconcile.run();
    } catch (error) {
      processHttpError(error);
    }
  }
}
