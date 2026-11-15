import { IsOptional, Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RangeQueryDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'err.date-format' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'err.date-format' })
  to?: string;
}
