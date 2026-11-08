// @vitest-environment jsdom
/**
 * Раздел «Доставка» опросного листа КНС: город из тарифов закупок, расчёт по
 * таблице ограничений погрузки, своя стоимость перекрывает расчётную.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/calcTree', () => ({
  useCalcTreeStore: () => ({
    applySurvey: vi.fn(),
    ensureContext: () => Promise.resolve({}),
    catalogPrice: () => null,
    catalog: [],
    lostEdits: [],
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

vi.mock('@/api/pumpStation', () => ({
  pumpStationApi: {
    selectPump: () => new Promise(() => {}),
    dischargePipeDiameter: () => new Promise(() => {}),
    pressurePiping: () => new Promise(() => {}),
  },
}))

const RATES = [
  { id: 'msk', num: 1, city: 'Москва', gabaritRub: 65450, permitRub: 150000, escortRub: 157000, note: null, sortOrder: 1, updatedAt: '' },
  { id: 'rzn', num: 3, city: 'Рязань', gabaritRub: 105500, permitRub: 175000, escortRub: 185000, note: 'только с Разрешением', sortOrder: 2, updatedAt: '' },
  { id: 'tmn', num: 4, city: 'Тюмень', gabaritRub: 535000, permitRub: null, escortRub: null, note: 'только с Разрешением', sortOrder: 3, updatedAt: '' },
]
vi.mock('@/api/deliveryRates', () => ({ deliveryRatesApi: { list: () => Promise.resolve(RATES) } }))

const { default: SurveyKnsView } = await import('./SurveyKnsView.vue')

/** Лист КНС DN 3000 с заданной глубиной: высота корпуса = Нподз + возвышение. */
async function mountKns(initial: Record<string, unknown>) {
  const w = mount(SurveyKnsView, {
    props: {
      estimateId: null,
      initial: { zakazchik: 'Заказчик', mvk: false, dn: '3000', npodzManual: '9000', vozv: '300', ...initial },
      deviceType: 'KNS',
      deviceTypes: [{ value: 'KNS', label: 'KNS' }],
      canChangeType: true,
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  await flushPromises()
  return w
}

const section = (w: Awaited<ReturnType<typeof mountKns>>) => w.find('[data-testid="delivery-section"]')
const citySelect = (w: Awaited<ReturnType<typeof mountKns>>) => section(w).find('select')

describe('ОЛ КНС: доставка', () => {
  it('города — из тарифов закупок', async () => {
    const w = await mountKns({})
    const opts = [...(citySelect(w).element as HTMLSelectElement).options].map((o) => o.text)
    expect(opts).toEqual(['— не выбран —', 'Москва', 'Рязань', 'Тюмень'])
    expect(section(w).find('[data-testid="delivery-breakdown"]').exists()).toBe(false)
    w.unmount()
  })

  it('негабарит «только с разрешением»: габарит + сопровождение + разрешение, и машина комплектующих', async () => {
    const w = await mountKns({})
    await citySelect(w).setValue('rzn')
    const card = section(w).find('[data-testid="delivery-breakdown"]')
    expect(card.text()).toContain('Машин: 2')
    expect(card.text()).toContain('негабарит')
    const input = section(w).findAll('input').at(-1)!.element as HTMLInputElement
    expect(input.placeholder).toBe((2 * 105500 + 185000 + 175000).toLocaleString('ru-RU'))
    w.unmount()
  })

  it('КНС длиннее 12 м — ещё одна машина', async () => {
    const w = await mountKns({ npodzManual: '12500', deliveryRateId: 'msk', deliveryCity: 'Москва' })
    expect(section(w).text()).toContain('Машин: 3')
    expect(section(w).text()).toContain('длина больше 12 м: +1')
    w.unmount()
  })

  it('нет ставки — просит ввести вручную; своя стоимость принимается', async () => {
    const w = await mountKns({ deliveryRateId: 'tmn', deliveryCity: 'Тюмень' })
    expect(section(w).text()).toContain('по маршруту нет ставки')
    const input = section(w).findAll('input').at(-1)!
    await input.setValue('700000')
    expect(section(w).text()).toContain('своя стоимость')
    w.unmount()
  })

  it('город сохранённого листа находится по названию, если id сменился импортом', async () => {
    const w = await mountKns({ deliveryRateId: 'old-id', deliveryCity: 'Москва' })
    expect((citySelect(w).element as HTMLSelectElement).value).toBe('msk')
    w.unmount()
  })
})
