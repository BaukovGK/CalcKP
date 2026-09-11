import axios from 'axios'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

/** Ключи сессии в localStorage — один набор на клиент и стор авторизации. */
export const SESSION_KEYS = { user: 'ntt_user', access: 'ntt_token', refresh: 'ntt_refresh' } as const

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Не обновлять токен на 401: у входа и выхода 401 означает «неверный
     * пароль» или «сессии уже нет», а не истёкший токен доступа.
     */
    skipAuthRefresh?: boolean
  }
}

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

/**
 * Куда уходить, когда сессии больше нет, — на вход. Объект, а не функция:
 * тест подменяет переход, не трогая `window.location`.
 */
export const sessionLost = {
  redirect: () => {
    window.location.href = '/login'
  },
}

/**
 * Куда уходить, когда сервер требует сменить пароль (403
 * `PASSWORD_CHANGE_REQUIRED`, План_устранения 2.1): на экран смены. Кэш
 * пользователя помечается — после перезагрузки роутер держит там же.
 */
export const passwordChangeRequired = {
  redirect: () => {
    if (window.location.pathname !== '/password') window.location.href = '/password'
  },
}

function markPasswordChangeRequired(): void {
  try {
    const cached = JSON.parse(localStorage.getItem(SESSION_KEYS.user) ?? 'null') as Record<string, unknown> | null
    if (cached) localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ ...cached, mustChangePassword: true }))
  } catch { /* кэш испорчен — роутер сверит сессию с сервером */ }
}

/** Сессии больше нет: токены и кэш пользователя стираются. */
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEYS.access)
  localStorage.removeItem(SESSION_KEYS.refresh)
  localStorage.removeItem(SESSION_KEYS.user)
}

// ── Request interceptor: attach access token ───────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(SESSION_KEYS.access)
  if (token) config.headers.Authorization = `Bearer ${token}`

  // FormData: Content-Type должен ставить браузер — только он знает boundary
  // multipart-запроса. Дефолтный 'application/json' инстанса его затирает, и
  // сервер получает тело без границ (multer не видит файл -> 400).
  if (config.data instanceof FormData) delete config.headers['Content-Type']

  return config
})

// ── Обновление токена доступа ──────────────────────────────────────────────
let refreshing: Promise<string | null> | null = null

/**
 * Новый токен доступа по refresh-токену; `null` — обновить нечем или сервер
 * отказал. Одновременные запросы ждут одно обновление, а не шлют по своему.
 * Им пользуются и перехватчик 401, и стор авторизации.
 */
export function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem(SESSION_KEYS.refresh)
  if (!refreshToken || refreshToken === 'demo-token') return Promise.resolve(null)
  if (!refreshing) {
    // Голый axios, не `api`: иначе 401 обновления снова пришёл бы сюда.
    refreshing = axios
      .post<{ accessToken: string }>(`${API_URL}/auth/refresh`, { refreshToken })
      .then((r) => {
        localStorage.setItem(SESSION_KEYS.access, r.data.accessToken)
        return r.data.accessToken
      })
      .catch(() => null)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

// ── Response interceptor: auto-refresh on 401 ─────────────────────────────
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 403 && error.response.data?.code === 'PASSWORD_CHANGE_REQUIRED') {
      markPasswordChangeRequired()
      passwordChangeRequired.redirect()
      return Promise.reject(error)
    }
    if (error.response?.status !== 401 || !original || original._retry || original.skipAuthRefresh) {
      return Promise.reject(error)
    }
    original._retry = true

    const newToken = await refreshAccessToken()
    if (!newToken) {
      // Обновить нечем или сервер отказал — сессии нет: на вход.
      clearSession()
      sessionLost.redirect()
      return Promise.reject(error)
    }
    original.headers.Authorization = `Bearer ${newToken}`
    return api(original)
  }
)
