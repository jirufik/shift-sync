import type { Message } from './common.js';
import type { RecognizedRowDto } from './recognition.js';
import type { DiffPlanDto } from './shifts.js';

export type ImportStatus =
  | 'pending'
  | 'recognizing'
  | 'review'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cancelled';

/** Чем загрузили: снимок экрана или страница PDF-выгрузки. */
export type SourceKind = 'image' | 'pdf_page';

export interface ScreenshotDto {
  id: string;
  orderIndex: number;
  width: number;
  height: number;
  sha256: string;
  sourceKind: SourceKind;
  /** номер страницы внутри PDF, с нуля; у снимка экрана всегда 0 */
  pageIndex: number;
}

export interface ImportBatchDto {
  id: string;
  status: ImportStatus;
  /** месяц из шапки списка, `YYYY-MM-01` */
  sourceMonth: string | null;
  /** почему распознавание не удалось: код и подстановки, фразу собирает интерфейс */
  error: Message | null;
  /**
   * Что распознавание сделало «на своё усмотрение» и о чём человеку стоит
   * знать перед проверкой дат. Не ошибки — импорт при них проходит.
   */
  warnings: Message[];
  createdAt: string;
  appliedAt: string | null;
  screenshots: ScreenshotDto[];
}

/** Полное состояние батча: сам батч, распознанные строки и план изменений. */
export interface ImportBatchDetailDto extends ImportBatchDto {
  rows: RecognizedRowDto[];
  plan: DiffPlanDto | null;
}

export interface ApplyImportRequest {
  /** даты, которые пользователь подтвердил в ревью; пустой массив = ничего не применять */
  workDates: string[];
}

export interface ApplyImportResultDto {
  applied: number;
  failed: number;
  entries: Array<{ workDate: string; action: string; ok: boolean; error: Message | null }>;
}

export interface PatchRowRequest {
  startsAt?: string | null;
  endsAt?: string | null;
  kind?: 'shift' | 'no_shift' | 'non_work_marker';
}
