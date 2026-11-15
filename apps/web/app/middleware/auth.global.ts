/** Всё закрыто, кроме логина. Проверка идёт один раз за загрузку приложения. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path === '/login') return

  const { authed, check } = useAuth()
  if (authed.value) return

  const ok = await check()
  if (!ok) return navigateTo('/login')
})
