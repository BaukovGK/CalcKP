import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import axios from 'axios'
import { api, clearSession, refreshAccessToken, SESSION_KEYS } from '@/api/client'

export type UserRole = 'ADMIN' | 'MANAGER' | 'ENGINEER' | 'TECHNOLOG' | 'BUYER' | 'VIEWER'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
}

/**
 * Сессия пользователя. Все запросы — через общий клиент (`api/client.ts`):
 * базовый адрес, заголовок авторизации и обновление токена на 401 у стора
 * и у остального приложения одни. Прежде стор держал свой `fetch` с
 * собственным адресом и без обновления токена (План_реализации §4.2 №7).
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(
    JSON.parse(localStorage.getItem(SESSION_KEYS.user) ?? 'null')
  )
  const accessToken = ref<string | null>(localStorage.getItem(SESSION_KEYS.access))

  const isLoggedIn = computed(() => !!user.value)
  const role = computed(() => user.value?.role ?? null)

  function _persist(u: AuthUser | null, token: string | null) {
    user.value = u
    accessToken.value = token
    if (u) localStorage.setItem(SESSION_KEYS.user, JSON.stringify(u))
    else localStorage.removeItem(SESSION_KEYS.user)

    if (token) localStorage.setItem(SESSION_KEYS.access, token)
    else localStorage.removeItem(SESSION_KEYS.access)
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  // Ошибка — как у любого запроса клиента: текст сервера в `response.data`.
  async function login(email: string, password: string): Promise<void> {
    const { data } = await api.post<{ accessToken: string; refreshToken?: string; user: AuthUser }>(
      '/auth/login',
      { email, password },
      // 401 здесь — «неверный email или пароль», а не истёкший токен.
      { skipAuthRefresh: true },
    )
    _persist(data.user, data.accessToken)
    if (data.refreshToken) localStorage.setItem(SESSION_KEYS.refresh, data.refreshToken)
  }

  // ── Demo login (без backend) ───────────────────────────────────────────────
  // TODO: удалить loginDemo() когда backend стабильно работает в dev-окружении.
  //       Пока оставляем для оффлайн-демонстраций. Кнопка видна только в LoginView.
  function loginDemo() {
    _persist(
      { id: 'demo', name: 'Демо-пользователь', email: 'demo@ntt.local', role: 'MANAGER' },
      'demo-token'
    )
  }

  // ── Logout ────────────────────────────────────────────────────────────────
  async function logout(): Promise<void> {
    try {
      if (accessToken.value && accessToken.value !== 'demo-token') {
        await api.delete('/auth/logout', { skipAuthRefresh: true })
      }
    } catch { /* сеть или сессия уже истекла — выходим всё равно */ }
    clearSession()
    _persist(null, null)
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  async function refresh(): Promise<boolean> {
    if (localStorage.getItem(SESSION_KEYS.refresh) === 'demo-token') return !!user.value
    const token = await refreshAccessToken()
    if (!token) { _persist(null, null); return false }
    accessToken.value = token
    return true
  }

  // ── Check auth on app start ────────────────────────────────────────────────
  /**
   * Сверяет сессию с сервером: кто пользователь и какая у него роль сейчас.
   * Кэш в localStorage мог устареть — роль сменили или учётку заблокировали;
   * сервер это видит на каждом запросе, а экран — после этой проверки.
   * Истёкший токен доступа обновит клиент; сеть недоступна — остаётся кэш.
   */
  async function checkAuth(): Promise<void> {
    if (!accessToken.value) return
    // Демо-сессия с сервером не работает: без пользователя — сбрасывается.
    if (accessToken.value === 'demo-token') {
      if (!user.value) _persist(null, null)
      return
    }
    try {
      const { data } = await api.get<AuthUser>('/auth/me')
      _persist(data, localStorage.getItem(SESSION_KEYS.access))
    } catch (e) {
      // Ответ сервера — сессии нет; нет ответа — сеть, остаёмся с кэшем.
      if (axios.isAxiosError(e) && e.response) _persist(null, null)
    }
  }

  return { user, accessToken, isLoggedIn, role, login, loginDemo, logout, refresh, checkAuth }
})
