import type { Locale, Message } from '../common.js';

import { EN } from './en.js';
import { RU } from './ru.js';

export { EN, RU };

export const LOCALES: Locale[] = ['ru', 'en'];

const DICTS: Record<Locale, Record<string, string>> = { ru: RU, en: EN };

/**
 * Перевод по ключу с подстановками в фигурных скобках.
 *
 * Словари лежат в общем пакете, а не во фронте: теми же кодами сервер
 * объясняет, почему строка не прошла шлюз. Две копии словаря разъехались бы на
 * первой же правке формулировки, и заметили бы это только на английском экране.
 */
export function translate(
  locale: Locale,
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = DICTS[locale]?.[key] ?? RU[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    params[name] === undefined ? whole : String(params[name]),
  );
}

/**
 * Сообщение от сервера: код плюс подстановки.
 *
 * Строка принимается тоже: в строках, распознанных до перехода на коды, лежит
 * готовая русская фраза. Отдать её как есть честнее, чем показать
 * `msg.undefined` вместо причины.
 */
export function translateMessage(
  locale: Locale,
  entry: Message | string | null | undefined,
): string {
  if (entry === null || entry === undefined) return '';
  if (typeof entry === 'string') return entry;
  if (!entry.code) return '';
  return translate(locale, entry.code, entry.params);
}
