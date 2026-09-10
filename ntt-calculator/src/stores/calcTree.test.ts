/**
 * Стор дерева расчёта: круговорот «save → load» и версия прайса.
 *
 * Баг, который держат эти тесты: save() писал наценку и тираж в
 * surveyData.totals, а load() их не читал. После переоткрытия расчёт молча
 * возвращался к 0,43 и 1 корпусу, следующее сохранение затирало сохранённое —
 * и цена продажи менялась без единого действия пользователя. Стор Pinia —
 * синглтон, поэтому без сброса в clear() параметры ещё и перетекали между
 * расчётами.
 *
 * Версия прайса тем же образом была захардкожена единицей: топбар всегда
 * показывал «НН v1», хотя снапшот фиксировал настоящую версию.
 *
 * Тесты идут через реальный load(): подменяются только сетевые модули.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MARKUP } from '@/engines/economics'

const estimatesGet = vi.fn()
const priceVersion = vi.fn()
const patchSurvey = vi.fn()

vi.mock('@/api/estimates', () => ({
  estimatesApi: {
    get: (...a: unknown[]) => estimatesGet(...a),
    patchSurvey: (...a: unknown[]) => patchSurvey(...a),
  },
}))

vi.mock('@/api/refs', () => ({
  refsApi: {
    nomenclature: () => Promise.resolve({}),
    pipeWeights: () => Promise.resolve({ grp: [], pe: [] }),
    engineering: () => Promise.resolve({ shell: [], ellipticBottom: [], nozzles: [] }),
    priceVersion: (...a: unknown[]) => priceVersion(...a),
  },
}))

const { useCalcTreeStore } = await import('./calcTree')

/**
 * Минимальное сохранённое дерево. `surveyRev <= treeSurveyRev` — ветка «ОЛ не
 * менялся»: load() поднимает дерево как есть и не зовёт материализацию, так что
 * справочники можно оставить пустыми.
 */
function savedEstimate(totals?: Record<string, unknown>) {
  return {
    id: 'e1',
    title: 'КНС DN3000',
    deviceType: 'KNS',
    status: 'CALC',
    totalRub: 100,
    updatedAt: '2026-09-01T00:00:00Z',
    authorId: 'u1',
    projectId: null,
    snapshots: [],
    author: { name: 'Инженер' },
    surveyData: {
      surveyRev: 3,
      treeSurveyRev: 3,
      ...(totals ? { totals } : {}),
      tree: {
        deviceType: 'KNS',
        survey: {},
        priceListVersion: 1,
        // Разделы тесты подставляют свои, поэтому тип широкий: иначе пустой
        // литерал сузился бы до never[] и присваивание не прошло бы проверку.
        sections: [] as unknown[],
      },
    },
  }
}

describe('стор calcTree: наценка, тираж и версия прайса', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    priceVersion.mockResolvedValue({ version: 1, label: 'НН v1', createdAt: null })
  })

  it('восстанавливает наценку и тираж из surveyData.totals', async () => {
    estimatesGet.mockResolvedValue(savedEstimate({ markup: 0.31, tirage: 4 }))
    const store = useCalcTreeStore()

    await store.load('e1')

    expect(store.markup).toBe(0.31)
    expect(store.tirage).toBe(4)
  })

  it('без сохранённых totals берёт значения по умолчанию', async () => {
    estimatesGet.mockResolvedValue(savedEstimate())
    const store = useCalcTreeStore()

    await store.load('e1')

    expect(store.markup).toBe(DEFAULT_MARKUP)
    expect(store.tirage).toBe(1)
  })

  it('отбрасывает мусор в totals вместо того, чтобы принять его в цену', async () => {
    estimatesGet.mockResolvedValue(
      savedEstimate({ markup: Number.NaN, tirage: 0 }),
    )
    const store = useCalcTreeStore()

    await store.load('e1')

    expect(store.markup).toBe(DEFAULT_MARKUP)
    expect(store.tirage).toBe(1)
  })

  it('переживает круговорот save → load без потери значений', async () => {
    estimatesGet.mockResolvedValue(savedEstimate({ markup: 0.55, tirage: 7 }))
    patchSurvey.mockResolvedValue(savedEstimate({ markup: 0.55, tirage: 7 }))
    const store = useCalcTreeStore()

    await store.load('e1')
    await store.save()

    // Именно эти два поля терялись: save их писал, load не читал.
    expect(patchSurvey).toHaveBeenCalledTimes(1)
    const [, body] = patchSurvey.mock.calls[0] as [string, { totals: Record<string, unknown> }]
    expect(body.totals.markup).toBe(0.55)
    expect(body.totals.tirage).toBe(7)
  })

  it('clear() сбрасывает наценку и тираж, чтобы они не перетекли в следующий расчёт', async () => {
    estimatesGet.mockResolvedValue(savedEstimate({ markup: 0.62, tirage: 5 }))
    const store = useCalcTreeStore()

    await store.load('e1')
    store.clear()

    expect(store.markup).toBe(DEFAULT_MARKUP)
    expect(store.tirage).toBe(1)
  })

  it('сохраняет вычисленное количество строк, чтобы бэкенд не толковал выражения', async () => {
    // qtyManual хранит выражение; парсер есть только на фронте. Без qtyResolved
    // бэкенд читал его через Number(), получал NaN и решал, что количества нет:
    // строка без цены переставала блокировать выпуск КП и пропадала из
    // спецификации КП.
    const est = savedEstimate()
    est.surveyData.tree.sections = [
      {
        id: 's1',
        code: '1',
        title: 'Корпус',
        enabled: true,
        components: [
          {
            id: 'c1',
            title: 'Обечайка',
            enabled: true,
            rows: [
              { id: 'r1', kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Полоса', unit: 'м',
                qtyCalc: 4, qtyManual: '1,55*2+2,88*2', priceCatalog: 100, priceManual: null },
              { id: 'r2', kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Лист', unit: 'шт',
                qtyCalc: 6, qtyManual: null, priceCatalog: 200, priceManual: null },
            ],
          },
        ],
      },
    ]
    estimatesGet.mockResolvedValue(est)
    patchSurvey.mockResolvedValue(est)
    const store = useCalcTreeStore()

    await store.load('e1')
    store.tirage = 5 // тираж в дерево не попадает: он живёт в totals
    await store.save()

    const [, body] = patchSurvey.mock.calls[0] as [string, { tree: { sections: Array<{ components: Array<{ rows: Array<Record<string, unknown>> }> }> }; totals: Record<string, unknown> }]
    const rows = body.tree.sections[0]!.components[0]!.rows

    expect(rows[0]!.qtyResolved).toBeCloseTo(8.86, 10) // 1,55*2 + 2,88*2
    expect(rows[1]!.qtyResolved).toBe(6)
    // Выражение сохраняется рядом с результатом — инженер должен видеть, что вводил.
    expect(rows[0]!.qtyManual).toBe('1,55*2+2,88*2')
    expect(body.totals.tirage).toBe(5)
  })

  it('подобранная марка насоса доезжает из ОЛ до строки расчёта', async () => {
    // Сквозная проверка проводки: derived.pumpModel → surveyToParams →
    // materializeKns → наименование строки → спецификация КП. Раньше подбор
    // жил на сервере и не был подключён ни к чему: в расчёт уходило
    // «Насос (марка по подбору)».
    const est = savedEstimate()
    delete (est.surveyData as Record<string, unknown>).tree // нет дерева → материализация
    Object.assign(est.surveyData, {
      kns: {
        dn: '3000', podvDn: '250', podvKol: '1', napDn: '150', napKol: '2',
        nRab: '2', nRez: '1', valveOnInlet: true, emergency: false,
        insulation: false, tiGlubina: '0', mvk: false,
      },
      derived: { npodzMm: 11600, sn: 10000, pn: 0.1, pumpModel: 'Vandjord VSL.80.37.4.5.0D' },
    })
    estimatesGet.mockResolvedValue(est)
    const store = useCalcTreeStore()

    await store.load('e1')

    const pump = store.rows.find((r) => r.category === 'Насосы, АТМ')
    expect(pump?.name).toBe('Насос Vandjord VSL.80.37.4.5.0D')
    expect(pump?.qtyCalc).toBe(3) // раб 2 + рез 1
  })

  it('берёт версию прайса с сервера, а не константу 1', async () => {
    estimatesGet.mockResolvedValue(savedEstimate())
    priceVersion.mockResolvedValue({ version: 4, label: 'НН v4', createdAt: null })
    const store = useCalcTreeStore()

    await store.load('e1')

    expect(store.priceListVersion).toBe(4)
  })
})

/**
 * ОЛ — основной экран изделия: правка ОЛ сама пересобирает расчёт
 * (applySurvey), а цены трубы и насоса связаны с полями ОЛ в обе стороны.
 */
describe('стор calcTree: пересчёт из ОЛ и связанные цены', () => {
  /** ОЛ КНС в той форме, в которой его сохраняет SurveyKnsView. */
  const kns = (over: Record<string, unknown> = {}) => ({
    dn: '3000', podvDn: '250', podvKol: '1', napDn: '150', napKol: '2',
    nRab: '2', nRez: '1', valveOnInlet: true, emergency: false,
    insulation: false, tiGlubina: '0', mvk: false, pipePrice: '', pumpPrice: '',
    ...over,
  })
  const derived = { npodzMm: 11600, sn: 10000, pn: 0.1, pumpModel: null }

  /** Расчёт без дерева: первая же applySurvey его материализует. */
  function freshEstimate() {
    const est = savedEstimate()
    delete (est.surveyData as Record<string, unknown>).tree
    Object.assign(est.surveyData, { surveyRev: 1, treeSurveyRev: 0, form: kns(), kns: kns(), derived })
    return est
  }

  /** PATCH отвечает тем, что ему прислали, поверх сохранённого. */
  function echoPatch(est: ReturnType<typeof freshEstimate>) {
    patchSurvey.mockImplementation((_id: string, body: Record<string, unknown>) => {
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return Promise.resolve(JSON.parse(JSON.stringify(est)))
    })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    priceVersion.mockResolvedValue({ version: 1, label: 'НН v1', createdAt: null })
  })

  it('правка ОЛ пересобирает расчёт и сохраняет его одним запросом', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()

    await store.applySurvey('e1', { form: kns({ nRab: '3' }), kns: kns({ nRab: '3' }), derived, surveyRev: 2 })

    expect(patchSurvey).toHaveBeenCalledTimes(1)
    const [, body] = patchSurvey.mock.calls[0] as [string, Record<string, unknown>]
    // ОЛ, дерево и итоги — вместе: иначе сервер между запросами держал бы ОЛ новее дерева.
    expect(body.surveyRev).toBe(2)
    expect(body.treeSurveyRev).toBe(2)
    expect(body.tree).toBeTruthy()
    expect(body.totals).toBeTruthy()
    const pump = store.rows.find((r) => r.category === 'Насосы, АТМ')
    expect(pump?.qtyCalc).toBe(4) // раб 3 + рез 1
  })

  it('ручное количество переживает правку ОЛ, а конфликт остаётся в дереве', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 2 })

    const pump = store.rows.find((r) => r.category === 'Насосы, АТМ')!
    store.setQtyManual(pump.id, '5')

    // Правка ОЛ меняет расчётное (3 → 4) под ручной цифрой.
    await store.applySurvey('e1', { form: kns({ nRab: '3' }), kns: kns({ nRab: '3' }), derived, surveyRev: 3 })

    const after = store.rows.find((r) => r.category === 'Насосы, АТМ')!
    expect(after.qtyManual).toBe('5')
    expect(store.conflictIds.has(after.id)).toBe(true)
    expect(store.prevQtyCalc[after.id]).toBe(3)

    // Конфликт хранится в дереве — значит, доедет до экрана расчёта.
    const [, body] = patchSurvey.mock.calls[patchSurvey.mock.calls.length - 1] as [string, { tree: { sections: Array<{ components: Array<{ rows: Array<Record<string, unknown>> }> }> } }]
    const saved = body.tree.sections.flatMap((s) => s.components.flatMap((c) => c.rows)).find((r) => r.category === 'Насосы, АТМ')
    expect(saved?.qtyCalcPrev).toBe(3)
  })

  it('«оставить моё» гасит конфликт, не трогая ручную цифру', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 2 })
    const pump = store.rows.find((r) => r.category === 'Насосы, АТМ')!
    store.setQtyManual(pump.id, '5')
    await store.applySurvey('e1', { form: kns({ nRab: '3' }), kns: kns({ nRab: '3' }), derived, surveyRev: 3 })

    const row = store.rows.find((r) => r.category === 'Насосы, АТМ')!
    store.keepOverride(row.id)

    expect(store.conflictIds.size).toBe(0)
    expect(row.qtyManual).toBe('5')
  })

  it('цена трубы из ОЛ становится ценой строки трубы', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()

    await store.applySurvey('e1', {
      form: kns({ pipePrice: '48 000' }), kns: kns({ pipePrice: '48 000' }), derived, surveyRev: 2,
    })

    const pipe = store.rows.find((r) => r.priceBinding === 'pipePrice')!
    expect(pipe.priceManual).toBe(48_000)
  })

  it('новая цена из ОЛ побеждает прежнюю цену строки', async () => {
    // Без этого правило переноса ручных правок вернуло бы старую цифру из
    // дерева поверх той, что инженер только что ввёл в ОЛ.
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns({ pipePrice: '48000' }), kns: kns({ pipePrice: '48000' }), derived, surveyRev: 2 })

    await store.applySurvey('e1', { form: kns({ pipePrice: '51000' }), kns: kns({ pipePrice: '51000' }), derived, surveyRev: 3 })

    expect(store.rows.find((r) => r.priceBinding === 'pipePrice')?.priceManual).toBe(51_000)
  })

  it('цена, исправленная в расчёте, возвращается в поле ОЛ', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns({ pipePrice: '48000' }), kns: kns({ pipePrice: '48000' }), derived, surveyRev: 2 })

    const pipe = store.rows.find((r) => r.priceBinding === 'pipePrice')!
    store.setPriceManual(pipe.id, 52_500)
    await store.save()

    const [, body] = patchSurvey.mock.calls[patchSurvey.mock.calls.length - 1] as [string, { form: Record<string, unknown>; kns: Record<string, unknown> }]
    // Иначе следующая правка ОЛ пересобрала бы дерево со старой цифрой из поля.
    expect(body.form.pipePrice).toBe('52500')
    expect(body.kns.pipePrice).toBe('52500')
  })

  it('без правки связанной цены save() форму не трогает', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns({ pipePrice: '48000' }), kns: kns({ pipePrice: '48000' }), derived, surveyRev: 2 })

    await store.save()

    const [, body] = patchSurvey.mock.calls[patchSurvey.mock.calls.length - 1] as [string, Record<string, unknown>]
    expect(body.form).toBeUndefined()
  })
})
