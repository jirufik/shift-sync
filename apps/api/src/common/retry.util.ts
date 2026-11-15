/**
 * Повтор операции с экспоненциальной задержкой и полным джиттером.
 *
 * Джиттер здесь не украшение: без него несколько параллельных повторов
 * синхронизируются и бьют по внешнему сервису одной волной ровно в тот момент,
 * когда он и так нездоров.
 */

export interface RetryOptions {
  /** сколько всего попыток, включая первую */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** повторять ли эту ошибку; по умолчанию повторяются только сетевые и 5xx */
  isRetryable?: (error: unknown) => boolean;
  /** вызывается перед каждой паузой — для журнала */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** имя операции для сообщений об ошибке */
  label?: string;
}

const DEFAULTS = {
  attempts: 4,
  baseDelayMs: 400,
  maxDelayMs: 8_000,
} as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Коды сетевых сбоев, при которых повтор осмыслен. */
const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ESOCKETTIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** HTTP-статусы, при которых повтор осмыслен. */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function statusOf(error: unknown): number | undefined {
  const e = error as { code?: unknown; status?: number; response?: { status?: number } };
  if (typeof e?.code === 'number') return e.code;
  return e?.status ?? e?.response?.status;
}

/**
 * Ошибка похожа на временную?
 *
 * Отдельный случай — Google отдаёт 403 и на «нет прав», и на «превышена
 * квота». Первое повторять бессмысленно, второе — обязательно, поэтому
 * различаем по причине внутри ответа.
 */
export function isTransientError(error: unknown): boolean {
  const e = error as { code?: unknown; errors?: Array<{ reason?: string }>; message?: string };

  if (typeof e?.code === 'string' && TRANSIENT_CODES.has(e.code)) return true;

  const status = statusOf(error);
  if (status !== undefined && TRANSIENT_STATUSES.has(status)) return true;

  if (status === 403) {
    const reasons = (e?.errors ?? []).map((x) => x.reason ?? '');
    return reasons.some((r) => r === 'rateLimitExceeded' || r === 'userRateLimitExceeded');
  }

  // на случай, когда причина осталась только в тексте
  return /socket hang up|network|timeout|temporarily unavailable/i.test(e?.message ?? '');
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const isRetryable = options.isRetryable ?? isTransientError;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const canRetry = attempt < attempts && isRetryable(error);
      if (!canRetry) break;

      // экспонента с полным джиттером: пауза равномерна на [0, cap]
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(Math.random() * cap);

      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }

  if (options.label && lastError instanceof Error) {
    lastError.message = `${options.label}: ${lastError.message}`;
  }
  throw lastError;
}
