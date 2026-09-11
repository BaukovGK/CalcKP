// @vitest-environment jsdom
/**
 * Реестр цен: правка двойным щелчком по строке и фильтр категорий.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const patch = vi.fn()
const priceVersion = vi.fn()
const replace = vi.fn()

vi.mock('@/api/prices', () => ({
  pricesApi: { list: () => list(), patch: (...a: unknown[]) => patch(...a), import: vi.fn(), exportXlsx: vi.fn() },
}))
vi.mock('@/api/refs', () => ({
  refsApi: { priceVersion: () => priceVersion() },
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ replace, push: vi.fn() }),
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ role: 'BUYER' }) }))

const { default: PricesView } = await import('./PricesView.vue')
const { useToasts } = await import('@/composables/useToast')

const ITEMS = [
  { id: 'a', category: 'Метизы', name: 'Болт М6', unit: 'шт', priceRub: 6, supplier: null, comment: null, updatedAt: '2026-09-01T00:00:00Z', issue: null },
  { id: 'b', category: 'Металлопрокат', name: 'Уголок 50х50х5мм', unit: 'м', priceRub: 1500, supplier: 'ООО «Сталь»', comment: null, updatedAt: '2026-09-01T00:00:00Z', issue: null },
]

async function mountView() {
  const wrapper = mount(PricesView, {
    global: { stubs: { ThemeToggle: true, ToastHost: true, UserMenu: true } },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('реестр цен', () => {
  beforeEach(() => {
    list.mockReset()
    list.mockResolvedValue(ITEMS.map((i) => ({ ...i, lookupKey: '', priceBaseRub: i.priceRub, discountPct: null, currency: 'руб' })))
    patch.mockReset()
    priceVersion.mockReset()
    priceVersion.mockResolvedValue({ version: 2, label: 'НН от 10.09.2026', createdAt: null })
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

  // План_устранения, 1.2: смена цены — новая версия прайса, и экран о ней говорит.
  it('сохранённая цена поднимает версию прайса — подпись и тост её показывают', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('tbody tr').find((r) => r.text().includes('Уголок'))!.trigger('dblclick')
    patch.mockResolvedValue({ ...ITEMS[1], priceRub: 1600 })
    priceVersion.mockResolvedValue({ version: 3, label: 'НН v3', note: 'Ручная правка цены: Уголок 50х50х5мм, м', createdAt: null })

    const input = wrapper.find('tr.pr-row--edit input.num')
    await input.setValue('1600')
    await input.trigger('keydown.enter')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('b', { priceRub: 1600, supplier: 'ООО «Сталь»' })
    expect(wrapper.find('.pr-ver').text()).toBe('прайс v3 · НН v3')
    expect(useToasts().items.value.map((t) => t.message)).toContain(
      'Цена сохранена · прайс v3: расчёты с этой позицией предложат пересчитать',
    )
    wrapper.unmount()
  })

  it('правка одного поставщика версию прайса не перечитывает', async () => {
    const wrapper = await mountView()
    await wrapper.findAll('tbody tr').find((r) => r.text().includes('Уголок'))!.trigger('dblclick')
    patch.mockResolvedValue({ ...ITEMS[1], supplier: 'ООО «Прокат»' })

    const supplier = wrapper.findAll('tr.pr-row--edit input').find((i) => !i.classes('num'))!
    await supplier.setValue('ООО «Прокат»')
    await supplier.trigger('keydown.enter')
    await flushPromises()

    expect(patch).toHaveBeenCalledWith('b', { priceRub: 1500, supplier: 'ООО «Прокат»' })
    // Версию прочитал только первый показ экрана.
    expect(priceVersion).toHaveBeenCalledTimes(1)
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
