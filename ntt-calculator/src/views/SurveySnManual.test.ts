// @vitest-environment jsdom
/**
 * Ручной SN в трёх опросных листах (решение Р9, План_устранения 3.8):
 * в списке — только ступени завода; выбранное раньше видно и объяснено,
 * пока инженер его не сменит.
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

const VIEWS = [
  { label: 'КНС', view: SurveyKnsView, deviceType: 'KNS' },
  { label: 'ЕМК', view: SurveyEmkView, deviceType: 'EMK' },
  { label: 'КОЛ', view: SurveyKolView, deviceType: 'KOL' },
] as const

describe.each(VIEWS)('ОЛ $label: ручной SN', ({ view, deviceType }) => {
  function mountWith(snManual: string) {
    return mount(view as Component, {
      props: {
        estimateId: null,
        initial: { zakazchik: 'Заказчик', pipeManual: true, snManual },
        deviceType,
        deviceTypes: [{ value: deviceType, label: deviceType }],
        canChangeType: true,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
  }

  function snSelect(wrapper: ReturnType<typeof mountWith>) {
    const label = wrapper.findAll('label.fld').find((l) => l.text().startsWith('SN, Па'))
    expect(label, 'поле SN в блоке «изменить вручную»').toBeDefined()
    return label!.find('select').element as HTMLSelectElement
  }

  it('в списке — расчётное и ступени завода 5000 и 10000', () => {
    const wrapper = mountWith('')
    expect([...snSelect(wrapper).options].map((o) => o.value)).toEqual(['', '5000', '10000'])
    expect(wrapper.text()).not.toContain('выбран раньше')
    wrapper.unmount()
  })

  it('SN, выбранный до правила завода, остаётся выбранным и объяснён', () => {
    const wrapper = mountWith('2500')
    const select = snSelect(wrapper)
    expect([...select.options].map((o) => o.value)).toEqual(['', '5000', '10000', '2500'])
    expect(select.value).toBe('2500')
    expect(select.selectedOptions[0]?.text).toBe('2500 (прежний)')
    expect(wrapper.text()).toContain('SN 2500 выбран раньше, а завод делает корпус из трубы SN 5000 или 10000')
    wrapper.unmount()
  })
})
