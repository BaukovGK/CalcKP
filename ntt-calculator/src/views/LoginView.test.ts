// @vitest-environment jsdom
/**
 * Экран входа: демо-вход — только в dev-сборке, лимит попыток — понятным
 * текстом (План_устранения 2.2, 2.5), логин — только латиницей.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { installLatinGuard, LATIN_ONLY_HINT } from '@/utils/latin-input'

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

// Логин, набранный в русской раскладке, выглядит как настоящий адрес, но не
// совпадёт ни с одной учётной записью — и человек ищет ошибку в пароле.
describe('экран входа: логин латиницей', () => {
  it('кириллица с клавиатуры в поле не попадает, а экран говорит про раскладку', async () => {
    const off = installLatinGuard(document)
    const w = mount(LoginView, { attachTo: document.body })
    const el = w.find('#email').element as HTMLInputElement

    const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: 'ф', bubbles: true, cancelable: true })
    el.dispatchEvent(ev)
    await nextTick()

    expect(ev.defaultPrevented).toBe(true)
    expect(el.value).toBe('')
    expect(w.find('.auth-note').text()).toBe(LATIN_ONLY_HINT)

    off()
    w.unmount()
  })

  it('вставленный адрес в русской раскладке чистится, подсказка уходит после верного ввода', async () => {
    const off = installLatinGuard(document)
    const w = mount(LoginView, { attachTo: document.body })
    const input = w.find('#email')

    await input.setValue('фвьшт@тее.дщсфд')
    expect((input.element as HTMLInputElement).value).toBe('@.')
    expect(w.find('.auth-note').exists()).toBe(true)

    await input.setValue('admin@ntt.local')
    expect(w.find('.auth-note').exists()).toBe(false)

    off()
    w.unmount()
  })
})
