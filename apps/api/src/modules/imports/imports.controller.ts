import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { EntityManager } from '@mikro-orm/postgresql';
import type {
  ApplyImportResultDto,
  ImportBatchDetailDto,
  ImportBatchDto,
} from '@fc/contracts';
import type { Response } from 'express';

import { DomainError } from '../../common/domain-error';
import { httpError, processHttpError } from '../../common/error-patterns';
import { Screenshot } from '../../database/entities';
import { ApplyImportDto } from './dto/apply-import.dto';
import { PatchRowDto } from './dto/patch-row.dto';
import { ImportsService } from './imports.service';
import { StorageService } from './storage.service';

const MAX_FILES = 20;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Снимки экрана и выгрузка ORTEC в PDF — два входа в один и тот же конвейер. */
const ALLOWED_MIME = /^(image\/(jpeg|png|webp)|application\/pdf)$/;

@Controller('imports')
export class ImportsController {
  constructor(
    private readonly imports: ImportsService,
    private readonly storage: StorageService,
    private readonly em: EntityManager,
  ) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES, {
      limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.test(file.mimetype)) {
          // multer ждёт готовое исключение: сюда `processHttpError` не дотянется
          cb(httpError(new DomainError('err.unsupported-file', { type: file.mimetype })), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(@UploadedFiles() files: Express.Multer.File[]): Promise<ImportBatchDto> {
    try {
      if (!files?.length) throw new DomainError('err.no-files');
      return await this.imports.createBatch(
        files.map((f) => ({ buffer: f.buffer, originalName: f.originalname })),
      );
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get()
  async list(): Promise<ImportBatchDto[]> {
    try {
      return await this.imports.list();
    } catch (error) {
      processHttpError(error);
    }
  }

  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string): Promise<ImportBatchDetailDto> {
    try {
      return await this.imports.getDetail(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  @Patch(':id/rows/:rowId')
  async patchRow(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('rowId', ParseUUIDPipe) rowId: string,
    @Body() dto: PatchRowDto,
  ): Promise<ImportBatchDetailDto> {
    try {
      return await this.imports.patchRow(id, rowId, dto);
    } catch (error) {
      processHttpError(error);
    }
  }

  @HttpCode(200)
  @Post(':id/apply')
  async apply(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyImportDto,
  ): Promise<ApplyImportResultDto> {
    try {
      return await this.imports.apply(id, dto.workDates);
    } catch (error) {
      processHttpError(error);
    }
  }

  @HttpCode(200)
  @Post(':id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<ImportBatchDto> {
    try {
      return await this.imports.cancel(id);
    } catch (error) {
      processHttpError(error);
    }
  }

  /** Исходный кадр — фронт показывает его рядом со строкой для сверки глазами. */
  @Get(':id/screenshots/:screenshotId/image')
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('screenshotId', ParseUUIDPipe) screenshotId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const screenshot = await this.em.findOne(Screenshot, { id: screenshotId, batch: { id } });
      if (!screenshot) throw new DomainError('err.screenshot-not-found');

      const buffer = await this.storage.read(screenshot.filePath);
      res.setHeader('Content-Type', screenshot.filePath.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.send(buffer);
    } catch (error) {
      processHttpError(error);
    }
  }
}
