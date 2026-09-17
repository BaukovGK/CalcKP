// @vitest-environment jsdom
/**
 * Экран проектов: завести новый проект видно прямо в сетке.
 *
 * Кнопка в шапке терялась среди служебных, а предложение из пустого состояния
 * исчезало после первого же проекта — и дальше «новый проект» приходилось
 * искать. Плитка в конце сетки повторяет «Добавить оборудование» на экране
 * проекта. Заводят проекты те, кто считает: наблюдатель и снабженец только
 * смотрят (План_устранения 3.7).
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchAll, list } = vi.hoisted(() => ({ fetchAll: vi.fn(), list: { value: [] as unknown[] } }))

vi.mock('@/stores/projects', () => ({
  useProjectsStore: () => ({
    get list() { return list.value },
    current: null,
    loading: false,
    error: null,
    fetchAll,
  }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { default: DashboardView } = await import('./DashboardView.vue')
const { SESSION_KEYS } = await import('@/api/client')

const PROJECT = {
  id: 'p1',
  title: 'Очистные сооружения',
  customer: 'ООО «Заказчик»',
  address: 'г. Пушкино',
  updatedAt: '2026-09-17T09:00:00Z',
  estimates: [],
}

function signIn(role: string) {
  localStorage.setItem(
    SESSION_KEYS.user,
    JSON.stringify({ id: 'u1', name: 'Инженер', email: 'eng@ntt.local', role }),
  )
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  vi.clearAllMocks()
  list.value = [PROJECT]
})

async function mountView() {
  const w = mount(DashboardView, { global: { stubs: { ThemeToggle: true, UserMenu: true } } })
  await flushPromises()
  return w
}

describe('экран проектов: новый проект', () => {
  it('плитка стоит в сетке рядом с проектами', async () => {
    signIn('ENGINEER')
    const w = await mountView()
    const tile = w.find('.dash-add')

    expect(tile.exists()).toBe(true)
    expect(tile.text()).toContain('Новый проект')
    // Именно в сетке, а не в шапке: там она и теряется.
    expect(w.find('.dash-grid .dash-add').exists()).toBe(true)
  })

  it('открывает то же окно, что кнопка в шапке', async () => {
    signIn('MANAGER')
    const w = await mountView()
    expect(w.find('.mo').exists()).toBe(false)

    await w.find('.dash-add').trigger('click')

    expect(w.find('.mo-tt').text()).toBe('Новый проект')
  })

  it('наблюдателю и снабженцу её не показываем — заводить проекты им нельзя', async () => {
    for (const role of ['VIEWER', 'BUYER']) {
      localStorage.clear()
      signIn(role)
      setActivePinia(createPinia())
      const w = await mountView()
      expect(w.find('.dash-add').exists()).toBe(false)
    }
  })

  it('в результатах поиска плитки нет: сетка показывает найденное', async () => {
    signIn('ENGINEER')
    const w = await mountView()

    await w.find('.dash-search').setValue('Очистные')
    expect(w.find('.dash-add').exists()).toBe(false)

    await w.find('.dash-search').setValue('')
    expect(w.find('.dash-add').exists()).toBe(true)
  })

  it('пустой список по-прежнему предлагает создать первый проект', async () => {
    signIn('ENGINEER')
    list.value = []
    const w = await mountView()

    expect(w.find('.dash-add').exists()).toBe(false)
    expect(w.text()).toContain('Проектов пока нет')
  })
})
