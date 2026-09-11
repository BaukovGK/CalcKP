// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { api, passwordChangeRequired, refreshAccessToken, sessionLost, SESSION_KEYS } from './client'

/** Сервер теста: 401 на токен `old`, остальным — 200 с заголовком, который пришёл. */
function server(opts: { always401?: boolean } = {}): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig) => {
    const auth = String(config.headers?.Authorization ?? '')
    const response = (status: number, data: unknown): AxiosResponse => ({ status, statusText: String(status), data, headers: {}, config })
    if (opts.always401 || auth === 'Bearer old') {
      throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, null, response(401, { message: 'Недействительный или истёкший токен' }))
    }
    return response(200, { auth })
  }
}

const originalAdapter = api.defaults.adapter
const redirect = vi.fn()

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(SESSION_KEYS.access, 'old')
  localStorage.setItem(SESSION_KEYS.refresh, 'r1')
  localStorage.setItem(SESSION_KEYS.user, '{"id":"u1"}')
  sessionLost.redirect = redirect
  redirect.mockClear()
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  vi.restoreAllMocks()
})

describe('клиент API: обновление токена на 401', () => {
  it('истёкший токен обновляется один раз на все запросы, а запросы повторяются', async () => {
    api.defaults.adapter = server()
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: { accessToken: 'new' } })

    const [a, b] = await Promise.all([api.get('/projects'), api.get('/estimates')])

    expect(a.data).toEqual({ auth: 'Bearer new' })
    expect(b.data).toEqual({ auth: 'Bearer new' })
    expect(post).toHaveBeenCalledTimes(1)
    // Адрес API зависит от окружения (VITE_API_URL) — важен путь.
    expect(post).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/refresh$/), { refreshToken: 'r1' })
    expect(localStorage.getItem(SESSION_KEYS.access)).toBe('new')
  })

  // Вход и выход: 401 значит «неверный пароль» или «сессии уже нет».
  it('skipAuthRefresh — 401 уходит вызывающему, токен не обновляется', async () => {
    api.defaults.adapter = server({ always401: true })
    const post = vi.spyOn(axios, 'post')

    const err = await api.post('/auth/login', {}, { skipAuthRefresh: true }).catch((e: unknown) => e)

    expect(axios.isAxiosError(err) && err.response?.status).toBe(401)
    expect(post).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_KEYS.refresh)).toBe('r1')
    expect(redirect).not.toHaveBeenCalled()
  })

  it('сервер отказал в обновлении — сессия стирается, переход на вход', async () => {
    api.defaults.adapter = server()
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('401'))

    await expect(api.get('/projects')).rejects.toBeTruthy()

    expect(localStorage.getItem(SESSION_KEYS.access)).toBeNull()
    expect(localStorage.getItem(SESSION_KEYS.refresh)).toBeNull()
    expect(localStorage.getItem(SESSION_KEYS.user)).toBeNull()
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('без refresh-токена обновлять нечем', async () => {
    localStorage.removeItem(SESSION_KEYS.refresh)
    const post = vi.spyOn(axios, 'post')
    await expect(refreshAccessToken()).resolves.toBeNull()
    expect(post).not.toHaveBeenCalled()
  })
})

// План_устранения 2.1: сервер закрыл API до смены пароля — клиент ведёт на
// экран смены, а кэш пользователя помечает: после перезагрузки роутер держит там же.
describe('клиент API: сервер требует сменить пароль', () => {
  it('403 PASSWORD_CHANGE_REQUIRED — на экран смены пароля, сессия цела', async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const response = { status: 403, statusText: '403', data: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Сначала смените пароль' }, headers: {}, config } as AxiosResponse
      throw new AxiosError('Forbidden', AxiosError.ERR_BAD_REQUEST, config, null, response)
    }
    const toPassword = vi.fn()
    passwordChangeRequired.redirect = toPassword

    await expect(api.get('/projects')).rejects.toBeInstanceOf(AxiosError)

    expect(toPassword).toHaveBeenCalledTimes(1)
    expect(redirect).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(SESSION_KEYS.user)!)).toEqual({ id: 'u1', mustChangePassword: true })
    expect(localStorage.getItem(SESSION_KEYS.access)).toBe('old')
  })
})
