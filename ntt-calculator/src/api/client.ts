import axios from 'axios'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor: attach access token ───────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ntt_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // FormData: Content-Type должен ставить браузер — только он знает boundary
  // multipart-запроса. Дефолтный 'application/json' инстанса его затирает, и
  // сервер получает тело без границ (multer не видит файл -> 400).
  if (config.data instanceof FormData) delete config.headers['Content-Type']

  return config
})

// ── Response interceptor: auto-refresh on 401 ─────────────────────────────
let refreshing: Promise<string | null> | null = null

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }
    original._retry = true

    const refreshToken = localStorage.getItem('ntt_refresh')
    if (!refreshToken || refreshToken === 'demo-token') {
      // Нет рефреш-токена или демо-сессия — разлогинить
      localStorage.removeItem('ntt_token')
      localStorage.removeItem('ntt_refresh')
      localStorage.removeItem('ntt_user')
      window.location.href = '/login'
      return Promise.reject(error)
    }

    if (!refreshing) {
      refreshing = axios
        .post(`${API_URL}/auth/refresh`, { refreshToken })
        .then((r) => {
          const newToken: string = r.data.accessToken
          localStorage.setItem('ntt_token', newToken)
          return newToken
        })
        .catch(() => {
          localStorage.removeItem('ntt_token')
          localStorage.removeItem('ntt_refresh')
          localStorage.removeItem('ntt_user')
          window.location.href = '/login'
          return null
        })
        .finally(() => { refreshing = null })
    }

    const newToken = await refreshing
    if (!newToken) return Promise.reject(error)
    original.headers.Authorization = `Bearer ${newToken}`
    return api(original)
  }
)
