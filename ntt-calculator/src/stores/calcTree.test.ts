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
const engineering = vi.fn(() => Promise.resolve({ shell: [], ellipticBottom: [] as unknown[], nozzles: [] }))
/** Прайс: категория → позиции. По умолчанию пуст; тесты пересчёта цен подставляют свой. */
const nomenclature = vi.fn((): Promise<Record<string, Array<{ name: string; unit: string; priceRub: number | null }>>> =>
  Promise.resolve({}),
)

vi.mock('@/api/estimates', () => ({
  estimatesApi: {
    get: (...a: unknown[]) => estimatesGet(...a),
    patchSurvey: (...a: unknown[]) => patchSurvey(...a),
  },
}))

vi.mock('@/api/refs', () => ({
  refsApi: {
    nomenclature: () => nomenclature(),
    pipeWeights: () => Promise.resolve({ grp: [], pe: [] }),
    engineering: () => engineering(),
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

  it('ручные количества арматуры из ОЛ доезжают до расчёта', async () => {
    // Раньше ОЛ показывал их в итоге блока, а материализация пересчитывала заново.
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()

    const manual = kns({ zadvManual: '2', kranManual: '7', klapanManual: '4' })
    await store.applySurvey('e1', { form: manual, kns: manual, derived, surveyRev: 2 })

    // Только раздел 7: задвижки с тем же DN есть и в обвязке напорного (раздел 5).
    const valves = store.tree!.sections.find((s) => s.code === '7')!
      .components.flatMap((c) => c.rows)
      .filter((r) => r.category === 'Запорная арматура')
    expect(valves.find((r) => r.name.includes('DN250'))?.qtyCalc).toBe(2)
    expect(valves.find((r) => r.name.startsWith('Задвижка') && r.name.includes('DN150'))?.qtyCalc).toBe(7)
    expect(valves.find((r) => r.name.startsWith('Клапан обратный'))?.qtyCalc).toBe(4)
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

  /** Узел дерева по началу заголовка. */
  const node = (store: ReturnType<typeof useCalcTreeStore>, title: string) =>
    store.tree!.sections.flatMap((s) => s.components).find((c) => c.title.startsWith(title))!

  // Раньше пересборка переносила состояние узла из старого дерева, и
  // выключенная в ОЛ теплоизоляция продолжала считаться.
  it('тумблер ОЛ включает и выключает узел расчёта', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const on = kns({ insulation: true })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 2 })
    expect(node(store, 'Теплоизоляция').enabled).toBe(true)

    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 3 })

    expect(node(store, 'Теплоизоляция').enabled).toBe(false)
  })

  it('узел, переключённый в расчёте, живёт до правки своего тумблера в ОЛ', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const on = kns({ insulation: true })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 2 })
    store.toggleComponent('1', node(store, 'Теплоизоляция').id)

    // Правка другого поля ОЛ ручное переключение не отменяет.
    const other = kns({ insulation: true, nRab: '3' })
    await store.applySurvey('e1', { form: other, kns: other, derived, surveyRev: 3 })
    expect(node(store, 'Теплоизоляция').enabled).toBe(false)

    // А правка самого тумблера — отменяет: выигрывает последнее изменение.
    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 4 })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 5 })
    expect(node(store, 'Теплоизоляция').enabled).toBe(true)
  })

  it('дерево, собранное до пометки ОЛ, тоже следует за тумблером', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const on = kns({ insulation: true })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 2 })
    for (const c of store.tree!.sections.flatMap((s) => s.components)) delete c.enabledCalc

    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 3 })

    expect(node(store, 'Теплоизоляция').enabled).toBe(false)
  })

  it('корзина и дробилка КНС следуют за ОЛ, цепь — от глубины лотка', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const both = kns({ drobilka: 'обе', podvLotok: '9910' })
    await store.applySurvey('e1', { form: both, kns: both, derived, surveyRev: 2 })

    expect(node(store, 'Корзина сороудерживающая').enabled).toBe(true)
    expect(node(store, 'Дробилка').enabled).toBe(true)
    expect(node(store, 'Корзина').rows.find((r) => r.name.startsWith('Цепь'))?.qtyCalc).toBe(11)

    const none = kns({ drobilka: 'нет', podvLotok: '9910' })
    await store.applySurvey('e1', { form: none, kns: none, derived, surveyRev: 3 })

    expect(node(store, 'Корзина').enabled).toBe(false)
    expect(node(store, 'Дробилка').enabled).toBe(false)
  })

  it('блок «Автоматика» ОЛ ведёт шкаф, датчики и расходомер; возвышение — к высоте станции', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const auto = kns({
      shu: true, shuTip: 'уличный', shuPusk: 'плавный',
      datchikiDavl: true, datchikiUrov: false, rashodomer: true,
      vozv: '300', nZap: '1',
    })
    await store.applySurvey('e1', { form: auto, kns: auto, derived, surveyRev: 2 })

    expect(node(store, 'Шкаф управления').enabled).toBe(true)
    expect(node(store, 'Шкаф управления').rows[0]!.name).toBe('Шкаф управления насосами (3 шт.), уличный, пуск плавный')
    expect(node(store, 'Датчики давления').enabled).toBe(true)
    expect(node(store, 'Датчик уровня').enabled).toBe(false)
    expect(node(store, 'Расходомер').enabled).toBe(true)
    // Высота станции 11,6 + 0,3 м: цепь подъёма ROUNDUP(3 × 12,9) = 39.
    expect(node(store, 'Грузоподъём насосов').rows[0]!.qtyCalc).toBe(39)
    // Запасной насос — в поставку.
    expect(node(store, 'Насосная группа').rows[0]!.qtyCalc).toBe(4)
  })

  // Правка ОЛ пересобирает дерево по действующему прайсу. Раньше это молча
  // меняло цены строк; теперь сдвиг виден отметкой «цена была».
  it('пересборка по ОЛ после импорта нового прайса отмечает сдвинувшиеся цены', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const WORK = { name: 'Придание изделию товарного вида', unit: 'чел. ч' }
    nomenclature.mockResolvedValueOnce({ 'Собственное производство': [{ ...WORK, priceRub: 1207.8 }] })
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 2 })
    const work = () => store.rows.find((r) => r.name === WORK.name)!
    expect(work().priceCatalog).toBe(1207.8)
    expect(work().priceCatalogPrev).toBeUndefined()

    // Импортирован прайс v6 со своей ставкой.
    nomenclature.mockResolvedValueOnce({ 'Собственное производство': [{ ...WORK, priceRub: 1300 }] })
    priceVersion.mockResolvedValueOnce({ version: 6, label: 'НН v6', createdAt: null })
    await store.ensureContext({ fresh: true })
    const next = kns({ nRab: '3' })
    await store.applySurvey('e1', { form: next, kns: next, derived, surveyRev: 3 })

    expect(work()).toMatchObject({ priceCatalog: 1300, priceCatalogPrev: 1207.8 })
    expect(store.tree!.priceListVersion).toBe(6)
    expect(store.priceDeltaIds.has(work().id)).toBe(true)
  })

  // Шкаф управления — договорная позиция: цены в прайсе нет, её вводят в
  // расчёте. Введённая цена должна сразу снимать строку из «без цены».
  it('цена шкафа управления, введённая в расчёте, снимает строку из «без цены»', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const on = kns({ shu: true, shuTip: 'уличный', shuPusk: 'плавный' })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 2 })
    const cabinet = node(store, 'Шкаф управления').rows[0]!
    expect(store.missingPriceIds.has(cabinet.id)).toBe(true)

    store.setPriceManual(cabinet.id, 1_200_000)

    expect(store.results.get(cabinet.id)).toMatchObject({ price: 1_200_000, sum: 1_200_000, missingPrice: false })
    expect(store.missingPriceIds.has(cabinet.id)).toBe(false)

    // И переживает пересборку по правке ОЛ: ключ строки — наименование.
    const next = kns({ shu: true, shuTip: 'уличный', shuPusk: 'плавный', nRab: '2', vozv: '500' })
    await store.applySurvey('e1', { form: next, kns: next, derived, surveyRev: 3 })
    expect(node(store, 'Шкаф управления').rows[0]!.priceManual).toBe(1_200_000)
  })

  // Выключенный узел — «призрак»: его строки ничего не стоят, и гейт КП на
  // сервере их не считает. Счётчик «без цены» не должен расходиться с гейтом.
  it('строки без цены с нулевым количеством не попадают в счётчик «без цены»', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    const off = kns({ shu: false })
    await store.applySurvey('e1', { form: off, kns: off, derived, surveyRev: 2 })
    const cabinet = node(store, 'Шкаф управления').rows[0]!
    expect(store.results.get(cabinet.id)!.missingPrice).toBe(true)
    expect(store.missingPriceIds.has(cabinet.id)).toBe(false)

    const on = kns({ shu: true })
    await store.applySurvey('e1', { form: on, kns: on, derived, surveyRev: 3 })
    expect(store.missingPriceIds.has(node(store, 'Шкаф управления').rows[0]!.id)).toBe(true)
  })

  // Узел раздела 5 переименован: направляющие ушли в раздел 3, работы по
  // нитке остались. Ручная правка старого расчёта не должна потеряться.
  it('ручная правка узла, сменившего название, переживает пересборку', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    echoPatch(est)
    const store = useCalcTreeStore()
    await store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 2 })
    const works = node(store, 'Работы по напорному трубопроводу')
    works.title = 'Направляющие насосов и работы по нитке'
    works.rows.find((r) => r.name === 'Изготовление напорного трубопровода')!.qtyManual = '33.6'

    const next = kns({ nRab: '3' })
    await store.applySurvey('e1', { form: next, kns: next, derived, surveyRev: 3 })

    const row = node(store, 'Работы по напорному трубопроводу').rows.find((r) => r.name === 'Изготовление напорного трубопровода')!
    expect(row.qtyManual).toBe('33.6')
  })

  // Уход с ОЛ досохраняет правку, а экран расчёта в ту же секунду читает
  // изделие. Раньше чтение обгоняло запись: расчёт показывал прежнюю цену,
  // а первое его сохранение возвращало её и в ОЛ.
  it('расчёт, открытый сразу после правки цены в ОЛ, видит эту цену', async () => {
    const est = freshEstimate()
    estimatesGet.mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(est))))
    echoPatch(est)
    const store = useCalcTreeStore()
    const before = kns({ pipePrice: '52000' })
    await store.applySurvey('e1', { form: before, kns: before, derived, surveyRev: 2 })

    // Следующий PATCH отвечает не сразу — как по сети.
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    patchSurvey.mockImplementation(async (_id: string, body: Record<string, unknown>) => {
      await gate
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return JSON.parse(JSON.stringify(est))
    })

    const after = kns({ pipePrice: '61000' })
    const saving = store.applySurvey('e1', { form: after, kns: after, derived, surveyRev: 3 })
    const loading = store.load('e1') // экран расчёта открылся, пока ОЛ ещё сохраняется
    release()
    await Promise.all([saving, loading])

    expect(store.rows.find((r) => r.priceBinding === 'pipePrice')?.priceManual).toBe(61_000)
  })

  // Расчёт открыт в другой вкладке, а ОЛ тем временем поправили: «Сохранить»
  // записало бы дерево из старого ОЛ и вернуло бы старую цену в сам ОЛ.
  it('устаревшее сохранение из расчёта отклоняется, стор поднимает свежее', async () => {
    const est = freshEstimate()
    estimatesGet.mockImplementation(() => Promise.resolve(JSON.parse(JSON.stringify(est))))
    echoPatch(est)
    const store = useCalcTreeStore()
    const old = kns({ pipePrice: '52000' })
    await store.applySurvey('e1', { form: old, kns: old, derived, surveyRev: 2 })

    // Другая вкладка сохранила ОЛ с ценой 61 000 — на сервере ревизия 3.
    const fresh = kns({ pipePrice: '61000' })
    est.surveyData = { ...est.surveyData, form: fresh, kns: fresh, surveyRev: 3 } as typeof est.surveyData
    patchSurvey.mockRejectedValueOnce({ response: { status: 409, data: { code: 'SURVEY_CHANGED' } } })

    await expect(store.save()).rejects.toThrow('Опросный лист изменился')
    expect(store.rows.find((r) => r.priceBinding === 'pipePrice')?.priceManual).toBe(61_000)
  })

  it('save() и пересчёт из ОЛ не перекрываются, settled() ждёт обоих', async () => {
    const est = freshEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    const order: string[] = []
    patchSurvey.mockImplementation(async (_id: string, body: Record<string, unknown>) => {
      order.push(body.surveyRev != null ? `ОЛ ${body.surveyRev}` : 'расчёт')
      await Promise.resolve()
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return JSON.parse(JSON.stringify(est))
    })
    const store = useCalcTreeStore()
    const p1 = store.applySurvey('e1', { form: kns(), kns: kns(), derived, surveyRev: 2 })
    const p2 = store.save()
    const p3 = store.applySurvey('e1', { form: kns({ nRab: '3' }), kns: kns({ nRab: '3' }), derived, surveyRev: 3 })
    await store.settled()

    expect(order).toEqual(['ОЛ 2', 'расчёт', 'ОЛ 3'])
    await Promise.all([p1, p2, p3])
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

describe('стор calcTree: ёмкость', () => {
  /** Параметры ОЛ ёмкости в той форме, в которой их шлёт SurveyEmkView. */
  const emk = (over: Record<string, unknown> = {}) => ({
    dn: 2000, volumeM3: 50, placement: 'вертикальное', installation: 'подземная',
    tankType: 'Накопительная', pnSurvey: 0.1, hasShaft: true, shaftDiameterMm: 1200,
    inletDn: 150, inletCount: 1, outletDn: 150, outletCount: 1,
    hasPumps: false, pumpsWorking: 0, pumpsReserve: 0, hasBasket: false,
    insulationEnabled: false, insulationDepthMm: 0, pipePriceRub: null, servicePipePriceRub: null,
    ...over,
  })

  function emkEstimate() {
    const est = savedEstimate()
    est.deviceType = 'EMK'
    delete (est.surveyData as Record<string, unknown>).tree
    Object.assign(est.surveyData, { surveyRev: 1, treeSurveyRev: 0, form: { servicePipePrice: '' }, emk: emk() })
    return est
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    priceVersion.mockResolvedValue({ version: 1, label: 'НН v1', createdAt: null })
  })

  it('цена из поля ОЛ ложится на трубу шахты, а правка в расчёте возвращается в поле', async () => {
    const est = emkEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    patchSurvey.mockImplementation((_id: string, body: Record<string, unknown>) => {
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return Promise.resolve(JSON.parse(JSON.stringify(est)))
    })
    const store = useCalcTreeStore()

    await store.applySurvey('e1', {
      form: { servicePipePrice: '21000' }, emk: emk({ servicePipePriceRub: 21_000 }), surveyRev: 2,
    })
    const shaft = store.rows.find((r) => r.priceBinding === 'servicePipePrice')!
    expect(shaft.name).toContain('1200')
    expect(shaft.priceManual).toBe(21_000)

    store.setPriceManual(shaft.id, 23_500)
    await store.save()

    const [, body] = patchSurvey.mock.calls[patchSurvey.mock.calls.length - 1] as [string, { form: Record<string, unknown>; emk: Record<string, unknown> }]
    expect(body.form.servicePipePrice).toBe('23500')
    expect(body.emk.servicePipePriceRub).toBe(23_500)
    // Цена трубы корпуса не тронута: у неё своё поле.
    expect(body.form.pipePrice).toBeUndefined()
  })

  /** Узел дерева по началу заголовка. */
  const node = (store: ReturnType<typeof useCalcTreeStore>, title: string) =>
    store.tree!.sections.flatMap((s) => s.components).find((c) => c.title.startsWith(title))!

  function emkStore() {
    const est = emkEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    patchSurvey.mockImplementation((_id: string, body: Record<string, unknown>) => {
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return Promise.resolve(JSON.parse(JSON.stringify(est)))
    })
    return useCalcTreeStore()
  }

  it('тумблер «Лестница» ОЛ ведёт узел; ручное переключение живёт до правки тумблера', async () => {
    const store = emkStore()
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: false }), surveyRev: 2 })
    expect(node(store, 'Лестница').enabled).toBe(false)

    // Инженер включил лестницу в расчёте — правка другого поля ОЛ её не трогает.
    store.toggleComponent('3', node(store, 'Лестница').id)
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: false, volumeM3: 60 }), surveyRev: 3 })
    expect(node(store, 'Лестница').enabled).toBe(true)

    // А смена ответа в ОЛ — трогает.
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: true, volumeM3: 60 }), surveyRev: 4 })
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: false, volumeM3: 60 }), surveyRev: 5 })
    expect(node(store, 'Лестница').enabled).toBe(false)
  })

  it('тумблер «Вентиляция» ОЛ ведёт вентстояк', async () => {
    const store = emkStore()
    await store.applySurvey('e1', { form: {}, emk: emk({ ventilation: false }), surveyRev: 2 })
    expect(node(store, 'Вентиляционный стояк').enabled).toBe(false)
    await store.applySurvey('e1', { form: {}, emk: emk({ ventilation: true }), surveyRev: 3 })
    expect(node(store, 'Вентиляционный стояк').enabled).toBe(true)
  })

  // Дерево, собранное до связи с ОЛ: лестница там строилась включённой
  // всегда, поэтому выключенная — это ручная правка инженера.
  it('старое дерево: выключенную вручную лестницу ответ ОЛ «да» не включает, ответ «нет» — выключает', async () => {
    const store = emkStore()
    await store.applySurvey('e1', { form: {}, emk: emk(), surveyRev: 2 })
    const legacy = () => {
      for (const c of store.tree!.sections.flatMap((s) => s.components)) delete c.enabledCalc
    }

    legacy()
    store.toggleComponent('3', node(store, 'Лестница').id)
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: true, volumeM3: 60 }), surveyRev: 3 })
    expect(node(store, 'Лестница').enabled).toBe(false)

    store.toggleComponent('3', node(store, 'Лестница').id)
    legacy()
    await store.applySurvey('e1', { form: {}, emk: emk({ hasLadder: false, volumeM3: 70 }), surveyRev: 4 })
    expect(node(store, 'Лестница').enabled).toBe(false)
  })

  // Матрица приходит ячейками (DN × строка длины «До 3 м» … «До 12»), длина
  // трубы приводится к строке тем же правилом, что в эталоне.
  it('масса эллиптических днищ — из матрицы справочника по строке длины трубы', async () => {
    engineering.mockResolvedValueOnce({
      shell: [],
      ellipticBottom: [
        { d: 2000, lengthMm: 7000, massKg: 154, thicknessMm: 18 },
        { d: 2000, lengthMm: 12000, massKg: 196, thicknessMm: 23 },
      ],
      nozzles: [],
    })
    const est = emkEstimate()
    estimatesGet.mockResolvedValue(JSON.parse(JSON.stringify(est)))
    patchSurvey.mockImplementation((_id: string, body: Record<string, unknown>) => {
      est.surveyData = { ...est.surveyData, ...body } as typeof est.surveyData
      return Promise.resolve(JSON.parse(JSON.stringify(est)))
    })
    const store = useCalcTreeStore()

    // V 50 м³ при DN 2000 — труба 16 000 мм → строка «До 12».
    await store.applySurvey('e1', { form: {}, emk: emk({ placement: 'горизонтальное' }), surveyRev: 2 })
    const row = store.rows.find((r) => r.name === 'Механическая формовка эллиптических днищ')!
    expect(row.qtyCalc).toBe(2 * 196)
  })
})

/**
 * Пересчёт по новой версии прайса (Механика §5.2).
 *
 * Материализация фиксирует цены строк вместе с версией прайса. После импорта
 * нового прайса старый расчёт показывал прежние цены и ничего об этом не
 * говорил — КП уходил по устаревшей себестоимости.
 */
describe('стор calcTree: пересчёт по новой версии прайса', () => {
  /** Расчёт, собранный по прайсу v2. */
  function oldEstimate() {
    const est = savedEstimate()
    est.surveyData.tree.priceListVersion = 2
    est.surveyData.tree.sections = [
      {
        id: 's1', code: '1', title: 'Корпус', enabled: true,
        components: [
          {
            id: 'c1', title: 'Узел', enabled: true,
            rows: [
              { id: 'r1', kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Полоса', unit: 'м', qtyCalc: 4, qtyManual: null, priceCatalog: 100, priceManual: null },
              { id: 'r2', kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Лист', unit: 'шт', qtyCalc: 6, qtyManual: null, priceCatalog: 200, priceManual: null },
              { id: 'r3', kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Уголок', unit: 'м', qtyCalc: 2, qtyManual: null, priceCatalog: 50, priceManual: 70 },
              { id: 'r4', kind: 'МАТЕРИАЛ', category: 'Собственное производство', name: 'Труба СК/НПС-К 3000-0,1-10000', unit: 'м', qtyCalc: 11.6, qtyManual: null, priceCatalog: null, priceManual: 30000, priceBinding: 'pipePrice' },
              { id: 'r5', kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Снятая позиция', unit: 'шт', qtyCalc: 1, qtyManual: null, priceCatalog: 10, priceManual: null },
            ],
          },
        ],
      },
    ]
    return est
  }

  /** Прайс v5: полоса подорожала, уголок тоже, «снятой позиции» нет. */
  const PRICES_V5 = {
    Металлопрокат: [
      { name: 'Полоса', unit: 'м', priceRub: 120 },
      { name: 'Лист', unit: 'шт', priceRub: 200 },
      { name: 'Уголок', unit: 'м', priceRub: 55 },
    ],
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    nomenclature.mockResolvedValue(PRICES_V5)
    priceVersion.mockResolvedValue({ version: 5, label: 'НН v5', createdAt: null })
  })

  it('открытый старый расчёт знает, что прайс обновился, и что даст пересчёт', async () => {
    estimatesGet.mockResolvedValue(oldEstimate())
    const store = useCalcTreeStore()
    await store.load('e1')

    expect(store.priceOutdated).toBe(true)
    const p = store.repricePreview!
    expect(p.summary).toMatchObject({ changed: 2, changedUnderManual: 1, notFound: 1 })
    // Полоса +20 ₽ × 4 м; у уголка ручная цена — применённая не меняется.
    expect(p.costAfter).toBeGreaterThan(p.costBefore)
    // Предпросмотр дерево не трогает.
    expect(store.rows.find((r) => r.id === 'r1')!.priceCatalog).toBe(100)
  })

  it('пересчёт берёт цены нового прайса и ставит отметки «было → стало»', async () => {
    estimatesGet.mockResolvedValue(oldEstimate())
    const store = useCalcTreeStore()
    await store.load('e1')

    const summary = store.repriceToCurrent()!
    const r = (id: string) => store.rows.find((x) => x.id === id)!

    expect(summary.changed).toBe(2)
    expect(r('r1')).toMatchObject({ priceCatalog: 120, priceCatalogPrev: 100 })
    expect(store.results.get('r1')!.sum).toBe(480)
    expect(r('r2').priceCatalogPrev).toBeUndefined()
    expect(r('r3')).toMatchObject({ priceCatalog: 55, priceManual: 70, priceCatalogPrev: 50 })
    // Договорная труба и снятая из прайса позиция — как были.
    expect(r('r4')).toMatchObject({ priceCatalog: null, priceManual: 30000 })
    expect(r('r5').priceCatalog).toBe(10)
    expect(store.tree!.priceListVersion).toBe(5)
    expect(store.priceOutdated).toBe(false)
    expect([...store.priceDeltaIds].sort()).toEqual(['r1', 'r3'])
  })

  it('отметку можно принять или оставить прежнюю цену ручной', async () => {
    estimatesGet.mockResolvedValue(oldEstimate())
    const store = useCalcTreeStore()
    await store.load('e1')
    store.repriceToCurrent()
    const r = (id: string) => store.rows.find((x) => x.id === id)!

    store.keepPrevPrice('r1')
    expect(r('r1')).toMatchObject({ priceCatalog: 120, priceManual: 100 })
    expect(store.results.get('r1')!.price).toBe(100)
    // У строки с ручной ценой менять нечего — отметка только снимается.
    store.keepPrevPrice('r3')
    expect(r('r3').priceManual).toBe(70)
    expect(store.priceDeltaIds.size).toBe(0)
  })

  it('«принять все» снимает все отметки, новые цены остаются', async () => {
    estimatesGet.mockResolvedValue(oldEstimate())
    const store = useCalcTreeStore()
    await store.load('e1')
    store.repriceToCurrent()

    store.acceptAllPriceDeltas()

    expect(store.priceDeltaIds.size).toBe(0)
    expect(store.rows.find((x) => x.id === 'r1')!.priceCatalog).toBe(120)
  })

  it('сохранение уносит новые цены, отметки и версию прайса в дерево', async () => {
    const est = oldEstimate()
    estimatesGet.mockResolvedValue(est)
    patchSurvey.mockResolvedValue(est)
    const store = useCalcTreeStore()
    await store.load('e1')
    store.repriceToCurrent()

    await store.save()

    const [, body] = patchSurvey.mock.calls[0] as [string, { tree: { priceListVersion: number; sections: Array<{ components: Array<{ rows: Array<Record<string, unknown>> }> }> } }]
    expect(body.tree.priceListVersion).toBe(5)
    expect(body.tree.sections[0]!.components[0]!.rows[0]).toMatchObject({ priceCatalog: 120, priceCatalogPrev: 100 })
  })

  it('расчёт на действующем прайсе пересчёта не предлагает', async () => {
    const est = oldEstimate()
    est.surveyData.tree.priceListVersion = 5
    estimatesGet.mockResolvedValue(est)
    const store = useCalcTreeStore()
    await store.load('e1')

    expect(store.priceOutdated).toBe(false)
    expect(store.repricePreview).toBeNull()
  })
})
