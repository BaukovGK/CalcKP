// @vitest-environment jsdom
/**
 * Сноски опросных листов: у каждой подписи поля и тумблера есть пояснение.
 *
 * Требование оформления (Дизайн-бриф §8): что значит пункт и что он меняет
 * в расчёте — во всплывающей сноске при наведении. Тест раскрывает все
 * прогрессивные блоки листа и проверяет, что ни одна подпись не осталась без
 * сноски — новое поле без пояснения его провалит.
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

// Подбор насоса КНС ходит на сервер — в тесте ответа просто нет.
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

/** Все раскрывающиеся блоки — открыты: сноска нужна и спрятанным полям. */
const OPEN_ALL = {
  pipeManual: true,
  armaturaManual: true,
  emergency: true,
  insulation: true,
  shu: true,
  hasShaft: true,
  hasNeck: true,
  hasPumps: true,
  placement: 'горизонтальное',
}

const VIEWS = [
  { label: 'КНС', view: SurveyKnsView, deviceType: 'KNS' },
  { label: 'ЕМК', view: SurveyEmkView, deviceType: 'EMK' },
  { label: 'КОЛ', view: SurveyKolView, deviceType: 'KOL' },
] as const

describe.each(VIEWS)('ОЛ $label: сноски', ({ view, deviceType }) => {
  function mountView() {
    return mount(view as Component, {
      props: {
        estimateId: null,
        initial: { zakazchik: 'Заказчик', ...OPEN_ALL },
        deviceType,
        deviceTypes: [{ value: deviceType, label: deviceType }],
        canChangeType: true,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
  }

  it('у каждой подписи поля есть сноска', () => {
    const wrapper = mountView()
    const captions = wrapper.findAll('label.fld > span:first-child')
    // Лист смонтирован целиком — иначе проверять было бы нечего.
    expect(captions.length).toBeGreaterThan(20)
    expect(captions.filter((c) => c.attributes('data-hint') === undefined).map((c) => c.text())).toEqual([])
    wrapper.unmount()
  })

  it('у каждого тумблера есть сноска', () => {
    const wrapper = mountView()
    const toggles = wrapper.findAll('.tg-l')
    expect(toggles.length).toBeGreaterThan(3)
    expect(toggles.filter((t) => t.attributes('data-hint') === undefined).map((t) => t.text())).toEqual([])
    wrapper.unmount()
  })

  it('у живых величин справа — тоже', () => {
    const wrapper = mountView()
    const labels = wrapper.findAll('.ol-live-row dt > span:first-child')
    expect(labels.length).toBeGreaterThan(0)
    expect(labels.filter((l) => l.attributes('data-hint') === undefined).map((l) => l.text())).toEqual([])
    wrapper.unmount()
  })
})
