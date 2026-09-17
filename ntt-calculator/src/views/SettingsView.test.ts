// @vitest-environment jsdom
/**
 * Настройки учётной записи: сотрудник заполняет свою карточку сам.
 *
 * ФИО, должность и телефон печатает блок исполнителя в КП, и до появления
 * этого экрана их правил только администратор. Роль и почту сотрудник менять
 * не может — иначе любой поднял бы себе права.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { updateProfile, logoutAll } = vi.hoisted(() => ({ updateProfile: vi.fn(), logoutAll: vi.fn() }))

const user = {
  id: 'u1',
  name: 'Иванов Сергей Владимирович',
  position: 'Инженер-конструктор',
  phone: null as string | null,
  email: 'eng@ntt.local',
  role: 'ENGINEER',
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user,
    role: user.role,
    updateProfile: (dto: unknown) => updateProfile(dto),
    logoutAll,
  }),
}))
vi.mock('@/stores/projects', () => ({ useProjectsStore: () => ({ clear: vi.fn() }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: SettingsView } = await import('./SettingsView.vue')

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  updateProfile.mockResolvedValue(undefined)
})

function mountView() {
  return mount(SettingsView, {
    global: { stubs: { ThemeToggle: true, ToastHost: true, ChangePasswordModal: true } },
  })
}

const fields = (w: ReturnType<typeof mountView>) => w.findAll('.fld input')
const saveBtn = (w: ReturnType<typeof mountView>) =>
  w.findAll('button').find((b) => b.text().includes('Сохранить'))!

describe('настройки: личные данные', () => {
  it('подставляет карточку из сессии', () => {
    const w = mountView()
    const [name, position, phone, email] = fields(w)

    expect((name!.element as HTMLInputElement).value).toBe('Иванов Сергей Владимирович')
    expect((position!.element as HTMLInputElement).value).toBe('Инженер-конструктор')
    expect((phone!.element as HTMLInputElement).value).toBe('')
    expect((email!.element as HTMLInputElement).value).toBe('eng@ntt.local')
  })

  it('почту меняет администратор — она только показана', () => {
    expect(fields(mountView())[3]!.attributes('disabled')).toBeDefined()
  })

  it('роль полем не показывается — сменить её себе нельзя', () => {
    const w = mountView()

    expect(w.findAll('.fld input')).toHaveLength(4)
    expect(w.find('.set-role').text()).toBe('Роль в программе: Инженер')
  })

  it('показывает, как имя будет напечатано в документе', async () => {
    const w = mountView()
    expect(w.text()).toContain('Иванов С.В.')

    await fields(w)[0]!.setValue('Князев Владимир Алексеевич')
    expect(w.text()).toContain('Князев В.А.')
  })

  it('сохраняет обрезанные значения, пустые поля — как «нет»', async () => {
    const w = mountView()
    await fields(w)[2]!.setValue('  +7 (499) 940-14-04 доб. 3041  ')
    await fields(w)[1]!.setValue('   ')
    await saveBtn(w).trigger('click')
    await flushPromises()

    expect(updateProfile).toHaveBeenCalledWith({
      name: 'Иванов Сергей Владимирович',
      position: null,
      phone: '+7 (499) 940-14-04 доб. 3041',
    })
  })

  it('без изменений сохранять нечего — кнопка выключена', async () => {
    const w = mountView()
    expect(saveBtn(w).attributes('disabled')).toBeDefined()

    await fields(w)[1]!.setValue('Ведущий инженер')
    expect(saveBtn(w).attributes('disabled')).toBeUndefined()
  })

  it('пустое ФИО не сохраняется: в КП нечего печатать', async () => {
    const w = mountView()
    await fields(w)[0]!.setValue('   ')
    await saveBtn(w).trigger('click')
    await flushPromises()

    expect(updateProfile).not.toHaveBeenCalled()
    expect(w.find('.auth-err').text()).toContain('Укажите ФИО')
  })

  it('отказ сервера виден на экране, а не только в консоли', async () => {
    updateProfile.mockRejectedValue({ response: { data: { message: 'Пользователь не найден' } } })
    const w = mountView()
    await fields(w)[1]!.setValue('Ведущий инженер')
    await saveBtn(w).trigger('click')
    await flushPromises()

    expect(w.find('.auth-err').text()).toBe('Пользователь не найден')
  })

  it('у каждой подписи поля есть сноска', () => {
    const captions = mountView().findAll('.fld > span')

    expect(captions).toHaveLength(4)
    expect(captions.filter((c) => c.attributes('data-hint') === undefined)).toHaveLength(0)
  })
})

describe('настройки: безопасность', () => {
  it('вторая вкладка держит смену пароля и выход на всех устройствах', async () => {
    const w = mountView()
    await w.findAll('.nav-link').find((b) => b.text() === 'Безопасность')!.trigger('click')

    const buttons = w.findAll('.set-actions button').map((b) => b.text())
    expect(buttons).toEqual(['Сменить пароль', 'Выйти на всех устройствах'])
    // Личные данные спрятаны: у вкладки своя форма.
    expect(w.findAll('.fld input')).toHaveLength(0)
  })
})
