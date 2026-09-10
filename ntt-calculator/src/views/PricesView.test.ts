// @vitest-environment jsdom
/**
 * Реестр цен: правка двойным щелчком по строке и фильтр категорий.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const replace = vi.fn()

vi.mock('@/api/prices', () => ({
  pricesApi: { list: () => list(), patch: vi.fn(), import: vi.fn(), exportXlsx: vi.fn() },
}))
vi.mock('@/api/refs', () => ({
  refsApi: { priceVersion: () => Promise.resolve({ version: 2, label: 'НН от 10.09.2026', createdAt: null }) },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace, push: vi.fn() }),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ role: 'BUYER' }) }))

const { default: PricesView } = await import('./PricesView.vue')

const ITEMS = [
  { id: 'a', category: 'Метизы', name: 'Болт М6', unit: 'шт', priceRub: 6, supplier: null, comment: null, updatedAt: '2026-09-01T00:00:00Z', issue: null },
  { id: 'b', category: 'Металлопрокат', name: 'Уголок 50х50х5мм', unit: 'м', priceRub: 1500, supplier: 'ООО «Сталь»', comment: null, updatedAt: '2026-09-01T00:00:00Z', issue: null },
]

async function mountView() {
  const wrapper = mount(PricesView, {
    global: { stubs: { ThemeToggle: true, ToastHost: true } },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('реестр цен', () => {
  beforeEach(() => {
    list.mockReset()
    list.mockResolvedValue(ITEMS.map((i) => ({ ...i, lookupKey: '', priceBaseRub: i.priceRub, discountPct: null, currency: 'руб' })))
  })

  it('двойной щелчок по строке открывает правку цены', async () => {
    const wrapper = await mountView()
    const row = wrapper.findAll('tbody tr').find((r) => r.text().includes('Уголок'))!
    await row.trigger('dblclick')

    const input = wrapper.find('tr.pr-row--edit input.num')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('1500')
    wrapper.unmount()
  })

  // Двойной щелчок в поле ввода выделяет слово — набранное не должно теряться.
  it('повторный двойной щелчок по той же строке не сбрасывает набранное', async () => {
    const wrapper = await mountView()
    const row = () => wrapper.findAll('tbody tr').find((r) => r.text().includes('Болт') || r.find('input').exists())!
    await row().trigger('dblclick')
    const input = wrapper.find('tr.pr-row--edit input.num')
    await input.setValue('7,5')
    await wrapper.find('tr.pr-row--edit').trigger('dblclick')

    expect((wrapper.find('tr.pr-row--edit input.num').element as HTMLInputElement).value).toBe('7,5')
    wrapper.unmount()
  })

  it('флажок категории оставляет только её строки', async () => {
    const wrapper = await mountView()
    const box = wrapper.findAll('label.pr-cat').find((l) => l.text().startsWith('Метизы'))!.find('input')
    await box.setValue(true)

    const names = wrapper.findAll('tbody tr:not(.pr-grp) .pr-name').map((c) => c.text())
    expect(names).toEqual(['Болт М6'])
    wrapper.unmount()
  })
})
