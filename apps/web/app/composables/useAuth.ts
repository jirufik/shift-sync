export function useAuth() {
  const api = useApi()
  const router = useRouter()
  const authed = useState<boolean>('fc:authed', () => false)

  async function login(password: string): Promise<void> {
    await api.post('/auth/login', { password })
    authed.value = true
  }

  async function check(): Promise<boolean> {
    try {
      // 401 здесь — обычный ответ «не залогинен». Уводит на логин route
      // middleware, и только он: две навигации подряд обрывают друг друга,
      // и вместо формы входа Nuxt рисует 500. Подробности — в useApi.
      await api.post('/auth/me', undefined, { redirectOn401: false })
      authed.value = true
    } catch {
      authed.value = false
    }
    return authed.value
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      authed.value = false
      await router.push('/login')
    }
  }

  return { authed, login, check, logout }
}
