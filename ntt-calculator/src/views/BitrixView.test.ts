// @vitest-environment jsdom
/**
 * Вход из вкладки Битрикс24 (ТЗ §10.3): одноразовый код меняется на сессию,
 * прежняя сессия стирается; отказ сервера — понятным текстом и тем, что
 * делать дальше.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post, replace, query } = vi.hoisted(() => ({ post: vi.fn(), replace: vi.fn(), query: { value: {} as Record<string, string> } }))

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: { post } }
})
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace }),
  useRoute: () => ({ query: query.value }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const { default: BitrixView } = await import('./BitrixView.vue')
const { SESSION_KEYS } = await import('@/api/client')

const USER = { id: 'u1', name: 'Иванов Сергей Владимирович', email: 'ivanov@ntt.su', role: 'ENGINEER' }

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  query.value = {}
})

describe('вход из Битрикс24', () => {
  it('код меняется на сессию — и на главный экран', async () => {
    localStorage.setItem(SESSION_KEYS.refresh, 'чужой-refresh')
    query.value = { code: 'c1' }
    post.mockResolvedValue({ data: { accessToken: 'a1', refreshToken: 'r1', user: USER } })

    mount(BitrixView)
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/auth/bitrix/exchange', { code: 'c1' }, { skipAuthRefresh: true })
    expect(localStorage.getItem(SESSION_KEYS.access)).toBe('a1')
    expect(localStorage.getItem(SESSION_KEYS.refresh)).toBe('r1')
    expect(JSON.parse(localStorage.getItem(SESSION_KEYS.user)!)).toMatchObject({ email: 'ivanov@ntt.su' })
    expect(replace).toHaveBeenCalledWith('/')
  })

  it('код устарел — текст сервера и совет обновить вкладку', async () => {
    query.value = { code: 'old' }
    post.mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { message: 'Код входа устарел — откройте вкладку в Битрикс24 заново' } } })

    const w = mount(BitrixView)
    await flushPromises()

    expect(w.find('.auth-err').text()).toContain('Код входа устарел')
    expect(replace).not.toHaveBeenCalled()
    expect(localStorage.getItem(SESSION_KEYS.access)).toBeNull()
  })

  it('нет учётки — объясняет, что её заводит администратор по почте из портала', async () => {
    query.value = { error: 'no_account' }
    const w = mount(BitrixView)
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(w.find('.auth-err').text()).toContain('нет учётной записи')
    expect(w.text()).toContain('почту из Битрикс24')
  })

  it('незнакомая причина — общий текст, а не код', async () => {
    query.value = { error: 'что-то-новое' }
    const w = mount(BitrixView)
    await flushPromises()
    expect(w.find('.auth-err').text()).toBe('Войти не удалось.')
  })

  it('вне портала — запасной вход по паролю', async () => {
    query.value = { error: 'session' }
    const w = mount(BitrixView)
    await flushPromises()
    expect(w.find('a[href="/login"]').exists()).toBe(true)
  })
})
