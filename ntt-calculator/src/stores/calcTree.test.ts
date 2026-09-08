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
        sections: [],
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

  it('берёт версию прайса с сервера, а не константу 1', async () => {
    estimatesGet.mockResolvedValue(savedEstimate())
    priceVersion.mockResolvedValue({ version: 4, label: 'НН v4', createdAt: null })
    const store = useCalcTreeStore()

    await store.load('e1')

    expect(store.priceListVersion).toBe(4)
  })
})
