import type {
  ImportBatchDto,
  RecognizedRowDto,
  RowChecks,
  ScreenshotDto,
} from '@fc/contracts';

import type { ImportBatch, RecognizedRow, Screenshot } from '../../database/entities';

export function screenshotToDto(s: Screenshot): ScreenshotDto {
  return {
    id: s.id,
    orderIndex: s.orderIndex,
    width: s.width,
    height: s.height,
    sha256: s.sha256,
    sourceKind: s.sourceKind,
    pageIndex: s.pageIndex,
  };
}

export function rowToDto(row: RecognizedRow): RecognizedRowDto {
  return {
    id: row.id,
    screenshotId: row.screenshot.id,
    kind: row.kind,
    workDate: row.workDate,
    weekdayText: row.weekdayText,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    label: row.label,
    location: row.location,
    durationText: row.durationText,
    isClipped: row.isClipped,
    confidence: row.confidence === null ? null : Number(row.confidence),
    checks: row.checks as RowChecks,
    sources: row.sources,
    usedFallback: row.usedFallback,
    ok: row.ok,
    reason: row.reason,
  };
}

export function batchToDto(batch: ImportBatch): ImportBatchDto {
  return {
    id: batch.id,
    status: batch.status,
    sourceMonth: batch.sourceMonth,
    error: batch.error,
    warnings: batch.warnings ?? [],
    createdAt: batch.createdAt.toISOString(),
    appliedAt: batch.appliedAt?.toISOString() ?? null,
    screenshots: batch.screenshots.isInitialized()
      ? batch.screenshots.getItems().map(screenshotToDto)
      : [],
  };
}
