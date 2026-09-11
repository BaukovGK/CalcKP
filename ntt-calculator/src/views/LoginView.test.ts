// @vitest-environment jsdom
/**
 * Экран входа: демо-вход — только в dev-сборке, лимит попыток — понятным
 * текстом (План_устранения 2.2, 2.5).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { post, push } = vi.hoisted(() => ({ post: vi.fn(), push: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: { post } }
})
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

const { default: LoginView } = await import('./LoginView.vue')

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const demoButton = (w: ReturnType<typeof mount>) => w.findAll('button').find((b) => b.text().includes('демо'))

describe('экран входа', () => {
  it('в собранном приложении демо-входа нет', () => {
    vi.stubEnv('DEV', false)
    expect(demoButton(mount(LoginView))).toBeUndefined()
  })

  it('при разработке демо-вход есть', () => {
    vi.stubEnv('DEV', true)
    expect(demoButton(mount(LoginView))).toBeDefined()
  })

  it('лимит попыток без текста сервера — понятное сообщение, а не код ответа', async () => {
    post.mockRejectedValue(Object.assign(new Error('Request failed with status code 429'), { response: { status: 429, data: '<html>' } }))
    const w = mount(LoginView)
    await w.find('#email').setValue('eng@ntt.local')
    await w.find('#password').setValue('какой-то-пароль')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(w.find('.auth-err').text()).toBe('Слишком много попыток входа — подождите несколько минут')
    expect(push).not.toHaveBeenCalled()
  })
})
