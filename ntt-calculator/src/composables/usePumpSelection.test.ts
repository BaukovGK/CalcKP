/**
 * Подбор насоса в опросном листе: реактивная обвязка над `/api/pump-station`.
 *
 * Сам алгоритм живёт на сервере и покрыт его тестами
 * (`backend/src/utils/pump-selection.test.ts`, `pipe-hydraulics.test.ts`),
 * здесь проверяется обвязка: когда запрос уходит, что считается расчётным
 * значением, а что ручным переопределением, не затирает ли устаревший ответ
 * свежий и что лист говорит о напорном.
 */
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDefaultKnsSurvey, type KnsSurveyForm } from '@/types/survey'

const selectPump = vi.fn()
const pressurePiping = vi.fn()

vi.mock('@/api/pumpStation', () => ({
  pumpStationApi: {
    selectPump: (...a: unknown[]) => selectPump(...a),
    pressurePiping: (...a: unknown[]) => pressurePiping(...a),
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
    headMarginBandM: { min: 0.5, max: 2 },
    candidates: [],
    alternatives: [],
    belowMargin: [],
    warnings: [],
  }
}

const section = (dn: number, od: number, wall: number, inner: number, v: number, flowM3h: number) => ({
  diameterMm: od, dn, wallMm: wall, innerDiameterMm: inner,
  theoreticalDiameterMm: 146.1, velocityMs: v, designVelocityMs: 1.5,
  flowM3h, warnings: [],
})

/** Ответ сервера на ОЛ3487: стояк DN100, коллектор и напорная DN150, в листе DN150 ×2. */
function piping(over: Record<string, unknown> = {}) {
  return {
    riser: section(100, 110, 6.6, 96.8, 1.707, 45.234),
    collector: section(150, 160, 9.5, 141, 1.609, 90.468),
    outlet: section(150, 160, 9.5, 141, 1.609, 90.468),
    outletCount: 2,
    outletParallelVelocityMs: 0.8047,
    collectorWiderThanRiser: true,
    outletCheck: {
      dn: 150, diameterMm: 160, wallMm: 9.5, innerDiameterMm: 141,
      flowM3h: 90.468, velocityMs: 1.6094, outletCount: 2, parallelVelocityMs: 0.8047, warnings: [],
    },
    ...over,
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
    pressurePiping.mockResolvedValue(piping())
  })
  afterEach(() => vi.useRealTimers())

  it('не подбирает насос, пока не заполнены приток, напор и число рабочих', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '', nRab: '2' }))
    await settle()

    expect(selectPump).not.toHaveBeenCalled()
    expect(p.ready.value).toBe(false)
    expect(p.missing.value).toEqual(['расчётный напор'])
  })

  it('без притока или числа насосов не считает и напорный', async () => {
    usePumpSelection(makeForm({ rashod: '', napor: '12,9', nRab: '2' }))
    usePumpSelection(makeForm({ rashod: '25', napor: '12,9', nRab: '' }))
    await settle()

    expect(selectPump).not.toHaveBeenCalled()
    expect(pressurePiping).not.toHaveBeenCalled()
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

  it('отдаёт список для выбора: подходящие и отсечённые по запасу отдельно', async () => {
    const fitting = [
      { name: 'Vandjord VSL.150.75.4.5.0D', pump: null, byCurve: true, withinPreferredBand: true, headMarginM: 0.63, duty: { q: 45, h: 13.53, p2: 4.04, p1: 5.1, eff: 30.5 } },
      { name: 'Vandjord VSL.100.55.4.5.0D', pump: null, byCurve: true, withinPreferredBand: false, headMarginM: 3.99, duty: { q: 45, h: 16.89, p2: 3.26, p1: 4.1, eff: 42.8 } },
    ]
    const belowMargin = [
      { name: 'Vandjord VSL.100.37.4.5.0D', pump: null, byCurve: true, withinPreferredBand: false, headMarginM: 0.34, duty: { q: 45, h: 13.24, p2: 2.39, p1: 3.1, eff: 47.9 } },
    ]
    selectPump.mockResolvedValue({
      ...result('Vandjord VSL.150.75.4.5.0D'),
      headMarginBandM: { min: 0.5, max: 2 },
      candidates: fitting,
      alternatives: fitting.slice(1),
      belowMargin,
    })
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' })
    const p = usePumpSelection(form)
    await settle()

    expect(p.choices.value.fitting.map((c) => c.name)).toEqual([
      'Vandjord VSL.150.75.4.5.0D',
      'Vandjord VSL.100.55.4.5.0D',
    ])
    // Отсечённые по запасу не прячутся: их ставят в реальных проектах.
    expect(p.choices.value.belowMargin.map((c) => c.name)).toEqual(['Vandjord VSL.100.37.4.5.0D'])
    expect(p.marginBand.value).toEqual({ min: 0.5, max: 2 })
  })

  it('подпись модели в списке показывает, чем модели различаются', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' }))
    await settle()

    const label = p.optionLabel({
      name: 'Vandjord VSL.100.55.4.5.0D', pump: null as never, byCurve: true,
      withinPreferredBand: false, headMarginM: 3.99,
      duty: { q: 45, h: 16.89, p2: 3.26, p1: 4.1, eff: 42.8 },
    })

    expect(label).toBe('Vandjord VSL.100.55.4.5.0D — 3,26 кВт · КПД 42,8% · напор 16,89 м (запас 3,99 м)')
  })

  it('выбор модели вручную и возврат к подобранной', async () => {
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' })
    const p = usePumpSelection(form)
    await settle()

    p.choose('Vandjord VSL.100.55.4.5.0D')
    expect(form.value.marka).toBe('Vandjord VSL.100.55.4.5.0D')
    expect(p.pumpModel.value).toBe('Vandjord VSL.100.55.4.5.0D')
    expect(p.pumpModelOverridden.value).toBe(true)

    p.resetToCalculated()
    expect(form.value.marka).toBe('')
    expect(p.pumpModel.value).toBe(p.pumpModelCalc.value)
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
  // ── Напорный: проверка DN из листа и расчётный узел ──

  it('просит у сервера проверку того DN напорного, что стоит в листе', async () => {
    usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2', napKol: '2', napDn: '150' }))
    await settle()

    expect(pressurePiping).toHaveBeenCalledWith(90, 2, 2, 150)
  })

  it('напорный считается и без напора: ему нужны только расход и число насосов', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '', nRab: '2' }))
    await settle()

    expect(selectPump).not.toHaveBeenCalled()
    expect(pressurePiping).toHaveBeenCalledTimes(1)
    expect(p.pipeExplain.value).not.toBeNull()
  })

  it('правка DN напорного перезапрашивает проверку', async () => {
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2', napDn: '150' })
    usePumpSelection(form)
    await settle()

    form.value.napDn = '100'
    await settle()
    expect(pressurePiping).toHaveBeenLastCalledWith(90, 2, 2, 100)
  })

  // Как лист «Гидравл. расчет»: скорость в заданной трубе при работе на одну
  // нитку, а при двух напорных — ещё и когда работают обе.
  it('говорит скорость в DN из листа: на одну нитку и когда работают обе', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25,13', rashodUnit: 'l/s', napor: '12,9', nRab: '2' }))
    await settle()

    expect(p.pipeExplain.value).toBe(
      'напорный DN150 (⌀160×9,5, проход 141 мм): 1,61 м/с на одну нитку · обе сразу — 0,8 м/с',
    )
    expect(p.pipeWarnings.value).toEqual([])
  })

  it('одна напорная — без строки про одновременную работу', async () => {
    pressurePiping.mockResolvedValue(piping({
      outletCount: 1,
      outletCheck: { ...piping().outletCheck, outletCount: 1, parallelVelocityMs: 1.609 },
    }))
    const p = usePumpSelection(makeForm({ rashod: '25,13', rashodUnit: 'l/s', napor: '12,9', nRab: '2', napKol: '1' }))
    await settle()

    expect(p.pipeExplain.value).toBe('напорный DN150 (⌀160×9,5, проход 141 мм): 1,61 м/с на одну нитку')
  })

  it('скорость вне 1…2 м/с — предупреждение сервера отдаётся экрану', async () => {
    const warning = { code: 'VELOCITY_ABOVE_RANGE', message: 'Скорость 3,41 м/с выше экономического диапазона 1…2 м/с — растут потери напора.' }
    pressurePiping.mockResolvedValue(piping({
      outletCheck: { ...piping().outletCheck, dn: 100, diameterMm: 110, wallMm: 6.6, innerDiameterMm: 96.8, velocityMs: 3.415, parallelVelocityMs: 1.707, warnings: [warning] },
    }))
    const p = usePumpSelection(makeForm({ rashod: '25,13', rashodUnit: 'l/s', napor: '12,9', nRab: '2', napDn: '100' }))
    await settle()

    expect(p.pipeExplain.value).toContain('3,42 м/с на одну нитку')
    expect(p.pipeWarnings.value).toEqual([warning])
  })

  it('DN без ПЭ-трубы в ряду — так и говорит, а не молчит', async () => {
    pressurePiping.mockResolvedValue(piping({ outletCheck: null }))
    const p = usePumpSelection(makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2', napDn: '650' }))
    await settle()

    expect(p.pipeExplain.value).toBe('DN650: трубы ПЭ-100 SDR17 такого DN нет в ряду — скорость не проверена')
  })

  it('расчётный узел: напорный и коллектор на весь приток, стояк — на насос', async () => {
    const p = usePumpSelection(makeForm({ rashod: '25,13', rashodUnit: 'l/s', napor: '12,9', nRab: '2' }))
    await settle()

    expect(p.pipingExplain.value).toBe('расчётный: напорный и коллектор DN150 (1,61 м/с) · стояк насоса DN100 (1,71 м/с)')
  })

  it('один насос — весь узел одним DN, без повторов', async () => {
    const one = section(100, 110, 6.6, 96.8, 1.707, 45.234)
    pressurePiping.mockResolvedValue(piping({ riser: one, collector: one, outlet: one, collectorWiderThanRiser: false }))
    const p = usePumpSelection(makeForm({ rashod: '12,57', rashodUnit: 'l/s', napor: '12,9', nRab: '1' }))
    await settle()

    expect(p.pipingExplain.value).toBe('расчётный: весь напорный узел — DN100 (1,71 м/с)')
  })

  // Пока идёт пауза перед запросом, в поле уже новый напор, а подбор ещё
  // старый — подсказка не должна склеивать одно с другим.
  it('в пояснении подбора — напор, по которому сервер подбирал, а не текущий из поля', async () => {
    const form = makeForm({ rashod: '25', rashodUnit: 'l/s', napor: '12,9', nRab: '2' })
    const p = usePumpSelection(form)
    await settle()

    form.value.napor = '20'
    await vi.advanceTimersByTimeAsync(100) // запрос ещё не ушёл
    expect(p.pumpExplain.value).toContain('напор 12,9 м')
    expect(p.pumpExplain.value).not.toContain('напор 20 м')
  })
})
