import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable, Logger } from '@nestjs/common';
import {
  message,
  type ApplyImportResultDto,
  type DiffPlanDto,
  type ImportBatchDetailDto,
  type ImportBatchDto,
  type Message,
} from '@fc/contracts';

import { DomainError } from '../../common/domain-error';
import { AppConfigService } from '../../config/app-config.service';
import { ImportBatch, RecognizedRow, Screenshot } from '../../database/entities';
import { GcalService } from '../gcal/gcal.service';
import { PdfService } from '../recognition/pdf.service';
import type { ImageInput, PdfInput } from '../recognition/recognition.service';
import { RecognitionService } from '../recognition/recognition.service';
import { ApplyProcess } from '../shifts/apply.process';
import { buildDiffPlan, mergeRecognized, type RecognizedInput } from '../shifts/diff';
import { ShiftsRepository } from '../shifts/shifts.repository';
import { batchToDto, rowToDto } from './imports.mapper';
import type { PatchRowDto } from './dto/patch-row.dto';
import { StorageService } from './storage.service';

export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
}

/**
 * Оркестрация импорта.
 *
 * Процесс не знает про HTTP: наружу летят обычные
 * доменные ошибки, а перевод в статус живёт в контроллере (`processHttpError`).
 * Каждый публичный метод обёрнут в try/catch, который пишет в журнал с
 * контекстом и пробрасывает дальше — глотать ошибку здесь нельзя, иначе
 * вызывающий решит, что всё прошло.
 */
@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly storage: StorageService,
    private readonly recognition: RecognitionService,
    private readonly pdf: PdfService,
    private readonly shifts: ShiftsRepository,
    private readonly applyProcess: ApplyProcess,
    private readonly gcal: GcalService,
    private readonly cfg: AppConfigService,
  ) {}

  // ── создание батча ────────────────────────────────────────────────────────

  async createBatch(files: UploadedFile[]): Promise<ImportBatchDto> {
    try {
      if (files.length === 0) throw new DomainError('err.no-files');

      const batch = this.em.create(ImportBatch, {
        status: 'pending',
        sourceMonth: null,
        stats: null,
        error: null,
        warnings: [],
        createdAt: new Date(),
        appliedAt: null,
      });
      this.em.persist(batch);

      const seen = new Set<string>();
      let orderIndex = 0;
      for (const file of files) {
        // тип из заголовка запроса присылает клиент, поэтому смотрим в сами
        // байты: `%PDF-` в начале файла ни с чем не спутать
        if (PdfService.looksLikePdf(file.buffer)) {
          const source = await this.storage.saveRaw(file.buffer, 'pdf');
          if (seen.has(source.sha256)) continue;
          seen.add(source.sha256);

          // страницы отрисовываются сразу: в ревью они показываются там же,
          // где кадры со скриншотов, и экран проверки не должен знать разницы
          const rendered = await this.pdf.renderPages(file.buffer);
          for (const [pageIndex, image] of rendered.entries()) {
            const page = await this.storage.save(image, `${source.sha256}-${pageIndex}.png`);
            this.em.persist(
              this.em.create(Screenshot, {
                batch,
                filePath: page.relativePath,
                sha256: page.sha256,
                width: page.width,
                height: page.height,
                orderIndex: orderIndex++,
                sourceKind: 'pdf_page',
                sourcePath: source.relativePath,
                pageIndex,
                createdAt: new Date(),
              }),
            );
          }
          continue;
        }

        const stored = await this.storage.save(file.buffer, file.originalName);
        // один и тот же кадр, переданный дважды, учитываем один раз
        if (seen.has(stored.sha256)) continue;
        seen.add(stored.sha256);

        this.em.persist(
          this.em.create(Screenshot, {
            batch,
            filePath: stored.relativePath,
            sha256: stored.sha256,
            width: stored.width,
            height: stored.height,
            orderIndex: orderIndex++,
            sourceKind: 'image',
            sourcePath: null,
            pageIndex: 0,
            createdAt: new Date(),
          }),
        );
      }

      await this.em.flush();
      this.logger.log(`Батч ${batch.id}: принято файлов ${seen.size}`);

      // распознавание идёт в фоне; собственных ошибок оно не выпускает,
      // но `catch` обязателен — иначе любой сбой до внутреннего try
      // превратится в необработанный reject и уронит процесс
      void this.runRecognition(batch.id).catch((error: unknown) => {
        this.logger.error(
          `Фоновое распознавание батча ${batch.id} упало: ${describe(error)}`,
        );
      });

      return batchToDto(batch);
    } catch (error) {
      this.logger.error(`createBatch: ${describe(error)}`);
      throw error;
    }
  }

  // ── фоновое распознавание ─────────────────────────────────────────────────

  /**
   * Распознавание в фоне: три кадра — около секунды, держать HTTP-запрос
   * открытым незачем, фронт опрашивает статус. Работаем на форке
   * EntityManager — запросный контекст здесь уже закрыт.
   */
  private async runRecognition(batchId: string): Promise<void> {
    const em = this.em.fork();
    let batch: ImportBatch | null = null;

    try {
      batch = await em.findOne(ImportBatch, { id: batchId }, { populate: ['screenshots'] });
      if (!batch) {
        this.logger.warn(`Батч ${batchId} исчез до начала распознавания`);
        return;
      }

      batch.status = 'recognizing';
      await em.flush();

      const screenshots = batch.screenshots.getItems();

      // Страницы одного PDF разбираются вместе: граница публикации написана в
      // шапке первой страницы, а строки дней продолжаются на следующих.
      const images: ImageInput[] = [];
      const documents = new Map<string, PdfInput>();
      for (const s of screenshots) {
        if (s.sourceKind === 'pdf_page' && s.sourcePath) {
          let document = documents.get(s.sourcePath);
          if (!document) {
            document = { buffer: await this.storage.read(s.sourcePath), pages: [] };
            documents.set(s.sourcePath, document);
          }
          document.pages.push({
            screenshotId: s.id,
            pageIndex: s.pageIndex,
            orderIndex: s.orderIndex,
          });
          continue;
        }
        images.push({
          id: s.id,
          buffer: await this.storage.read(s.filePath),
          width: s.width,
          height: s.height,
          orderIndex: s.orderIndex,
        });
      }

      const result = await this.recognition.recognizeBatch({
        images,
        pdfs: [...documents.values()],
      });
      batch.sourceMonth = result.sourceMonth;
      batch.warnings = result.warnings;

      const byId = new Map(screenshots.map((s) => [s.id, s]));
      let recognized = 0;
      let valid = 0;

      for (const page of result.screenshots) {
        const screenshot = byId.get(page.screenshotId);
        if (!screenshot) continue;
        for (const row of page.rows) {
          recognized += 1;
          if (row.ok) valid += 1;
          em.persist(
            em.create(RecognizedRow, {
              batch,
              screenshot,
              kind: row.kind,
              workDate: row.workDate,
              weekdayText: row.weekdayText,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              label: row.label,
              location: row.location,
              durationText: row.durationText,
              isClipped: row.isClipped,
              confidence: row.confidence.toFixed(3),
              checks: row.checks,
              sources: row.sources,
              usedFallback: row.usedFallback,
              ok: row.ok,
              reason: row.reason,
              raw: null,
              editedByUser: false,
              createdAt: new Date(),
            }),
          );
        }
      }

      batch.stats = { recognized, valid, needsAttention: recognized - valid };
      batch.status = 'review';
      await em.flush();
      this.logger.log(`Батч ${batchId}: распознано ${recognized}, прошли шлюз ${valid}`);
    } catch (error) {
      const detail = describe(error);
      this.logger.error(`Батч ${batchId}: распознавание упало — ${detail}`);

      // статус ошибки надо сохранить любой ценой: без него батч навсегда
      // застрянет в «распознаётся», а фронт будет опрашивать его вечно
      try {
        if (batch) {
          batch.status = 'failed';
          batch.error = reasonOf(error, detail);
          await em.flush();
        }
      } catch (saveError) {
        this.logger.error(
          `Батч ${batchId}: не удалось сохранить статус ошибки — ${describe(saveError)}`,
        );
      }
    }
  }

  // ── чтение ────────────────────────────────────────────────────────────────

  async list(limit = 50): Promise<ImportBatchDto[]> {
    try {
      const batches = await this.em.find(
        ImportBatch,
        {},
        { orderBy: { createdAt: 'desc' }, limit, populate: ['screenshots'] },
      );
      return batches.map(batchToDto);
    } catch (error) {
      this.logger.error(`list: ${describe(error)}`);
      throw error;
    }
  }

  async getDetail(id: string): Promise<ImportBatchDetailDto> {
    try {
      const batch = await this.load(id);
      const rows = await this.em.find(
        RecognizedRow,
        { batch },
        { populate: ['screenshot'], orderBy: { workDate: 'asc' } },
      );

      const plan =
        batch.status === 'review' || batch.status === 'applied'
          ? await this.buildPlan(rows)
          : null;

      return { ...batchToDto(batch), rows: rows.map(rowToDto), plan };
    } catch (error) {
      this.logger.error(`getDetail(${id}): ${describe(error)}`);
      throw error;
    }
  }

  /** План считается на лету: после ручной правки строки он должен быть свежим. */
  private async buildPlan(rows: RecognizedRow[]): Promise<DiffPlanDto> {
    const inputs: RecognizedInput[] = rows.map((row) => ({
      rowId: row.id,
      workDate: row.workDate ?? '',
      kind: row.kind,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      label: row.label,
      ok: row.ok,
      reason: row.reason,
      screenshotOrder: row.screenshot.orderIndex,
    }));

    const days = mergeRecognized(inputs.filter((r) => r.workDate));
    const dates = days.map((d) => d.workDate);
    const current = await this.shifts.findForDates(dates);

    return buildDiffPlan(
      days,
      current.map((s) => ({
        id: s.id,
        workDate: s.workDate,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
      })),
      this.cfg.get('GCAL_UPDATE_STRATEGY'),
    );
  }

  // ── правка в ревью ────────────────────────────────────────────────────────

  /**
   * Ручная правка снимает пометку «требует внимания»: человек посмотрел на кадр
   * и подтвердил время. Проверки пересчитываются — кроме сверки с источниками
   * OCR, которые правка как раз и замещает.
   */
  async patchRow(batchId: string, rowId: string, dto: PatchRowDto): Promise<ImportBatchDetailDto> {
    try {
      const batch = await this.load(batchId);
      if (batch.status !== 'review') throw new DomainError('err.edit-only-in-review');

      const row = await this.em.findOne(RecognizedRow, { id: rowId, batch });
      if (!row) throw new DomainError('err.row-not-found', { rowId, batchId });

      if (dto.kind) row.kind = dto.kind;
      if (dto.startsAt !== undefined) row.startsAt = dto.startsAt;
      if (dto.endsAt !== undefined) row.endsAt = dto.endsAt;

      if (row.kind === 'no_shift') {
        row.startsAt = null;
        row.endsAt = null;
      }

      const hasTimes = Boolean(row.startsAt && row.endsAt);
      const valid =
        row.kind === 'no_shift' || (hasTimes && (row.startsAt as string) < (row.endsAt as string));

      row.editedByUser = true;
      row.ok = valid;
      row.reason = valid ? null : message('msg.end-before-start');
      row.checks = { ...row.checks, timesAgree: null, duration: null, sane: valid, notClipped: true };

      await this.em.flush();
      this.logger.log(`Батч ${batchId}: строка ${rowId} поправлена вручную`);
      return this.getDetail(batchId);
    } catch (error) {
      this.logger.error(`patchRow(${batchId}, ${rowId}): ${describe(error)}`);
      throw error;
    }
  }

  // ── применение ────────────────────────────────────────────────────────────

  async apply(batchId: string, workDates: string[]): Promise<ApplyImportResultDto> {
    let batch: ImportBatch | null = null;
    try {
      batch = await this.load(batchId);
      if (batch.status !== 'review') {
        throw new DomainError('err.apply-wrong-status', { status: batch.status });
      }
      // отказываем до того, как что-либо записано: иначе смены осядут в базе
      // без событий в календаре, и база разойдётся с проекцией
      if (!this.gcal.isConfigured) {
        throw new DomainError('err.gcal-not-configured');
      }
      if (workDates.length === 0) throw new DomainError('err.no-dates-selected');

      const rows = await this.em.find(RecognizedRow, { batch }, { populate: ['screenshot'] });
      const plan = await this.buildPlan(rows);

      batch.status = 'applying';
      await this.em.flush();

      const result = await this.applyProcess.apply(batch, plan.entries, new Set(workDates));

      // если не прошло ничего, импорт остаётся в ревью — его можно повторить,
      // не перезапуская распознавание
      const anyApplied = result.applied > 0;
      batch.status = anyApplied ? 'applied' : 'review';
      batch.appliedAt = anyApplied ? new Date() : null;
      batch.stats = { ...(batch.stats ?? {}), applied: result.applied, failed: result.failed };
      await this.em.flush();

      this.logger.log(`Батч ${batchId}: применено ${result.applied}, с ошибкой ${result.failed}`);
      return result;
    } catch (error) {
      this.logger.error(`apply(${batchId}): ${describe(error)}`);

      // вернуть импорт в ревью, чтобы он не завис в «применяется»
      try {
        if (batch && batch.status === 'applying') {
          batch.status = 'review';
          await this.em.flush();
        }
      } catch (restoreError) {
        this.logger.error(`Не удалось вернуть статус батча: ${describe(restoreError)}`);
      }
      throw error;
    }
  }

  async cancel(batchId: string): Promise<ImportBatchDto> {
    try {
      const batch = await this.load(batchId);
      if (batch.status === 'applied') throw new DomainError('err.applied-cannot-cancel');
      batch.status = 'cancelled';
      await this.em.flush();
      return batchToDto(batch);
    } catch (error) {
      this.logger.error(`cancel(${batchId}): ${describe(error)}`);
      throw error;
    }
  }

  private async load(id: string): Promise<ImportBatch> {
    const batch = await this.em.findOne(ImportBatch, { id }, { populate: ['screenshots'] });
    if (!batch) throw new DomainError('err.batch-not-found', { id });
    return batch;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Причина сбоя в виде сообщения.
 *
 * Своя доменная ошибка уже несёт код. Всё прочее — сбой OCR, нехватка памяти,
 * оборванный файл — своего кода не имеет, и текст едет подстановкой в общую
 * фразу: без него в ревью осталась бы одна строка «не удалось» без единого
 * следа, за который можно потянуть.
 */
function reasonOf(error: unknown, detail: string): Message {
  if (error instanceof DomainError) return error.toMessage();
  return message('msg.recognition-failed', { detail });
}
