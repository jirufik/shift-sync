import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';

import { Shift } from '../../database/entities';

@Injectable()
export class ShiftsRepository {
  constructor(private readonly em: EntityManager) {}

  /** Даты сравниваются лексикографически — для ISO-строк это эквивалент дат (D-006). */
  async findInRange(from: string, to: string): Promise<Shift[]> {
    return this.em.find(
      Shift,
      { workDate: { $gte: from, $lte: to } },
      { orderBy: { workDate: 'asc', startsAt: 'asc' } },
    );
  }

  async findForDates(dates: string[]): Promise<Shift[]> {
    if (dates.length === 0) return [];
    return this.em.find(
      Shift,
      { workDate: { $in: dates } },
      { orderBy: { workDate: 'asc', startsAt: 'asc' } },
    );
  }

  async findById(id: string): Promise<Shift | null> {
    return this.em.findOne(Shift, { id });
  }
}
