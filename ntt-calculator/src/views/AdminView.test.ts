// @vitest-environment jsdom
/**
 * Сброс пароля пользователю (План_устранения 2.1): администратор получает
 * временный пароль один раз, пользователь отмечен «сменит пароль при входе»;
 * свой пароль так не сбрасывают.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listUsers, resetPassword, patchUser, createUser } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  resetPassword: vi.fn(),
  patchUser: vi.fn(),
  createUser: vi.fn(),
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    listUsers: () => listUsers(),
    resetPassword: (id: string) => resetPassword(id),
    patchUser: (id: string, dto: unknown) => patchUser(id, dto),
    createUser: (dto: unknown) => createUser(dto),
  },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: AdminView } = await import('./AdminView.vue')
const { SESSION_KEYS } = await import('@/api/client')

const USERS = [
  { id: 'me', email: 'admin@ntt.local', name: 'Администратор', position: null, phone: null, role: 'ADMIN', isActive: true, mustChangePassword: false, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'u2', email: 'eng@ntt.local', name: 'Иванов Сергей Владимирович', position: 'Инженер-конструктор', phone: null, role: 'ENGINEER', isActive: true, mustChangePassword: false, createdAt: '2026-09-02T00:00:00Z' },
]

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ id: 'me', name: 'Администратор', email: 'admin@ntt.local', role: 'ADMIN' }))
  setActivePinia(createPinia())
  vi.clearAllMocks()
  listUsers.mockResolvedValue(USERS.map((u) => ({ ...u })))
  patchUser.mockImplementation((id: string, dto: Record<string, unknown>) => {
    const user = USERS.find((u) => u.id === id)!
    return Promise.resolve({ ...user, ...dto })
  })
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

/**
 * ФИО, должность и телефон сотрудника: их печатает блок исполнителя КП
 * (`backend/utils/kp-terms.ts`), поэтому карточка должна их и хранить, и
 * позволять дополнить у давно заведённых учёток.
 */
describe('администрирование: карточка сотрудника', () => {
  const inputs = (w: Awaited<ReturnType<typeof mountView>>, email: string) =>
    rowOf(w, email).findAll('input.adm-inline')

  it('показывает ФИО, должность и телефон строками правки', async () => {
    const w = await mountView()
    const [name, position, phone] = inputs(w, 'eng@ntt.local')

    expect((name!.element as HTMLInputElement).value).toBe('Иванов Сергей Владимирович')
    expect((position!.element as HTMLInputElement).value).toBe('Инженер-конструктор')
    expect((phone!.element as HTMLInputElement).value).toBe('')
  })

  it('должность и телефон дописываются на месте', async () => {
    const w = await mountView()
    const [, position, phone] = inputs(w, 'eng@ntt.local')

    await position!.setValue('Ведущий инженер')
    await position!.trigger('change')
    await flushPromises()
    expect(patchUser).toHaveBeenCalledWith('u2', { position: 'Ведущий инженер' })

    await phone!.setValue(' +7 (499) 940-14-04 доб. 3041 ')
    await phone!.trigger('change')
    await flushPromises()
    expect(patchUser).toHaveBeenCalledWith('u2', { phone: '+7 (499) 940-14-04 доб. 3041' })
  })

  it('пустое ФИО не сохраняется — сервер такую правку и не примет', async () => {
    const w = await mountView()
    const [name] = inputs(w, 'eng@ntt.local')

    await name!.setValue('   ')
    await name!.trigger('change')
    await flushPromises()

    expect(patchUser).not.toHaveBeenCalled()
    // Поле вернулось к сохранённому значению, а не осталось пустым.
    expect((name!.element as HTMLInputElement).value).toBe('Иванов Сергей Владимирович')
  })

  it('новая учётная запись заводится с должностью и телефоном', async () => {
    createUser.mockResolvedValue({
      id: 'u3', email: 'new@ntt.local', name: 'Петров Пётр Петрович',
      position: 'Менеджер', phone: '+7 (499) 000-00-00', role: 'MANAGER',
      isActive: true, mustChangePassword: true, createdAt: '2026-09-17T00:00:00Z',
    })
    const w = await mountView()
    await w.findAll('button').find((b) => b.text().includes('Новый пользователь'))!.trigger('click')

    const fields = w.findAll('.mo .ff input')
    await fields[0]!.setValue('Петров Пётр Петрович')
    await fields[1]!.setValue('Менеджер')
    await fields[2]!.setValue('+7 (499) 000-00-00')
    await fields[3]!.setValue('new@ntt.local')
    await w.findAll('.mo .ff input[type="password"]')[0]!.setValue('password123')
    await w.findAll('.mo button').find((b) => b.text() === 'Создать')!.trigger('click')
    await flushPromises()

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Петров Пётр Петрович',
        position: 'Менеджер',
        phone: '+7 (499) 000-00-00',
        email: 'new@ntt.local',
      }),
    )
  })
})
