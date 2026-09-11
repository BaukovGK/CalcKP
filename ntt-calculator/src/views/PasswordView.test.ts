// @vitest-environment jsdom
/**
 * Экран обязательной смены пароля (План_устранения 2.1): после смены — туда,
 * куда шли; выход — на вход.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post, del, replace, push } = vi.hoisted(() => ({ post: vi.fn(), del: vi.fn(), replace: vi.fn(), push: vi.fn() }))

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: { post, delete: del } }
})
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { redirect: '/projects/p1' } }),
  useRouter: () => ({ replace, push }),
}))

const { default: PasswordView } = await import('./PasswordView.vue')
const { useAuthStore } = await import('@/stores/auth')
const { SESSION_KEYS } = await import('@/api/client')

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ id: 'u1', name: 'Админ', email: 'admin@ntt.local', role: 'ADMIN', mustChangePassword: true }))
  localStorage.setItem(SESSION_KEYS.access, 'a1')
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

function mountView() {
  return mount(PasswordView, { global: { stubs: { ToastHost: true } } })
}

describe('экран обязательной смены пароля', () => {
  it('сменил — отметка снята, возврат туда, куда шли', async () => {
    post.mockResolvedValue({ data: undefined })
    const w = mountView()
    await w.find('#pw-current').setValue('временный-пароль')
    await w.find('#pw-next').setValue('новый-пароль-1')
    await w.find('#pw-repeat').setValue('новый-пароль-1')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/auth/password', { currentPassword: 'временный-пароль', newPassword: 'новый-пароль-1' })
    expect(useAuthStore().mustChangePassword).toBe(false)
    expect(replace).toHaveBeenCalledWith('/projects/p1')
  })

  it('короткий новый пароль — на сервер не уходит, экран объясняет', async () => {
    const w = mountView()
    await w.find('#pw-current').setValue('временный-пароль')
    await w.find('#pw-next').setValue('корот')
    await w.find('#pw-repeat').setValue('корот')
    await w.find('form').trigger('submit')
    await flushPromises()

    expect(post).not.toHaveBeenCalled()
    expect(w.find('.auth-err').text()).toContain('8')
    expect(replace).not.toHaveBeenCalled()
  })

  it('выйти — на вход', async () => {
    del.mockResolvedValue({ data: undefined })
    const w = mountView()
    await w.findAll('button').find((b) => b.text() === 'Выйти')!.trigger('click')
    await flushPromises()

    expect(push).toHaveBeenCalledWith('/login')
    expect(useAuthStore().isLoggedIn).toBe(false)
  })
})
