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
