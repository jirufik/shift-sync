import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { DomainError } from './domain-error';
import { processHttpError } from './error-patterns';

const statusOf = (error: unknown): number => {
  try {
    processHttpError(error);
  } catch (e) {
    return (e as HttpException).getStatus();
  }
  throw new Error('processHttpError обязана бросать');
};

const bodyOf = (error: unknown): Record<string, unknown> => {
  try {
    processHttpError(error);
  } catch (e) {
    return (e as HttpException).getResponse() as Record<string, unknown>;
  }
  throw new Error('processHttpError обязана бросать');
};

describe('перевод доменных ошибок в HTTP', () => {
  it('«импорт не найден» → 404', () => {
    expect(statusOf(new DomainError('err.batch-not-found', { id: 'abc' }))).toBe(
      HttpStatus.NOT_FOUND,
    );
  });

  it('«календарь не настроен» → 400', () => {
    expect(statusOf(new DomainError('err.gcal-not-configured'))).toBe(HttpStatus.BAD_REQUEST);
  });

  it('«нельзя применить в этом статусе» → 409', () => {
    expect(statusOf(new DomainError('err.apply-wrong-status', { status: 'applied' }))).toBe(
      HttpStatus.CONFLICT,
    );
  });

  it('незнакомая ошибка → 500', () => {
    expect(statusOf(new Error('внезапно всё сломалось'))).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('доменный код без строки в таблице → 500, а не тихая четырёхсотка', () => {
    expect(statusOf(new DomainError('err.никому-не-известный'))).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('исключение Nest пропускается как есть', () => {
    const original = new NotFoundException('уже HTTP');
    let caught: unknown;
    try {
      processHttpError(original);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(original);
  });

  it('код и подстановки доходят до клиента — фразу он соберёт сам', () => {
    expect(bodyOf(new DomainError('err.batch-not-found', { id: 'xyz' }))).toMatchObject({
      code: 'err.batch-not-found',
      params: { id: 'xyz' },
    });
  });

  it('в журнал при этом попадает читаемый русский текст', () => {
    expect(new DomainError('err.batch-not-found', { id: 'xyz' }).message).toBe(
      'Импорт xyz не найден',
    );
  });
});
