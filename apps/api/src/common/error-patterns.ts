import { HttpException, HttpStatus, InternalServerErrorException } from '@nestjs/common';

import { DomainError } from './domain-error';

/**
 * Разделение ответственности:
 * процессы бросают доменные ошибки (`DomainError`), а перевод в HTTP-статус
 * живёт в контроллере. Благодаря этому бизнес-логика не знает про транспорт
 * и одинаково работает из HTTP, из фонового воркера и из теста.
 *
 * Статус подбирается по коду ошибки, а не по подстроке в её тексте (D-023).
 * Раньше таблица искала «не найден» и «нельзя» внутри русской фразы: правка
 * формулировки молча меняла код ответа с 404 на 500, и заметить это можно было
 * только по чужой жалобе. Код — точное совпадение, и он же едет клиенту.
 */
export interface ErrorPattern {
  /** код доменной ошибки */
  code: string;
  status: HttpStatus;
}

export const DEFAULT_ERROR_PATTERNS: ErrorPattern[] = [
  { code: 'err.batch-not-found', status: HttpStatus.NOT_FOUND },
  { code: 'err.row-not-found', status: HttpStatus.NOT_FOUND },
  { code: 'err.screenshot-not-found', status: HttpStatus.NOT_FOUND },
  { code: 'err.shift-missing', status: HttpStatus.NOT_FOUND },
  { code: 'err.no-files', status: HttpStatus.BAD_REQUEST },
  { code: 'err.unsupported-file', status: HttpStatus.BAD_REQUEST },
  { code: 'err.image-unreadable', status: HttpStatus.BAD_REQUEST },
  { code: 'err.pdf-unreadable', status: HttpStatus.BAD_REQUEST },
  { code: 'err.pdf-not-ortec', status: HttpStatus.BAD_REQUEST },
  { code: 'err.no-dates-selected', status: HttpStatus.BAD_REQUEST },
  { code: 'err.gcal-not-configured', status: HttpStatus.BAD_REQUEST },
  { code: 'err.edit-only-in-review', status: HttpStatus.CONFLICT },
  { code: 'err.apply-wrong-status', status: HttpStatus.CONFLICT },
  { code: 'err.applied-cannot-cancel', status: HttpStatus.CONFLICT },
  { code: 'err.login-required', status: HttpStatus.UNAUTHORIZED },
  { code: 'err.bad-password', status: HttpStatus.UNAUTHORIZED },
  { code: 'err.session-invalid', status: HttpStatus.UNAUTHORIZED },
];

/*
 * Строк для `err.create-without-target`, `err.update-without-sides`,
 * `err.delete-without-source` и `err.gcal-no-event-id` здесь нет намеренно.
 * Это нарушения инварианта внутри применения плана: их ловит цикл в
 * `ApplyProcess.apply` и кладёт в отчёт по конкретной дате, до контроллера они
 * не доходят. Если такая ошибка всё же долетит сюда, это значит, что путь
 * изменился, и пятисотка про это скажет.
 */

/**
 * Переводит доменную ошибку в HTTP-исключение. Всегда бросает — тип `never`
 * позволяет вызывать её в конце catch-блока без лишнего `throw`.
 *
 * В теле ответа рядом с текстом едут `code` и `params`: фразу для человека
 * собирает интерфейс, а `message` остаётся для журналов и для случаев, когда
 * ошибка родилась не у нас и кода у неё нет.
 */
export function processHttpError(
  error: unknown,
  patterns: ErrorPattern[] = DEFAULT_ERROR_PATTERNS,
): never {
  throw httpError(error, patterns);
}

/**
 * То же самое, но возвращает исключение вместо того, чтобы его бросить.
 *
 * Нужно там, где исключение передаётся обратным вызовом, а не бросается:
 * фильтр файлов multer ждёт `cb(error)` и до `try/catch` контроллера не
 * доходит.
 */
export function httpError(
  error: unknown,
  patterns: ErrorPattern[] = DEFAULT_ERROR_PATTERNS,
): HttpException {
  // исключения, уже пришедшие из Nest (валидация DTO, guard), пропускаем как есть
  if (error instanceof HttpException) return error;

  if (error instanceof DomainError) {
    // код без строки в таблице — наш недосмотр, а не ошибка запроса: пусть
    // будет видно в мониторинге пятисоткой, а не тихой четырёхсоткой
    const status =
      patterns.find((p) => p.code === error.code)?.status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    return new HttpException(
      { statusCode: status, message: error.message, code: error.code, params: error.params },
      status,
    );
  }

  return new InternalServerErrorException(error instanceof Error ? error.message : String(error));
}
