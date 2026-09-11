// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'

const { post, get, del, refreshAccessToken } = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  refreshAccessToken: vi.fn(),
}))

// Стор ходит на сервер только через общий клиент — его и подменяем.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: { post, get, delete: del }, refreshAccessToken }
})

import { useAuthStore, type AuthUser } from './auth'
import { SESSION_KEYS } from '@/api/client'

const ENGINEER: AuthUser = { id: 'u1', name: 'Инженер', email: 'eng@ntt.local', role: 'ENGINEER' }

/** Ошибка клиента с ответом сервера — как её бросает axios. */
function httpError(status: number, message: string) {
  const config = { headers: {} } as InternalAxiosRequestConfig
  const response = { status, statusText: String(status), data: { message }, headers: {}, config } as AxiosResponse
  return new AxiosError(message, AxiosError.ERR_BAD_REQUEST, config, null, response)
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('стор авторизации', () => {
  it('вход — через клиент, без обновления токена на 401; сессия сохраняется', async () => {
    post.mockResolvedValue({ data: { accessToken: 'a1', refreshToken: 'r1', user: ENGINEER } })
    const auth = useAuthStore()

    await auth.login('eng@ntt.local', 'пароль')

    expect(post).toHaveBeenCalledWith('/auth/login', { email: 'eng@ntt.local', password: 'пароль' }, { skipAuthRefresh: true })
    expect(auth.user).toEqual(ENGINEER)
    expect(localStorage.getItem(SESSION_KEYS.access)).toBe('a1')
    expect(localStorage.getItem(SESSION_KEYS.refresh)).toBe('r1')
  })

  // LoginView показывает текст сервера из `response.data.message`.
  it('неверный пароль — ошибка с текстом сервера, сессии нет', async () => {
    post.mockRejectedValue(httpError(401, 'Неверный email или пароль'))
    const auth = useAuthStore()

    const err = await auth.login('eng@ntt.local', 'не тот').catch((e: unknown) => e)

    expect((err as AxiosError<{ message: string }>).response?.data.message).toBe('Неверный email или пароль')
    expect(auth.isLoggedIn).toBe(false)
    expect(localStorage.getItem(SESSION_KEYS.access)).toBeNull()
  })

  // Сервер берёт роль из БД на каждом запросе; экран — после сверки при старте.
  it('сверка при старте обновляет роль из кэша', async () => {
    localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ ...ENGINEER, role: 'ADMIN' }))
    localStorage.setItem(SESSION_KEYS.access, 'a1')
    get.mockResolvedValue({ data: ENGINEER })
    const auth = useAuthStore()
    expect(auth.role).toBe('ADMIN')

    await auth.checkAuth()

    expect(get).toHaveBeenCalledWith('/auth/me')
    expect(auth.role).toBe('ENGINEER')
    expect(JSON.parse(localStorage.getItem(SESSION_KEYS.user)!).role).toBe('ENGINEER')
  })

  it('сервер сказал «сессии нет» — выход; нет ответа — остаёмся с кэшем', async () => {
    localStorage.setItem(SESSION_KEYS.user, JSON.stringify(ENGINEER))
    localStorage.setItem(SESSION_KEYS.access, 'a1')

    get.mockRejectedValueOnce(new AxiosError('Network Error', AxiosError.ERR_NETWORK))
    const offline = useAuthStore()
    await offline.checkAuth()
    expect(offline.user).toEqual(ENGINEER)

    get.mockRejectedValueOnce(httpError(401, 'Пользователь не найден или заблокирован'))
    await offline.checkAuth()
    expect(offline.user).toBeNull()
    expect(localStorage.getItem(SESSION_KEYS.user)).toBeNull()
  })

  it('выход стирает сессию, даже если сервер не ответил', async () => {
    localStorage.setItem(SESSION_KEYS.user, JSON.stringify(ENGINEER))
    localStorage.setItem(SESSION_KEYS.access, 'a1')
    localStorage.setItem(SESSION_KEYS.refresh, 'r1')
    del.mockRejectedValue(new AxiosError('Network Error', AxiosError.ERR_NETWORK))
    const auth = useAuthStore()

    await auth.logout()

    expect(del).toHaveBeenCalledWith('/auth/logout', { skipAuthRefresh: true })
    expect(auth.user).toBeNull()
    for (const key of Object.values(SESSION_KEYS)) expect(localStorage.getItem(key)).toBeNull()
  })

  // План_устранения, 0.5: у смены пароля есть экран; 401 здесь — истёкший
  // токен, его клиент обновляет, поэтому skipAuthRefresh не ставится.
  it('смена пароля — через клиент, текущий и новый пароль', async () => {
    post.mockResolvedValue({ status: 204 })
    const auth = useAuthStore()

    await auth.changePassword('старый-пароль', 'новый-пароль')

    expect(post).toHaveBeenCalledWith('/auth/password', { currentPassword: 'старый-пароль', newPassword: 'новый-пароль' })
  })

  it('обновление токена — общий механизм клиента', async () => {
    localStorage.setItem(SESSION_KEYS.refresh, 'r1')
    const auth = useAuthStore()

    refreshAccessToken.mockResolvedValueOnce('a2')
    await expect(auth.refresh()).resolves.toBe(true)
    expect(auth.accessToken).toBe('a2')

    refreshAccessToken.mockResolvedValueOnce(null)
    await expect(auth.refresh()).resolves.toBe(false)
    expect(auth.accessToken).toBeNull()
  })

  it('демо-сессия сверку с сервером не проходит, но и не сбрасывается', async () => {
    const auth = useAuthStore()
    auth.loginDemo()

    await auth.checkAuth()

    expect(get).not.toHaveBeenCalled()
    expect(auth.user?.id).toBe('demo')
  })
})
