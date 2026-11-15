/** Время суток в виде `HH:MM`. Смены не пересекают полночь, поэтому end > start всегда. */
export type TimeOfDay = string;

/** Календарная дата в виде `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * Сообщение для человека: код и подстановки, а не готовая фраза.
 *
 * Сервер не сочиняет текст — он сообщает, что произошло и с какими числами, а
 * предложение собирает интерфейс на выбранном языке (D-023). Так обе версии
 * лежат в одном месте и не могут разъехаться, а тесты проверяют коды, а не
 * формулировки, и не падают от переставленной запятой.
 */
export interface Message {
  code: string;
  params?: Record<string, string | number>;
}

export const message = (code: string, params?: Record<string, string | number>): Message =>
  params ? { code, params } : { code };

/** Язык интерфейса. Их два — см. D-023. */
export type Locale = 'ru' | 'en';

/**
 * Ошибка API.
 *
 * `code` и `params` — то же сообщение, что и везде: фразу собирает фронт.
 * `message` остаётся для логов и для случаев, когда ошибка родилась не у нас
 * (валидация Nest, прокси, сеть) и кода у неё нет.
 */
export interface ApiError {
  statusCode: number;
  message: string;
  code?: string;
  params?: Record<string, string | number>;
  error?: string;
}
