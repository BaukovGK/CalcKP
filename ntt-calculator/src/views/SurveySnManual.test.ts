// @vitest-environment jsdom
/**
 * Ручной SN в трёх опросных листах (решение Р9, План_устранения 3.8):
 * в списке — только ступени завода; по ТТ МВК они показаны обозначениями
 * 8000 и 12000 (та же труба), а выбранное раньше видно и объяснено, пока
 * инженер его не сменит.
 */
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'
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

const { default: SurveyKnsView } = await import('./SurveyKnsView.vue')
const { default: SurveyEmkView } = await import('./SurveyEmkView.vue')
const { default: SurveyKolView } = await import('./SurveyKolView.vue')

/** Лист с раскрытым блоком «изменить вручную». */
function mountSurvey(view: Component, deviceType: string, initial: Record<string, unknown>) {
  return mount(view, {
    props: {
      estimateId: null,
      initial: { zakazchik: 'Заказчик', pipeManual: true, ...initial },
      deviceType,
      deviceTypes: [{ value: deviceType, label: deviceType }],
      canChangeType: true,
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
}

/** Поле SN блока «изменить вручную». */
function snSelect(wrapper: ReturnType<typeof mountSurvey>) {
  const label = wrapper.findAll('label.fld').find((l) => l.text().startsWith('SN, Па'))
  expect(label, 'поле SN в блоке «изменить вручную»').toBeDefined()
  return label!.find('select').element as HTMLSelectElement
}

const options = (select: HTMLSelectElement) => [...select.options].map((o) => `${o.value}|${o.text}`)

// У ЕМК и КОЛ подпись пустого значения короче: ячейка списка уже.
const VIEWS = [
  { label: 'КНС', view: SurveyKnsView, deviceType: 'KNS', initial: { mvk: false }, empty: 'расчётное' },
  { label: 'ЕМК', view: SurveyEmkView, deviceType: 'EMK', initial: {}, empty: 'расч.' },
  { label: 'КОЛ', view: SurveyKolView, deviceType: 'KOL', initial: {}, empty: 'расч.' },
] as const

describe.each(VIEWS)('ОЛ $label: ручной SN', ({ view, deviceType, initial, empty }) => {
  it('в списке — расчётное и ступени завода 5000 и 10000', () => {
    const wrapper = mountSurvey(view as Component, deviceType, { ...initial, snManual: '' })
    expect(options(snSelect(wrapper))).toEqual([`|${empty}`, '5000|5000', '10000|10000'])
    expect(wrapper.text()).not.toContain('выбран раньше')
    wrapper.unmount()
  })

  it('SN, выбранный до правила завода, остаётся выбранным и объяснён', () => {
    const wrapper = mountSurvey(view as Component, deviceType, { ...initial, snManual: '2500' })
    const select = snSelect(wrapper)
    expect(select.value).toBe('2500')
    expect(select.selectedOptions[0]?.text).toBe('2500 (прежний)')
    expect(wrapper.text()).toContain('SN 2500 выбран раньше, а завод делает корпус из трубы SN 5000 или 10000')
    wrapper.unmount()
  })
})

// По ТТ МВК изделие маркируется 8000 и 12000 — это те же трубы SN 5000 и
// 10000 с двумя нитками ровинга (snDesignation). Марка в карточке показывает
// обозначение, и список обязан говорить так же, иначе выбранное «10000» и
// увиденное в марке «12000» выглядят разными ступенями.
describe('ОЛ КНС: ручной SN по ТТ МВК', () => {
  it('в списке — обозначения 8000 и 12000, а в форму идёт расчётная жёсткость', () => {
    const wrapper = mountSurvey(SurveyKnsView, 'KNS', { mvk: true, snManual: '' })
    expect(options(snSelect(wrapper))).toEqual(['|расчётное', '5000|8000', '10000|12000'])
    wrapper.unmount()
  })

  it('выбранная ступень остаётся расчётной жёсткостью, а видна обозначением', () => {
    const wrapper = mountSurvey(SurveyKnsView, 'KNS', { mvk: true, snManual: '10000' })
    const select = snSelect(wrapper)
    expect(select.value).toBe('10000')
    expect(select.selectedOptions[0]?.text).toBe('12000')
    // Марка трубы показывает то же обозначение — иначе список и карточка
    // говорили бы о разном.
    expect(wrapper.text()).toContain('-12000')
    wrapper.unmount()
  })

  it('предупреждение о прежнем выборе — тоже в обозначениях', () => {
    const wrapper = mountSurvey(SurveyKnsView, 'KNS', { mvk: true, snManual: '2500' })
    expect(wrapper.text()).toContain('SN 2500 выбран раньше, а завод делает корпус из трубы SN 8000 или 12000')
    wrapper.unmount()
  })
})


describe('ОЛ КНС: дополнительные параметры и обязательная комплектация', () => {
  it.each([199, 201])('кнопка МВК включает связанные переключатели с учётом расхода %s', async (capacity) => {
    const w = mountSurvey(SurveyKnsView, 'KNS', { mvk: false, dn: '2000', nRab: '2', nRez: '1', emergency: false,
      shu: false, shuPusk: 'ЧП', datchikiDavl: false, datchikiUrov: false, drobilka: 'дробилка',
      rashod: String(capacity), rashodUnit: 'm3/day', rashodomer: false })
    const toggle = (name: string) => w.findAll('.tg').find((t) => t.find('.tg-l').text() === name)!
    await toggle('По ТТ МВК').findAll('button')[0]!.trigger('click')
    for (const name of ['Корзина', 'Шкаф управления', 'Датчики давления', 'Датчики уровня', 'Аварийный трубопровод']) {
      expect(toggle(name).findAll('button')[0]!.classes(), name).toContain('on')
      expect(toggle(name).findAll('button')[1]!.attributes('disabled'), name).toBeDefined()
    }
    expect(toggle('Дробилка').findAll('button')[0]!.classes()).toContain('on')
    const start = w.findAll('label').find((l) => l.text().startsWith('Пуск'))!.find('select')
    expect((start.element as HTMLSelectElement).value).toBe('плавный')
    expect(start.attributes('disabled')).toBeDefined()
    expect(toggle('Расходомер').findAll('button')[capacity > 200 ? 0 : 1]!.classes()).toContain('on')
    await toggle('По ТТ МВК').findAll('button')[1]!.trigger('click')
    expect(toggle('Шкаф управления').findAll('button')[1]!.attributes('disabled')).toBeUndefined()
    w.unmount()
  })

  it('арматура сохраняет скрытые изменения, а кнопка возвращает все расчётные количества', async () => {
    const w = mountSurvey(SurveyKnsView, 'KNS', { mvk: false, nRab: '2', nRez: '1', napKol: '2', podvKol: '1', armaturaManual: true, zadvManual: '4', kranManual: '8', klapanManual: '6' })
    const card = () => w.findAll('.ol-card').find((c) => c.find('.ol-card-h').text() === 'Арматура')!
    expect(card().text()).not.toContain('ƒ')
    expect(card().find('.ol-grade').text()).toContain('задвижек 12 · обратных клапанов 6')
    await card().find('input[type="checkbox"]').setValue(false)
    expect(card().find('.ol-manual').exists()).toBe(false)
    expect(card().find('.ol-grade').text()).toContain('задвижек 12')
    await card().find('input[type="checkbox"]').setValue(true)
    const reset = card().findAll('button').find((b) => b.text() === 'вернуть расчётные параметры')!
    await reset.trigger('click')
    expect(card().find('.ol-grade').text()).toContain('задвижек 6 · обратных клапанов 3')
    expect(card().find('.ol-manual').exists()).toBe(false)
    w.unmount()
  })

  it('аварийная линия открывает выбор муфты и сохраняет размер после выключения', async () => {
    const w = mountSurvey(SurveyKnsView, 'KNS', { mvk: false, emergency: false, muftaGm: '80' })
    const toggle = () => w.findAll('.tg').find((t) => t.find('.tg-l').text() === 'Аварийный трубопровод')!
    expect(w.findAll('label').some((l) => l.text().startsWith('Быстросъёмная муфта'))).toBe(false)
    await toggle().findAll('button')[0]!.trigger('click')
    const select = () => w.findAll('label').find((l) => l.text().startsWith('Быстросъёмная муфта'))!.find('select')
    expect((select().element as HTMLSelectElement).value).toBe('80')
    await select().setValue('100')
    await toggle().findAll('button')[1]!.trigger('click')
    await toggle().findAll('button')[0]!.trigger('click')
    expect((select().element as HTMLSelectElement).value).toBe('100')
    w.unmount()
  })

  it('при расходе ниже 200 расходомер выключен и включение недоступно', () => {
    const w = mountSurvey(SurveyKnsView, 'KNS', { mvk: false, rashod: '199', rashodUnit: 'm3/day', rashodomer: true })
    const toggle = w.findAll('.tg').find((t) => t.find('.tg-l').text() === 'Расходомер')!
    expect(toggle.findAll('button')[0]!.attributes('disabled')).toBeDefined()
    expect(toggle.findAll('button')[1]!.classes()).toContain('on')
    expect(w.text()).toContain('расходомер не нужен')
    w.unmount()
  })

  it('новый опросный лист не получает номер образца; сохранённый номер восстанавливается', () => {
    const blank = mountSurvey(SurveyKnsView, 'KNS', { mvk: false })
    const number = blank.findAll('label').find((l) => l.text().startsWith('№ заявки ОЛ'))!.find('input')
    expect((number.element as HTMLInputElement).value).toBe('')
    blank.unmount()
    const saved = mountSurvey(SurveyKnsView, 'KNS', { mvk: false, zayavka: 'ОЛ-42' })
    expect((saved.findAll('label').find((l) => l.text().startsWith('№ заявки ОЛ'))!.find('input').element as HTMLInputElement).value).toBe('ОЛ-42')
    saved.unmount()
  })
})
