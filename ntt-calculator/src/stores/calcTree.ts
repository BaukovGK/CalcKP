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
import {
  materializeEmk,
  materializeKol,
  type EmkSurveyParams,
  type KolSurveyParams,
} from '@/engines/template-emk-kol'
import { estimatesApi, type EstimateDetail } from '@/api/estimates'
import { refsApi } from '@/api/refs'
import type { RowResult } from '@/engines/types'

/**
 * Стор дерева расчёта (§9, Библиотека §6.3).
 *
 * Пришёл на смену legacy-стору свободного дерева (связка→группа→подгруппа→
 * строка, удалён 2026-07-20): целевая структура — материализованное
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
  /**
   * Ревизия ОЛ, на которой материализовано текущее дерево. Если сохранённый
   * `surveyData.surveyRev` больше — ОЛ правили после материализации, и load()
   * рематериализует дерево с переносом overrides и пометкой конфликтов.
   */
  const treeSurveyRev = ref(0)

  // ── Загрузка ──────────────────────────────────────────────────────────────

  async function load(id: string) {
    loading.value = true
    error.value = null
    try {
      const [est, prices, weights, engineering] = await Promise.all([
        estimatesApi.get(id),
        refsApi.nomenclature(),
        refsApi.pipeWeights(),
        refsApi.engineering(),
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

      // Все четыре ставки — позиции прайса (Механика §9): обновление прайса
      // меняет экономику новых расчётов. Fallback — если позиции в базе нет
      // (например, БД засеяна до их добавления).
      rates.value = {
        fotRub: priceIdx.get('ФОТ|ФОТ|чел. ч') ?? FALLBACK_RATES.fotRub,
        overheadRub: priceIdx.get('ФОТ|Накладные расходы|чел. ч') ?? FALLBACK_RATES.overheadRub,
        acetoneRub: priceIdx.get('Прочие материалы|Ацетон|кг') ?? FALLBACK_RATES.acetoneRub,
        ppeRub: priceIdx.get('Прочие материалы|СИЗ и РМ|ед.') ?? FALLBACK_RATES.ppeRub,
      }

      // Нормы патрубков — источник массы формовки гильз (лист «Для расчетов»).
      // Ключ — DN гильзы; сетка дискретна, промахи дают «красную» строку.
      const normIdx = new Map(engineering.nozzles.map((n) => [n.dn, n]))

      const ctx: MaterializeContext = {
        priceOf: (c, n, u) => priceIdx.get(`${c}|${n}|${u}`) ?? null,
        pipeWeightOf: (dn, pn, sn) => weightIdx.get(`${dn}|${pn}|${sn}`) ?? null,
        nozzleNormOf: (dn) => normIdx.get(dn) ?? null,
        priceListVersion: priceListVersion.value,
      }

      const saved = est.surveyData as Record<string, unknown>
      const savedRev = typeof saved.surveyRev === 'number' ? saved.surveyRev : 0
      const builtRev = typeof saved.treeSurveyRev === 'number' ? saved.treeSurveyRev : 0
      conflictsKept.value = new Set()

      const savedTree = saved.tree && typeof saved.tree === 'object' ? (saved.tree as CalcTree) : null

      if (savedTree && savedRev <= builtRev) {
        // ОЛ не менялся с последней материализации — поднимаем дерево как
        // есть: повторная материализация затёрла бы overrides.
        tree.value = savedTree
        treeSurveyRev.value = builtRev
        snapshotQtyCalc()
      } else if (savedTree) {
        // ОЛ правили после материализации (surveyRev вырос): строим свежее
        // дерево из новых параметров и переносим в него ручные правки.
        // Строки, где override лёг на изменившееся расчётное, вспыхнут
        // конфликтом «было → стало» (Механика §8.3).
        const fresh = materializeByDevice(ctx, est.deviceType, saved)
        if (fresh) {
          reconcileTrees(savedTree, fresh)
          tree.value = fresh
          treeSurveyRev.value = savedRev
          recalcAll()
        } else {
          // Параметры ОЛ пропали — не теряем работу, показываем старое дерево.
          tree.value = savedTree
          treeSurveyRev.value = builtRev
          snapshotQtyCalc()
        }
      } else {
        // Шаблон выбирается по типу изделия: структура разделов у КНС (7),
        // ЕМК (8) и КОЛ (7 без напорного) РАЗНАЯ — материализовать ёмкость
        // шаблоном КНС нельзя.
        const built = materializeByDevice(ctx, est.deviceType, saved)
        if (!built) {
          error.value =
            est.deviceType === 'KNS'
              ? 'В расчёте нет параметров опросного листа — материализация невозможна'
              : `В расчёте нет параметров ОЛ для изделия ${est.deviceType} — заполните опросный лист`
          return
        }
        tree.value = built
        treeSurveyRev.value = savedRev
        recalcAll()
        snapshotQtyCalc()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить расчёт'
    } finally {
      loading.value = false
    }
  }

  /**
   * Материализация по типу изделия.
   *
   * Возвращает `null`, если параметров ОЛ нет — тогда экран показывает
   * объяснение, а не пустое дерево.
   */
  function materializeByDevice(
    ctx: MaterializeContext,
    deviceType: string,
    saved: Record<string, unknown>,
  ): CalcTree | null {
    switch (deviceType) {
      case 'EMK': {
        const p = saved.emk as EmkSurveyParams | undefined
        return p ? materializeEmk(ctx, p) : null
      }
      case 'KOL': {
        const p = saved.kol as KolSurveyParams | undefined
        return p ? materializeKol(ctx, p) : null
      }
      default: {
        const p = surveyToParams(saved)
        return p ? materializeKns(ctx, p) : null
      }
    }
  }

  /** Параметры ОЛ КНС из surveyData, сохранённые экраном опросного листа. */
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
      // Влияет только на обозначение жёсткости в марке трубы (8000/12000).
      mvk: Boolean(kns.mvk),
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

  /**
   * Стабильный ключ строки для сопоставления между материализациями.
   *
   * Id строк порождаются глобальным счётчиком и МЕНЯЮТСЯ при каждой
   * материализации, поэтому сопоставляем по содержимому: вид + наименование +
   * ЕИ (внутри компонента, с учётом повторов по порядку следования).
   */
  function rowMatchKey(r: CalcRowNode): string {
    return `${r.kind}|${r.name}|${r.unit}`
  }

  /**
   * Переносит ручные правки из старого дерева в свежематериализованное:
   * qtyManual/priceManual/enabled строк, тумблеры разделов и компонентов,
   * компоненты «Добавлено вручную» — целиком.
   *
   * `prevQtyCalc` заполняется СТАРЫМИ расчётными количествами: если у строки
   * с override новое qtyCalc отличается — она попадёт в conflictIds.
   */
  function reconcileTrees(oldTree: CalcTree, fresh: CalcTree) {
    const prev: Record<string, number | null> = {}

    for (const os of oldTree.sections) {
      const ns = fresh.sections.find((s) => s.code === os.code)
      if (!ns) continue
      ns.enabled = os.enabled

      for (const oc of os.components) {
        // Ручные строки не порождаются шаблоном — переносим компонент целиком.
        if (oc.id.startsWith('custom-')) {
          ns.components.push({ ...oc, rows: oc.rows.map((r) => ({ ...r })) })
          continue
        }

        const nc = ns.components.find((c) => c.title === oc.title)
        if (!nc) continue
        nc.enabled = oc.enabled

        const used = new Set<number>()
        for (const or of oc.rows) {
          const key = rowMatchKey(or)
          const idx = nc.rows.findIndex((nr, i) => !used.has(i) && rowMatchKey(nr) === key)
          const nr = idx >= 0 ? nc.rows[idx] : undefined
          if (!nr) continue
          used.add(idx)
          nr.qtyManual = or.qtyManual
          nr.priceManual = or.priceManual
          nr.enabled = or.enabled
          prev[nr.id] = or.qtyCalc
        }
      }
    }

    prevQtyCalc.value = prev
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

  /**
   * Экономика ОДНОГО корпуса при тираже ≥2 — отдельный прогон с tirage=1:
   * ПЗР/СИЗ/округления нелинейны, делить итог на N нельзя.
   */
  const economicsUnit = computed(() =>
    tirage.value >= 2
      ? computeEconomics(
          aggregateRows(rows.value, { sectionEnabled: enabledFor.value, tirage: 1 }),
          rates.value,
          { markup: markup.value },
        )
      : economics.value,
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
      // Фиксируем, из какой ревизии ОЛ построено дерево, — чтобы load()
      // не рематериализовал его повторно.
      treeSurveyRev: treeSurveyRev.value,
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
    rows, results, economics, economicsUnit, missingPriceIds, conflictIds, overrideIds, enabledFor, prevQtyCalc,
    load, save, clear, recalcAll,
    setQtyManual, setPriceManual, resetQty, resetPrice,
    toggleSection, toggleComponent, keepOverride, dropOverride, fotKOf,
    addRow, removeRow,
  }
})
