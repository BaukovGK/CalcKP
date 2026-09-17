// @vitest-environment jsdom
/**
 * Сброс пароля пользователю (План_устранения 2.1): администратор получает
 * временный пароль один раз, пользователь отмечен «сменит пароль при входе»;
 * свой пароль так не сбрасывают.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listUsers, resetPassword, patchUser, createUser, listAudit, auditActions } = vi.hoisted(() => ({
  listUsers: vi.fn(),
  resetPassword: vi.fn(),
  patchUser: vi.fn(),
  createUser: vi.fn(),
  listAudit: vi.fn(),
  auditActions: vi.fn(),
}))

vi.mock('@/api/admin', () => ({
  adminApi: {
    listUsers: () => listUsers(),
    resetPassword: (id: string) => resetPassword(id),
    patchUser: (id: string, dto: unknown) => patchUser(id, dto),
    createUser: (dto: unknown) => createUser(dto),
    listAudit: (filter: unknown) => listAudit(filter),
    auditActions: () => auditActions(),
  },
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: AdminView } = await import('./AdminView.vue')
const { SESSION_KEYS } = await import('@/api/client')

const USERS = [
  { id: 'me', email: 'admin@ntt.local', name: 'Администратор', position: null, phone: null, role: 'ADMIN', isActive: true, mustChangePassword: false, createdAt: '2026-09-01T00:00:00Z' },
  { id: 'u2', email: 'eng@ntt.local', name: 'Иванов Сергей Владимирович', position: 'Инженер-конструктор', phone: null, role: 'ENGINEER', isActive: true, mustChangePassword: false, createdAt: '2026-09-02T00:00:00Z' },
]

const AUDIT = [
  {
    id: 'a1',
    action: 'estimate.kp',
    entityType: 'Estimate',
    entityId: '1853b9c0',
    meta: { kpNumber: 'КП-0042', snapshotVersion: 3 },
    createdAt: '2026-09-17T09:00:00Z',
    user: { id: 'u2', name: 'Иванов Сергей Владимирович', email: 'eng@ntt.local', position: 'Инженер-конструктор' },
  },
  {
    id: 'a2',
    action: 'auth.login_failed',
    entityType: null,
    entityId: null,
    meta: { email: 'eng@ntt.local', reason: 'неверный пароль' },
    createdAt: '2026-09-17T08:30:00Z',
    user: null,
  },
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
  listAudit.mockResolvedValue({ items: AUDIT.map((e) => ({ ...e })), total: AUDIT.length, limit: 50, offset: 0 })
  auditActions.mockResolvedValue([
    { action: 'estimate.kp', count: 3 },
    { action: 'auth.login_failed', count: 1 },
  ])
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

/**
 * Журнал действий: администратор читает его, а не расшифровывает.
 *
 * Прежде вкладка показывала последние 200 записей таблицей кодов — без имён
 * событий, без отбора и без подробностей.
 */
describe('администрирование: журнал действий', () => {
  async function openAudit() {
    const w = await mountView()
    await w.findAll('.nav-link').find((b) => b.text() === 'Журнал действий')!.trigger('click')
    await flushPromises()
    return w
  }

  it('показывает событие названием, а не кодом, и с подробностями', async () => {
    const w = await openAudit()
    const rows = w.findAll('.aud-table tbody tr')

    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Выпущено КП')
    expect(rows[0]!.text()).toContain('Расчёты и КП')
    expect(rows[0]!.text()).toContain('Иванов Сергей Владимирович')
    expect(rows[0]!.text()).toContain('Инженер-конструктор')
    expect(rows[0]!.text()).toContain('номер КП: КП-0042')
    expect(rows[0]!.text()).not.toContain('estimate.kp')
  })

  it('заметные события отмечены: неудачный вход виден среди рядовых', async () => {
    const w = await openAudit()
    const rows = w.findAll('.aud-table tbody tr')

    expect(rows[1]!.classes()).toContain('aud-row--alarm')
    expect(rows[1]!.text()).toContain('причина: неверный пароль')
    // Записи без сотрудника бывают: при неверной почте его ещё нет.
    expect(rows[1]!.text()).toContain('—')
  })

  it('отбор уходит на сервер: сотрудник, раздел и период', async () => {
    const w = await openAudit()
    listAudit.mockClear()

    await w.findAll('.aud-filters select')[0]!.setValue('u2')
    await flushPromises()
    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ user: 'u2', offset: 0 }))

    await w.findAll('.aud-filters select')[1]!.setValue('estimate')
    await flushPromises()
    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'estimate' }))

    await w.findAll('.aud-period input')[0]!.setValue('2026-09-17')
    await flushPromises()
    const calls = listAudit.mock.calls
    const sent = calls[calls.length - 1]![0] as { from: string }
    // Период уходит полным моментом: сервер живёт по UTC, а день — по часам
    // пользователя.
    expect(sent.from).toMatch(/^2026-09-1[67]T/)
  })

  it('«Сбросить» возвращает полный журнал', async () => {
    const w = await openAudit()
    await w.findAll('.aud-filters select')[0]!.setValue('u2')
    await flushPromises()
    listAudit.mockClear()

    await w.findAll('.aud-filters button').find((b) => b.text() === 'Сбросить')!.trigger('click')
    await flushPromises()

    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ user: undefined, action: undefined }))
  })

  it('«Показать ещё» дочитывает страницу, а не заменяет её', async () => {
    listAudit.mockResolvedValueOnce({ items: [AUDIT[0]], total: 2, limit: 1, offset: 0 })
    const w = await openAudit()
    expect(w.findAll('.aud-table tbody tr')).toHaveLength(1)

    listAudit.mockResolvedValueOnce({ items: [AUDIT[1]], total: 2, limit: 1, offset: 1 })
    await w.find('.aud-more button').trigger('click')
    await flushPromises()

    expect(w.findAll('.aud-table tbody tr')).toHaveLength(2)
    expect(listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }))
  })

  it('щелчок по объекту собирает его цепочку, по сотруднику — его действия', async () => {
    const w = await openAudit()
    listAudit.mockClear()

    // Идентификатор объекта руками не набирают — он ставится из строки.
    await w.findAll('.aud-table tbody tr')[0]!.find('.aud-entity').trigger('click')
    await flushPromises()
    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: '1853b9c0', offset: 0 }))

    await w.findAll('.aud-table tbody tr')[0]!.find('.aud-link').trigger('click')
    await flushPromises()
    expect(listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ entity: '1853b9c0', user: 'u2' }))
  })

  it('отобранное видно подписями и снимается по одной', async () => {
    const w = await openAudit()
    await w.findAll('.aud-table tbody tr')[0]!.find('.aud-entity').trigger('click')
    await w.findAll('.aud-filters select')[0]!.setValue('u2')
    await flushPromises()

    const chips = w.findAll('.aud-chosen-chip').map((c) => c.text())
    expect(chips.some((c) => c.startsWith('Сотрудник: Иванов'))).toBe(true)
    expect(chips.some((c) => c.startsWith('Объект: 1853b9c0'))).toBe(true)

    listAudit.mockClear()
    await w.findAll('.aud-chosen-chip').find((c) => c.text().startsWith('Объект'))!.trigger('click')
    await flushPromises()
    // Снято одно условие, остальные остались.
    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ entity: undefined, user: 'u2' }))
  })

  it('«только такие» отбирает по этому действию', async () => {
    const w = await openAudit()
    listAudit.mockClear()

    await w.findAll('.aud-table tbody tr')[0]!.find('.aud-only').trigger('click')
    await flushPromises()

    expect(listAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'estimate.kp' }))
  })

  it('отказ сервера объясняется и предлагает повторить', async () => {
    listAudit.mockRejectedValue({ response: { data: { message: 'Начало периода позже его конца' } } })
    const w = await openAudit()

    expect(w.find('.dash-err').text()).toBe('Начало периода позже его конца')
    expect(w.findAll('button').some((b) => b.text() === 'Повторить')).toBe(true)
  })
})
