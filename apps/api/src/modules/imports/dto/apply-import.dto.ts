import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

export class ApplyImportDto {
  /** даты, подтверждённые человеком в ревью */
  @IsArray()
  @ArrayMaxSize(400)
  @IsString({ each: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true, message: 'err.date-format' })
  workDates!: string[];
}
