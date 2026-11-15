import { message, translate, type Message } from '@fc/contracts';

/**
 * Доменная ошибка: код и подстановки, а не готовая фраза (D-023).
 *
 * Процессы по-прежнему не знают про HTTP — статуса здесь нет, его подбирает
 * контроллер по коду (см. `error-patterns.ts`). Клиенту едут `code` и `params`,
 * фразу он собирает на своём языке; в `message` кладётся русский вариант из
 * того же словаря — читать `err.batch-not-found` в журнале неудобно.
 */
export class DomainError extends Error {
  readonly code: string;
  readonly params?: Record<string, string | number>;

  constructor(code: string, params?: Record<string, string | number>) {
    super(translate('ru', code, params));
    this.name = 'DomainError';
    this.code = code;
    this.params = params;
  }

  /** То же самое в виде сообщения для интерфейса. */
  toMessage(): Message {
    return message(this.code, this.params);
  }
}

/** Короткая форма: `fail('err.no-files')`, `fail('err.batch-not-found', { id })`. */
export function fail(code: string, params?: Record<string, string | number>): never {
  throw new DomainError(code, params);
}
