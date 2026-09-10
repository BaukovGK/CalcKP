// @vitest-environment jsdom
/**
 * Автосохранение опросных листов ёмкости и колодца.
 *
 * Дефект, который держат тесты: `num` в обоих листах был объявлен ниже
 * `useSurveySync`. Watch вычисляет нагрузку сразу при создании, вычисление
 * падало на ReferenceError (константа ещё не инициализирована), Vue ошибку
 * глотал, а watch запоминал только поля блока «Общие», которые успел
 * прочитать. Правка DN, объёма или тумблеров не сохранялась, пока не
 * тронешь заказчика или номер заявки.
 */
import { mount } from '@vue/test-utils'
import type { Component } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYNC_DELAY_MS } from '@/composables/useSurveySync'

const applySurvey = vi.fn()

vi.mock('@/stores/calcTree', () => ({
  useCalcTreeStore: () => ({
    applySurvey,
    ensureContext: () => Promise.resolve({}),
    catalogPrice: () => null,
    catalog: [],
  }),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const { default: SurveyEmkView } = await import('./SurveyEmkView.vue')
const { default: SurveyKolView } = await import('./SurveyKolView.vue')

const VIEWS = [
  { label: 'ЕМК', view: SurveyEmkView, key: 'emk', deviceType: 'EMK', dnLabel: 'DN корпуса' },
  { label: 'КОЛ', view: SurveyKolView, key: 'kol', deviceType: 'KOL', dnLabel: 'DN рабочей части' },
] as const

describe.each(VIEWS)('ОЛ $label: автосохранение', ({ view, key, deviceType, dnLabel }) => {
  beforeEach(() => {
    vi.useFakeTimers()
    applySurvey.mockReset()
    applySurvey.mockResolvedValue(1_000_000)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mountView() {
    return mount(view as Component, {
      props: {
        estimateId: 'e1',
        surveyRev: 1,
        totalRub: 1_000_000,
        savedSurvey: null,
        initial: { zakazchik: 'Заказчик', obekt: 'Объект' },
        deviceType,
        deviceTypes: [{ value: deviceType, label: deviceType }],
        canChangeType: false,
      },
      global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
    })
  }

  it('открывается без ошибок', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mountView()
    const all = [...errors.mock.calls, ...warns.mock.calls].map((c) => String(c[0]))
    expect(all.filter((m) => /initialization|ReferenceError|Unhandled error/i.test(m))).toEqual([])
  })

  it('правка DN сохраняется, не трогая «Общих»', async () => {
    const wrapper = mountView()
    const label = wrapper.findAll('label.fld').find((l) => l.text().startsWith(dnLabel))!
    await label.find('select').setValue('2500')

    await vi.advanceTimersByTimeAsync(SYNC_DELAY_MS + 10)

    expect(applySurvey).toHaveBeenCalledTimes(1)
    const [id, payload] = applySurvey.mock.calls[0] as [string, Record<string, Record<string, unknown>>]
    expect(id).toBe('e1')
    expect(payload[key]!.dn).toBe(2500)
  })
})
