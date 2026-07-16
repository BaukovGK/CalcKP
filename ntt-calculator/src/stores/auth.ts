import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type UserRole = 'ADMIN' | 'MANAGER' | 'ENGINEER' | 'BUYER' | 'VIEWER'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
}

const apiUrl = () => (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(
    JSON.parse(localStorage.getItem('ntt_user') ?? 'null')
  )
  const accessToken = ref<string | null>(localStorage.getItem('ntt_token'))

  const isLoggedIn = computed(() => !!user.value)
  const role = computed(() => user.value?.role ?? null)

  function _persist(u: AuthUser | null, token: string | null) {
    user.value = u
    accessToken.value = token
    u ? localStorage.setItem('ntt_user', JSON.stringify(u)) : localStorage.removeItem('ntt_user')
    token ? localStorage.setItem('ntt_token', token) : localStorage.removeItem('ntt_token')
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async function login(email: string, password: string): Promise<void> {
    const res = await fetch(`${apiUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Ошибка сервера' }))
      throw new Error(err.message ?? 'Неверный email или пароль')
    }
    const data = await res.json()
    _persist(data.user, data.accessToken)
    if (data.refreshToken) localStorage.setItem('ntt_refresh', data.refreshToken)
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
        await fetch(`${apiUrl()}/auth/logout`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken.value}` },
        })
      }
    } catch { /* ignore network errors on logout */ }
    localStorage.removeItem('ntt_refresh')
    _persist(null, null)
  }

  // ── Refresh ───────────────────────────────────────────────────────────────
  async function refresh(): Promise<boolean> {
    const refreshToken = localStorage.getItem('ntt_refresh')
    if (!refreshToken || refreshToken === 'demo-token') return !!user.value
    try {
      const res = await fetch(`${apiUrl()}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })
      if (!res.ok) { _persist(null, null); return false }
      const data = await res.json()
      _persist(user.value, data.accessToken)
      return true
    } catch {
      return false
    }
  }

  // ── Check auth on app start ────────────────────────────────────────────────
  async function checkAuth(): Promise<void> {
    if (!accessToken.value) return
    // Демо-токен не работает с backend — сбрасываем сессию
    if (accessToken.value === 'demo-token') {
      _persist(null, null)
      return
    }
    try {
      const res = await fetch(`${apiUrl()}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken.value}` },
      })
      if (!res.ok) { _persist(null, null); return }
      const data = await res.json()
      user.value = data as AuthUser
    } catch {
      // network error — keep cached user
    }
  }

  return { user, accessToken, isLoggedIn, role, login, loginDemo, logout, refresh, checkAuth }
})
