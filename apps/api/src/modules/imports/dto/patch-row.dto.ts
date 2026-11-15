import { IsIn, IsOptional, Matches } from 'class-validator';

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class PatchRowDto {
  @IsOptional()
  @Matches(HH_MM, { message: 'err.time-format' })
  startsAt?: string;

  @IsOptional()
  @Matches(HH_MM, { message: 'err.time-format' })
  endsAt?: string;

  @IsOptional()
  @IsIn(['shift', 'no_shift', 'non_work_marker'])
  kind?: 'shift' | 'no_shift' | 'non_work_marker';
}
