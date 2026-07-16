import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { aggregateRows, computeEconomics, DEFAULT_MARKUP, type Rates } from '@/engines/economics'
import { recalcFotSatellites, resolveFotK } from '@/engines/fot'
import { computeRow } from '@/engines/row'
import type { CalcComponent } from '@/engines/template-kns'
import {
  flattenRows,
  materializeKns,
  sectionEnabledFor,
  type CalcRowNode,
  type CalcTree,
  type KnsSurveyParams,
  type MaterializeContext,
} from '@/engines/template-kns'
import { estimatesApi, type EstimateDetail } from '@/api/estimates'
import { refsApi } from '@/api/refs'
import type { RowResult } from '@/engines/types'

/**
 * Стор дерева расчёта (§9, Библиотека §6.3).
 *
 * Заменяет прежний `stores/calculator.ts` (свободное дерево
 * связка→группа→подгруппа→строка): целевая структура — материализованное
 * дерево «Сборка→Компонент→Строка».
 *
 * Вся арифметика делегируется движку `engines/*` — здесь только состояние и
 * загрузка. Никаких confirm() внутри actions (антицель хендоффа).
 */

/** Ставки по умолчанию — fallback, если позиции нет в прайсе (Механика §9). */
const FALLBACK_RATES: Rates = {
  fotRub: 1207.8,
  overheadRub: 1584.73,
  acetoneRub: 109.4,
  ppeRub: 122,
}

export const useCalcTreeStore = defineStore('calcTree', () => {
  const estimate = ref<EstimateDetail | null>(null)
  const tree = ref<CalcTree | null>(null)
  const rates = ref<Rates>({ ...FALLBACK_RATES })
  const priceListVersion = ref(1)
  /** Плоский прайс — источник для модала «Компонент из каталога». */
  const catalog = ref<Array<{ category: string; name: string; unit: string; priceRub: number | null }>>([])

  const markup = ref(DEFAULT_MARKUP)
  const tirage = ref(1)

  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Предыдущие расчётные количества — для детекции конфликта «ОЛ изменился
   * после тюнинга» (Механика §8.3).
   */
  const prevQtyCalc = ref<Record<string, number | null>>({})
  /** Конфликты, разрешённые как «оставить моё». */
  const conflictsKept = ref<Set<string>>(new Set())

  // ── Загрузка ──────────────────────────────────────────────────────────────

  async function load(id: string) {
    loading.value = true
    error.value = null
    try {
      const [est, prices, weights] = await Promise.all([
        estimatesApi.get(id),
        refsApi.nomenclature(),
        refsApi.pipeWeights(),
      ])
      estimate.value = est

      // Индексы справочников: поиск по тройке (категория, наименование, ЕИ)
      // и по (DN; PN_трубы; SN) — ровно как VLOOKUP эталона.
      const priceIdx = new Map<string, number | null>()
      const flat: typeof catalog.value = []
      for (const [category, items] of Object.entries(prices)) {
        for (const p of items) {
          priceIdx.set(`${category}|${p.name}|${p.unit}`, p.priceRub)
          flat.push({ category, name: p.name, unit: p.unit, priceRub: p.priceRub })
        }
      }
      catalog.value = flat
      const weightIdx = new Map<string, number>()
      for (const w of weights.grp) weightIdx.set(`${w.dn}|${w.pn}|${w.sn}`, w.kgPerM)

      rates.value = {
        fotRub: priceIdx.get('ФОТ|ФОТ|чел. ч') ?? FALLBACK_RATES.fotRub,
        overheadRub: FALLBACK_RATES.overheadRub,
        acetoneRub: FALLBACK_RATES.acetoneRub,
        ppeRub: FALLBACK_RATES.ppeRub,
      }

      const ctx: MaterializeContext = {
        priceOf: (c, n, u) => priceIdx.get(`${c}|${n}|${u}`) ?? null,
        pipeWeightOf: (dn, pn, sn) => weightIdx.get(`${dn}|${pn}|${sn}`) ?? null,
        priceListVersion: priceListVersion.value,
      }

      const saved = est.surveyData as Record<string, unknown>

      // Дерево уже материализовано — поднимаем его как есть: расчёт
      // самодостаточен, повторная материализация затёрла бы overrides.
      if (saved.tree && typeof saved.tree === 'object') {
        tree.value = saved.tree as CalcTree
      } else {
        const params = surveyToParams(saved)
        if (!params) {
          error.value = 'В расчёте нет параметров опросного листа — материализация невозможна'
          return
        }
        tree.value = materializeKns(ctx, params)
        recalcAll()
      }

      snapshotQtyCalc()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить расчёт'
    } finally {
      loading.value = false
    }
  }

  /** Параметры ОЛ из surveyData, сохранённые экраном опросного листа. */
  function surveyToParams(saved: Record<string, unknown>): KnsSurveyParams | null {
    const kns = saved.kns as Record<string, string | boolean> | undefined
    const derived = saved.derived as Record<string, number | null> | undefined
    if (!kns || !derived?.npodzMm) return null

    const n = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0
    return {
      dn: n(kns.dn),
      depthMm: derived.npodzMm,
      pnSurvey: derived.pn ?? 0.1,
      sn: derived.sn ?? 10000,
      inletDn: n(kns.podvDn),
      inletCount: n(kns.podvKol),
      outletDn: n(kns.napDn),
      outletCount: n(kns.napKol),
      pumpsWorking: n(kns.nRab),
      pumpsReserve: n(kns.nRez),
      valveOnInlet: Boolean(kns.valveOnInlet),
      emergencyPipeline: Boolean(kns.emergency),
      insulationEnabled: Boolean(kns.insulation),
      insulationDepthMm: n(kns.tiGlubina),
    }
  }

  // ── Пересчёт ──────────────────────────────────────────────────────────────

  /** Пересчитывает ФОТ-спутники по всему дереву. */
  function recalcAll() {
    if (!tree.value) return
    const updated = recalcFotSatellites(flattenRows(tree.value), { tirage: 1 })
    const byId = new Map(updated.map((r) => [r.id, r]))
    for (const s of tree.value.sections) {
      for (const c of s.components) {
        c.rows = c.rows.map((r) => (byId.get(r.id) as CalcRowNode) ?? r)
      }
    }
  }

  function snapshotQtyCalc() {
    if (!tree.value) return
    const map: Record<string, number | null> = {}
    for (const r of flattenRows(tree.value)) map[r.id] = r.qtyCalc
    prevQtyCalc.value = map
  }

  // ── Производные ───────────────────────────────────────────────────────────

  const rows = computed<CalcRowNode[]>(() => (tree.value ? flattenRows(tree.value) : []))

  const enabledFor = computed(() => (tree.value ? sectionEnabledFor(tree.value) : () => true))

  /** Результат по каждой строке — единая точка расчёта для всего экрана. */
  const results = computed<Map<string, RowResult>>(() => {
    const m = new Map<string, RowResult>()
    for (const r of rows.value) {
      m.set(r.id, computeRow(r, { sectionEnabled: enabledFor.value(r), tirage: tirage.value }))
    }
    return m
  })

  const economics = computed(() =>
    computeEconomics(
      aggregateRows(rows.value, { sectionEnabled: enabledFor.value, tirage: tirage.value }),
      rates.value,
      { markup: markup.value },
    ),
  )

  /** Строки без цены — блокируют выпуск КП (Механика §10). */
  const missingPriceIds = computed(
    () => new Set(rows.value.filter((r) => results.value.get(r.id)?.missingPrice).map((r) => r.id)),
  )

  /** Конфликты: override поверх изменившегося расчётного (Механика §8.3). */
  const conflictIds = computed(() => {
    const s = new Set<string>()
    for (const r of rows.value) {
      if (conflictsKept.value.has(r.id)) continue
      const prev = prevQtyCalc.value[r.id]
      if (prev == null || r.qtyCalc == null) continue
      if (r.qtyManual != null && prev !== r.qtyCalc) s.add(r.id)
    }
    return s
  })

  const overrideIds = computed(
    () =>
      new Set(
        rows.value
          .filter((r) => {
            const res = results.value.get(r.id)
            return res?.qtyOverridden || res?.priceOverridden
          })
          .map((r) => r.id),
      ),
  )

  // ── Действия ──────────────────────────────────────────────────────────────

  function setQtyManual(id: string, expr: string) {
    const row = rows.value.find((r) => r.id === id)
    if (!row) return
    row.qtyManual = expr.trim() === '' ? null : expr
    recalcAll()
  }

  function setPriceManual(id: string, value: number | null) {
    const row = rows.value.find((r) => r.id === id)
    if (row) row.priceManual = value
  }

  function resetQty(id: string) {
    setQtyManual(id, '')
  }

  function resetPrice(id: string) {
    setPriceManual(id, null)
  }

  function toggleSection(code: string) {
    const s = tree.value?.sections.find((x) => x.code === code)
    if (s) s.enabled = !s.enabled
  }

  function toggleComponent(sectionCode: string, componentId: string) {
    const c = tree.value?.sections
      .find((x) => x.code === sectionCode)
      ?.components.find((x) => x.id === componentId)
    if (c) c.enabled = !c.enabled
  }

  /** «Оставить моё» — гасит конфликт, override сохраняется. */
  function keepOverride(id: string) {
    conflictsKept.value.add(id)
    prevQtyCalc.value[id] = rows.value.find((r) => r.id === id)?.qtyCalc ?? null
  }

  /** «Принять новое» — сбрасывает override к расчётному. */
  function dropOverride(id: string) {
    resetQty(id)
    prevQtyCalc.value[id] = rows.value.find((r) => r.id === id)?.qtyCalc ?? null
  }

  /**
   * Компонент для строк, добавленных инженером вручную.
   *
   * Строки шаблона удалять нельзя — только выключать (Механика §12.5);
   * удалять можно лишь добавленные вручную, поэтому они живут отдельно
   * и помечены `isCustom`.
   */
  function customComponentOf(sectionCode: string): CalcComponent | null {
    const sec = tree.value?.sections.find((s) => s.code === sectionCode)
    if (!sec) return null
    let c = sec.components.find((x) => x.id.startsWith('custom-'))
    if (!c) {
      c = { id: `custom-${sectionCode}`, title: 'Добавлено вручную', enabled: true, rows: [] }
      sec.components.push(c)
    }
    return c
  }

  let customSeq = 0
  function addRow(sectionCode: string, spec: Partial<CalcRowNode>): string | null {
    const c = customComponentOf(sectionCode)
    if (!c) return null
    const id = `cu-${++customSeq}-${Date.now().toString(36)}`
    c.rows.push({
      id,
      kind: 'МАТЕРИАЛ',
      category: 'Прочие материалы',
      name: '',
      unit: 'шт',
      qtyCalc: null,
      qtyManual: null,
      priceCatalog: null,
      priceManual: null,
      enabled: true,
      isCustom: true,
      ...spec,
    } as CalcRowNode)
    return id
  }

  /** Удалять можно только строки, добавленные вручную (Механика §12.5). */
  function removeRow(id: string) {
    if (!tree.value) return
    for (const s of tree.value.sections) {
      for (const c of s.components) {
        const i = c.rows.findIndex((r) => r.id === id && r.isCustom)
        if (i >= 0) { c.rows.splice(i, 1); return }
      }
    }
  }

  /** Коэффициент ФОТ строки-спутника — для метки «ФОТ · k=0,28». */
  function fotKOf(row: CalcRowNode): number | null {
    if (row.kind !== 'ФОТ' || !row.parentId) return null
    const parent = rows.value.find((r) => r.id === row.parentId)
    return row.fotK ?? (parent ? resolveFotK(parent) : null)
  }

  async function save() {
    if (!estimate.value || !tree.value) return
    await estimatesApi.patchSurvey(estimate.value.id, {
      tree: tree.value,
      totals: {
        costRub: economics.value.costRub,
        salePriceRub: economics.value.salePriceRub,
        markup: markup.value,
        tirage: tirage.value,
      },
    })
  }

  function clear() {
    estimate.value = null
    tree.value = null
    conflictsKept.value = new Set()
    prevQtyCalc.value = {}
  }

  return {
    estimate, tree, rates, markup, tirage, loading, error, catalog,
    rows, results, economics, missingPriceIds, conflictIds, overrideIds, enabledFor,
    load, save, clear, recalcAll,
    setQtyManual, setPriceManual, resetQty, resetPrice,
    toggleSection, toggleComponent, keepOverride, dropOverride, fotKOf,
    addRow, removeRow,
  }
})
