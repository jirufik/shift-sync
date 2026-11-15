import { translate, translateMessage, type Locale, type Message } from '@fc/contracts'

export type { Locale }

const KEY = 'fc:locale'

/**
 * Язык интерфейса.
 *
 * Словари живут в общем пакете: теми же кодами сервер объясняет, почему строка
 * не прошла шлюз (D-023). Сервер при этом фраз не сочиняет — он присылает код
 * и числа, а предложение собирается здесь.
 *
 * Язык ставится и на `<html lang>`: от него зависит не только чтение с экрана,
 * но и то, как браузер произносит и переносит текст.
 */
export function useI18n() {
  const locale = useState<Locale>('fc:locale', () => 'ru')

  function apply(next: Locale): void {
    locale.value = next
    if (!import.meta.client) return
    document.documentElement.setAttribute('lang', next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // приватный режим — язык просто не переживёт перезагрузку
    }
  }

  function restore(): void {
    if (!import.meta.client) return
    let stored: string | null = null
    try {
      stored = localStorage.getItem(KEY)
    } catch {
      stored = null
    }
    const guess: Locale = navigator.language?.startsWith('ru') ? 'ru' : 'en'
    apply(stored === 'ru' || stored === 'en' ? stored : guess)
  }

  const t = (key: string, params?: Record<string, string | number>): string =>
    translate(locale.value, key, params)

  /** Сообщение сервера: код и подстановки. */
  const message = (entry: Message | string | null | undefined): string =>
    translateMessage(locale.value, entry)

  return { locale, apply, restore, t, message }
}
