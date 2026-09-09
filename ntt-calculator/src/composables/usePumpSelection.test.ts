/**
 * Подбор насоса в опросном листе: реактивная обвязка над `/api/pump-station`.
 *
 * Сам алгоритм живёт на сервере и покрыт его тестами
 * (`backend/src/utils/pump-selection.test.ts`), здесь проверяется обвязка:
 * когда запрос уходит, что считается расчётным значением, а что ручным
 * переопределением, и не затирает ли устаревший ответ свежий.
 */
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDefaultKnsSurvey, type KnsSurveyForm } from '@/types/survey'

const selectPump = vi.fn()
const dischargePipeDiameter = vi.fn()

vi.mock('@/api/pumpStation', () => ({
  pumpStationApi: {
    selectPump: (...a: unknown[]) => selectPump(...a),
    dischargePipeDiameter: (...a: unknown[]) => dischargePipeDiameter(...a),
  },
}))

const { usePumpSelection } = await import('./usePumpSelection')

function result(name: string | null, flowPerPumpM3h = 45) {
  return {
    name,
    pump: null,
    duty: name ? { q: flowPerPumpM3h, h: 13.24, p2: 2.39, p1: 3.1, eff: 47.9 } : null,
    headMarginM: name ? 0.34 : null,
    flowPerPumpM3h,
    requiredHeadM: 12.9,
    alternatives: [],
    warnings: [],
  }
}

/** Прокрутить дебаунс и дождаться разрешения промисов запроса. */
async function settle() {
  await vi.runAllTimersAsync()
}

function makeForm(over: Partial<KnsSurveyForm> = {}) {
  return ref<KnsSurveyForm>({ ...makeDefaultKnsSurvey(), ...over })
}

describe('usePumpSelection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    selectPump.mockResolvedValue(result('Vandjord VSL.80.37.4.5.0D'))
    dischargePipeDiameter.mockResolvedValue({
      diameterMm: 110, theoreticalDiameterMm: 103.2, velocityMs: 1.32,
      designVelocityMs: 1.5, flowPerPumpM3h: 45, warnings: [],
    })
  })
  afterEach(() => vi.useRealTimers())

  it('не ходит на сервер, пока не заполнены приток, напор и число рабочих', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '', nRab: '2' }))
    await settle()

    expect(selectPump).not.toHaveBeenCalled()
    expect(p.ready.value).toBe(false)
    expect(p.missing.value).toEqual(['расчётный напор'])
  })

  it('переводит приток в м³/ч — сервер считает в них', async () => {
    // 25 л/с = 90 м³/ч; деление на насосы делает сервер, не мы.
    usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,7', nRab: '2' }))
    await settle()

    expect(selectPump).toHaveBeenCalledWith(90, 12.7, 2)
  })

  it('принимает приток в м³/ч и в м³/сут без пересчёта на стороне вызова', async () => {
    usePumpSelection(makeForm({ rashod: '90', rashodUnit: 'm3/h', napor: '10', nRab: '1' }))
    await settle()
    expect(selectPump).toHaveBeenLastCalledWith(90, 10, 1)

    usePumpSelection(makeForm({ rashod: '2160', rashodUnit: 'm3/day', napor: '10', nRab: '1' }))
    await settle()
    expect(selectPump).toHaveBeenLastCalledWith(90, 10, 1)
  })

  it('подобранная марка — расчётное значение, поле «Марка» — ручное переопределение', async () => {
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,7', nRab: '2' })
    const p = usePumpSelection(form)
    await settle()

    expect(p.pumpModelCalc.value).toBe('Vandjord VSL.80.37.4.5.0D')
    expect(p.pumpModel.value).toBe('Vandjord VSL.80.37.4.5.0D')
    expect(p.pumpModelOverridden.value).toBe(false)

    form.value.marka = 'Grundfos SL1.80'
    expect(p.pumpModel.value).toBe('Grundfos SL1.80')
    expect(p.pumpModelOverridden.value).toBe(true)
    // Расчётное не теряется — к нему можно вернуться.
    expect(p.pumpModelCalc.value).toBe('Vandjord VSL.80.37.4.5.0D')

    form.value.marka = '   '
    expect(p.pumpModel.value).toBe('Vandjord VSL.80.37.4.5.0D')
  })

  it('показывает рабочую точку, а не только марку', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' }))
    await settle()

    // Инженеру нужны напор в точке, запас и мощность — по ним видно, годится ли
    // насос и во что обойдётся его работа.
    expect(p.pumpExplain.value).toContain('рабочая точка 13,24 м')
    expect(p.pumpExplain.value).toContain('запас 0,34 м')
    expect(p.pumpExplain.value).toContain('47,9%')
    expect(p.pumpExplain.value).toContain('2,39 кВт')
  })

  it('перечисляет альтернативы по возрастанию мощности', async () => {
    selectPump.mockResolvedValue({
      ...result('Vandjord VSL.100.37.4.5.0D'),
      alternatives: [
        { name: 'Vandjord VSL.100.55.4.5.0D', pump: null, byCurve: true, headMarginM: 3.99, duty: { q: 45, h: 16.89, p2: 3.26, p1: 4.1, eff: 42.8 } },
        { name: 'Vandjord VSL.100.75.4.5.0D', pump: null, byCurve: true, headMarginM: 6.62, duty: { q: 45, h: 19.52, p2: 4.13, p1: 5.2, eff: 40 } },
      ],
    })
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' }))
    await settle()

    expect(p.alternativesExplain.value).toBe(
      'ещё подходят: Vandjord VSL.100.55.4.5.0D (3,26 кВт), Vandjord VSL.100.75.4.5.0D (4,13 кВт)',
    )
  })

  it('честно говорит, когда у модели нет паспортной кривой', async () => {
    selectPump.mockResolvedValue({ ...result('Vandjord VSL.50.22.2.5.0D'), duty: null, headMarginM: null })
    const p = usePumpSelection(makeForm({ rashod: '8', rashodUnit: 'l/s', napor: '13,66', nRab: '1' }))
    await settle()

    expect(p.pumpExplain.value).toContain('кривой у модели нет')
  })

  it('объясняет, почему подходящего насоса нет', async () => {
    selectPump.mockResolvedValue({
      name: null, pump: null, flowPerPumpM3h: 5000,
      warnings: [{ code: 'NO_CAPACITY_MATCH', message: 'В каталоге нет насоса на 5000 м³/ч.' }],
    })
    const p = usePumpSelection(makeForm({ rashod: '5000', rashodUnit: 'm3/h', napor: '10', nRab: '1' }))
    await settle()

    expect(p.pumpModelCalc.value).toBeNull()
    expect(p.pumpExplain.value).toBe('В каталоге нет насоса на 5000 м³/ч.')
  })

  it('устаревший ответ не затирает свежий', async () => {
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,7', nRab: '2' })
    let releaseSlow: (v: unknown) => void = () => {}
    selectPump.mockReturnValueOnce(new Promise((r) => { releaseSlow = r }))

    const p = usePumpSelection(form)
    await vi.advanceTimersByTimeAsync(500) // ушёл первый (медленный) запрос

    selectPump.mockResolvedValue(result('Vandjord VSL.100.37.4.5.0D'))
    form.value.napor = '15'
    await settle() // ушёл и вернулся второй

    expect(p.pumpModelCalc.value).toBe('Vandjord VSL.100.37.4.5.0D')

    releaseSlow(result('Vandjord VSL.80.37.4.5.0D')) // первый вернулся позже
    await vi.runAllTimersAsync()

    expect(p.pumpModelCalc.value).toBe('Vandjord VSL.100.37.4.5.0D')
  })

  it('ошибка сервера не роняет форму, а объясняется в подсказке', async () => {
    selectPump.mockRejectedValue({ response: { data: { message: 'Некорректные параметры' } } })
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,7', nRab: '2' }))
    await settle()

    expect(p.pumpModelCalc.value).toBeNull()
    expect(p.pumpExplain.value).toBe('Некорректные параметры')
  })
})
