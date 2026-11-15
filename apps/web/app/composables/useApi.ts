import type { Message } from '@fc/contracts'

/**
 * Единая точка обращения к backend. Cookie-сессия едет автоматически,
 * а 401 всюду означает одно и то же — сессия кончилась, надо на логин.
 *
 * Исключение — проверка сессии, она зовётся с `redirectOn401: false`.
 * Для неё 401 это обычный ответ «не залогинен», а не сбой. Если уводить
 * на логин и отсюда, навигация стартует изнутри route middleware, следом
 * middleware начинает свою — вторая обрывает первую, ошибка вылетает
 * наружу, и Nuxt показывает страницу 500.
 */
export type ApiOptions = { redirectOn401?: boolean }

export function useApi() {
  const router = useRouter()

  async function request<T>(
    path: string,
    options: Parameters<typeof $fetch>[1] = {},
    { redirectOn401 = true }: ApiOptions = {},
  ): Promise<T> {
    try {
      return await $fetch<T>(`/api${path}`, { credentials: 'include', ...options })
    } catch (error) {
      const status = (error as { statusCode?: number; status?: number }).statusCode
        ?? (error as { status?: number }).status
      if (redirectOn401 && status === 401 && router.currentRoute.value.path !== '/login') {
        await router.push('/login')
      }
      throw error
    }
  }

  return {
    get: <T>(path: string, opts?: ApiOptions) => request<T>(path, {}, opts),
    post: <T>(path: string, body?: unknown, opts?: ApiOptions) =>
      request<T>(path, { method: 'POST', body }, opts),
    patch: <T>(path: string, body?: unknown, opts?: ApiOptions) =>
      request<T>(path, { method: 'PATCH', body }, opts),
    upload: <T>(path: string, form: FormData, opts?: ApiOptions) =>
      request<T>(path, { method: 'POST', body: form }, opts),
  }
}

/** Похоже ли на код словаря: `err.no-files`, `msg.clipped`. */
const looksLikeCode = (value: string): boolean => /^[a-z]+\.[a-z-]+$/.test(value)

/**
 * Ошибка ответа в виде сообщения, а не готовой фразы.
 *
 * Здесь фраза не собирается намеренно: сохранённая строка застыла бы на языке,
 * который был выбран в момент сбоя, и переключение языка её бы не поправило.
 * Компонент хранит сообщение, а переводит уже в разметке — `{{ message(err) }}`.
 *
 * Валидация Nest присылает массив кодов; их бывает несколько, но на этом API
 * все они об одном и том же поле, поэтому берём первый.
 */
export function apiError(error: unknown): Message | string {
  const data = (error as { data?: { message?: string | string[]; code?: string; params?: Record<string, string | number> } }).data

  if (data?.code) return { code: data.code, params: data.params }

  const raw = Array.isArray(data?.message) ? data?.message[0] : data?.message
  if (typeof raw === 'string' && raw) return looksLikeCode(raw) ? { code: raw } : raw

  if (error instanceof Error && error.message) return error.message
  return { code: 'common.unknown' }
}
