// @vitest-environment jsdom
/**
 * Вкладка сделки: шапка из портала, проекты по сделке с КП, «Новый расчёт
 * по сделке» с полями из сделки; роли без права создавать кнопки не видят.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deal, dealProjects, createProject, push } = vi.hoisted(() => ({
  deal: vi.fn(), dealProjects: vi.fn(), createProject: vi.fn(), push: vi.fn(),
}))
vi.mock('@/api/b24', () => ({ b24Api: { deal, dealProjects, createProject } }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
  useRoute: () => ({ params: { id: '5950' } }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const { default: DealView } = await import('./DealView.vue')
const { useAuthStore } = await import('@/stores/auth')

const DEAL = {
  id: '5950', title: 'КНС Протвино', stageId: 'NEW', opportunity: 1500000, currency: 'RUB',
  companyId: '3', contactId: null, customer: 'ООО «Вода»', assignedName: 'Иванов Пётр',
  address: 'Протвино, ул. Победы, 2', url: 'https://nttcrm.bitrix24.ru/crm/deal/details/5950/',
}
const PROJECT = {
  id: 'p1', title: 'КНС-1', customer: 'ООО «Вода»', address: null, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z',
  author: { name: 'Иванов' },
  estimates: [{
    id: 'e1', title: 'КНС DN3000', deviceType: 'KNS', status: 'DRAFT', totalRub: 1200000,
    snapshots: [
      { version: 3, kpNumber: '0142', totalRub: 1250000, createdAt: '2026-11-05T11:00:00Z' },
      { version: 1, kpNumber: '0131', totalRub: 1100000, createdAt: '2026-11-01T11:00:00Z' },
    ],
  }],
}

const stubs = { BugReportButton: true, ThemeToggle: true, UserMenu: true,
  BaseModal: { props: ['show'], template: '<div v-if="show" class="modal"><slot /><slot name="footer" /></div>' } }

function asRole(role: string) {
  const auth = useAuthStore()
  auth.user = { id: 'u1', name: 'Иванов', email: 'i@ntt.su', role } as never
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  deal.mockResolvedValue(DEAL)
  dealProjects.mockResolvedValue({ projects: [PROJECT], hidden: 2 })
})

describe('вкладка сделки', () => {
  it('шапка, проекты и все КП по сделке', async () => {
    asRole('ENGINEER')
    const w = mount(DealView, { global: { stubs } })
    await flushPromises()
    expect(w.find('.tb-title').text()).toBe('КНС Протвино')
    expect(w.text()).toContain('ООО «Вода»')
    expect(w.text()).toContain('№ 0142 · в.3')
    expect(w.text()).toContain('№ 0131 · в.1')
    expect(w.text()).toContain('Ещё 2 проекта')
  })

  it('новый расчёт — поля из сделки, после создания — в проект', async () => {
    asRole('MANAGER')
    createProject.mockResolvedValue({ id: 'p9' })
    const w = mount(DealView, { global: { stubs } })
    await flushPromises()
    await w.findAll('button').find(b => b.text().includes('Новый расчёт'))!.trigger('click')
    const inputs = w.findAll('.modal input')
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('КНС Протвино')
    expect((inputs[2]!.element as HTMLInputElement).value).toBe('Протвино, ул. Победы, 2')
    await inputs[0]!.setValue('КНС-2 Протвино')
    await w.find('.modal .btn-am').trigger('click')
    await flushPromises()
    expect(createProject).toHaveBeenCalledWith('5950', { title: 'КНС-2 Протвино', customer: 'ООО «Вода»', address: 'Протвино, ул. Победы, 2' })
    expect(push).toHaveBeenCalledWith('/projects/p9')
  })

  it('наблюдатель видит, но не создаёт', async () => {
    asRole('VIEWER')
    const w = mount(DealView, { global: { stubs } })
    await flushPromises()
    expect(w.findAll('button').some(b => b.text().includes('Новый расчёт'))).toBe(false)
  })

  it('портал не отдал сделку — текст сервера, проекты всё равно видны', async () => {
    asRole('ENGINEER')
    deal.mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { message: 'Нет ключа Битрикс24 — откройте калькулятор из портала' } } })
    const w = mount(DealView, { global: { stubs } })
    await flushPromises()
    expect(w.text()).toContain('Нет ключа Битрикс24')
    expect(w.text()).toContain('КНС-1')
  })
})
