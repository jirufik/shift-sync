import { describe, expect, it, vi } from 'vitest';

import { isTransientError, retry } from './retry.util';

const httpError = (code: number, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`HTTP ${code}`), { code, ...extra });

describe('различение временных ошибок', () => {
  it('сетевые сбои считает временными', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
      expect(isTransientError(Object.assign(new Error('net'), { code }))).toBe(true);
    }
  });

  it('5xx и 429 считает временными', () => {
    for (const code of [429, 500, 502, 503, 504]) {
      expect(isTransientError(httpError(code))).toBe(true);
    }
  });

  it('ошибки запроса и доступа временными не считает', () => {
    for (const code of [400, 401, 404]) {
      expect(isTransientError(httpError(code))).toBe(false);
    }
  });

  it('403 различает по причине: квота — временная, нет прав — нет', () => {
    expect(isTransientError(httpError(403, { errors: [{ reason: 'rateLimitExceeded' }] }))).toBe(true);
    expect(isTransientError(httpError(403, { errors: [{ reason: 'forbidden' }] }))).toBe(false);
  });
});

describe('повторы', () => {
  it('возвращает результат первой удачной попытки', async () => {
    const op = vi.fn().mockResolvedValue('ок');
    await expect(retry(op)).resolves.toBe('ок');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('повторяет временную ошибку и отдаёт результат', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValue('ок');
    await expect(retry(op, { baseDelayMs: 1 })).resolves.toBe('ок');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('постоянную ошибку не повторяет', async () => {
    const op = vi.fn().mockRejectedValue(httpError(404));
    await expect(retry(op, { baseDelayMs: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('сдаётся после исчерпания попыток', async () => {
    const op = vi.fn().mockRejectedValue(httpError(503));
    await expect(retry(op, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('сообщает о каждом повторе', async () => {
    const onRetry = vi.fn();
    const op = vi.fn().mockRejectedValueOnce(httpError(500)).mockResolvedValue('ок');
    await retry(op, { baseDelayMs: 1, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][1]).toBe(1);
  });

  it('дополняет сообщение об ошибке названием операции', async () => {
    const op = vi.fn().mockRejectedValue(httpError(500));
    await expect(retry(op, { attempts: 2, baseDelayMs: 1, label: 'создание события' }))
      .rejects.toThrow(/создание события/)
  });
});
