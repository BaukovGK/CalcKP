// @vitest-environment jsdom
/**
 * Сброс пароля пользователю (План_устранения 2.1): администратор получает
 * временный пароль один раз, пользователь отмечен «сменит пароль при входе»;
 * свой пароль так не сбрасывают.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listUsers, resetPassword } = vi.hoisted(() => ({ listUsers: vi.fn(), resetPassword: vi.fn() }))

vi.mock('@/api/admin', () => ({
  adminApi: { listUsers: () => listUsers(), resetPassword: (id: string) => resetPassword(id) },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: AdminView } = await import('./AdminView.vue')
const { SESSION_KEYS } = await import('@/api/client')

const USERS = [
  { id: 'me', email: 'admin@ntt.local', name: 'Администратор', role: 'ADMIN', isActive: true, mustChangePassword: false, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'u2', email: 'eng@ntt.local', name: 'Инженер', role: 'ENGINEER', isActive: true, mustChangePassword: false, createdAt: '2026-09-02T00:00:00Z' },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ id: 'me', name: 'Администратор', email: 'admin@ntt.local', role: 'ADMIN' }))
  setActivePinia(createPinia())
  vi.clearAllMocks()
  listUsers.mockResolvedValue(USERS.map((u) => ({ ...u })))
})

async function mountView() {
  const w = mount(AdminView, { global: { stubs: { ThemeToggle: true, UserMenu: true } } })
  await flushPromises()
  return w
}

/** Строка пользователя — по email: имя встречается и в списке ролей соседних строк. */
const rowOf = (w: Awaited<ReturnType<typeof mountView>>, email: string) =>
  w.findAll('tbody tr').find((r) => r.find('.adm-email').exists() && r.find('.adm-email').text() === email)!

describe('администрирование: сброс пароля', () => {
  it('свой пароль здесь не сбрасывают — кнопка только у других', async () => {
    const w = await mountView()
    expect(rowOf(w, 'admin@ntt.local').find('.adm-reset').exists()).toBe(false)
    expect(rowOf(w, 'eng@ntt.local').find('.adm-reset').exists()).toBe(true)
  })

  it('сброс — после подтверждения; временный пароль показан один раз, пользователь отмечен', async () => {
    resetPassword.mockResolvedValue({ temporaryPassword: 'Tq7mZk2pXa9wLe' })
    const w = await mountView()

    await rowOf(w, 'eng@ntt.local').find('.adm-reset').trigger('click')
    expect(resetPassword).not.toHaveBeenCalled()
    await w.findAll('.mo button').find((b) => b.text() === 'Сбросить')!.trigger('click')
    await flushPromises()

    expect(resetPassword).toHaveBeenCalledWith('u2')
    expect(w.find('.adm-temp-pw').text()).toBe('Tq7mZk2pXa9wLe')
    expect(rowOf(w, 'eng@ntt.local').find('.adm-badge').text()).toBe('сменит пароль при входе')

    // «Готово» — окно закрыто, пароль из экрана ушёл.
    await w.findAll('.mo button').find((b) => b.text() === 'Готово')!.trigger('click')
    expect(w.find('.adm-temp-pw').exists()).toBe(false)
    expect(w.html()).not.toContain('Tq7mZk2pXa9wLe')
  })

  it('отказ сервера — текст в окне подтверждения', async () => {
    resetPassword.mockRejectedValue({ response: { data: { message: 'Пользователь не найден' } } })
    const w = await mountView()

    await rowOf(w, 'eng@ntt.local').find('.adm-reset').trigger('click')
    await w.findAll('.mo button').find((b) => b.text() === 'Сбросить')!.trigger('click')
    await flushPromises()

    expect(w.find('.mo .auth-err').text()).toBe('Пользователь не найден')
  })
})
