import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

import { DomainError } from '../../common/domain-error';
import { AppConfigService } from '../../config/app-config.service';

export interface StoredScreenshot {
  /** путь относительно STORAGE_DIR */
  relativePath: string;
  sha256: string;
  width: number;
  height: number;
}

export interface StoredFile {
  /** путь относительно STORAGE_DIR */
  relativePath: string;
  sha256: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly cfg: AppConfigService) {}

  private absolute(relativePath: string): string {
    return join(this.cfg.storageDir, relativePath);
  }

  /**
   * Файлы раскладываются по датам, имя — хеш содержимого. Одинаковый кадр,
   * загруженный дважды, займёт одно место на диске.
   */
  async save(buffer: Buffer, originalName: string): Promise<StoredScreenshot> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const meta = await sharp(buffer).metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) {
      throw new DomainError('err.image-unreadable', { name: originalName });
    }

    const day = new Date().toISOString().slice(0, 10);
    const ext = (meta.format ?? 'jpg').replace('jpeg', 'jpg');
    const relativePath = join(day, `${sha256}.${ext}`);
    const target = this.absolute(relativePath);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);

    return { relativePath, sha256, width, height };
  }

  /**
   * Файл без картинки внутри — исходный PDF выгрузки.
   *
   * Он хранится рядом с отрисованными страницами: распознавание читает
   * текстовый слой из оригинала, а не из картинки, и без него импорт нельзя
   * было бы разобрать заново.
   */
  async saveRaw(buffer: Buffer, extension: string): Promise<StoredFile> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const day = new Date().toISOString().slice(0, 10);
    const relativePath = join(day, `${sha256}.${extension}`);
    const target = this.absolute(relativePath);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);

    return { relativePath, sha256 };
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolute(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    try {
      await unlink(this.absolute(relativePath));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }
}
