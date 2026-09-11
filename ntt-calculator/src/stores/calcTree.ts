import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'
import { aggregateRows, computeEconomics, DEFAULT_MARKUP, type RateKey, type TreeRates } from '@/engines/economics'
import { recalcFotSatellites, resolveFotK } from '@/engines/fot'
import { computeRow, manualQty, resolveQty } from '@/engines/row'
import {
  flattenRows,
  sectionEnabledFor,
  type CalcComponent,
  type CalcRowNode,
  type CalcSection,
  type CalcTree,
  type KnsSurveyParams,
  type LostEdit,
  type MaterializeContext,
} from '@/engines/template-kns'
import { titleStem } from '@/engines/component-key'
import type { EmkSurveyParams, KolSurveyParams } from '@/engines/template-emk-kol'
import { materializeEmk, materializeKns, materializeKol } from '@/engines/materialize'
import { materializeNode, type CatalogNode, type NodeParamValues } from '@/engines/node-def'
import { builtinRevision, revisionsAfter, type BuiltinRevision } from '@/engines/builtin-revisions'
import { estimatesApi, type EstimateDetail } from '@/api/estimates'
import type { ActiveTemplates } from '@/api/refs'
import {
  activeTemplateVersion as activeTemplateVersionOf,
  FALLBACK_RATES,
  loadMaterializeContext,
  NO_TEMPLATES,
  TemplatesUnavailableError,
  type CatalogItem,
} from '@/utils/materialize-context'
import { CalcDeferredError } from './calc-errors'
import { stableStringify } from '@/utils/stable-stringify'
import type { PriceBinding, RowResult } from '@/engines/types'
import { PRICE_BINDING_FIELDS } from '@/engines/price-binding'
import { tryEvalExpr } from '@/engines/expr'
import { hasBasketIn, hasGrinderIn, PIPE_MATERIALS, type Grinder, type PipeMaterial } from '@/types/survey'
import { normalizePriceName, normalizePriceText } from '@/engines/price-name'
import { hasPriceDelta, hasPriceDrift, priceMarkAfter, repriceTree, type RepriceSummary } from '@/engines/reprice'

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

/**
 * Узлы, которые до своей связи с тумблером ОЛ строились включёнными всегда:
 * B1 — лестница, C1 — вентстояк (у ёмкости и колодца тумблеры дошли до них
 * 10.09.2026). См. reconciledEnabled.
 */
const ALWAYS_ON_BEFORE_SURVEY = new Set(['B1', 'C1'])

/**
 * Узлы шаблона, сменившие название: прежнее → нынешнее. Сопоставление при
 * пересборке идёт по названию узла, и без этой записи ручные правки строк
 * переименованного узла у старых расчётов потерялись бы.
 *
 * «Направляющие насосов и работы по нитке» (раздел 5) — до 10.09.2026:
 * направляющие ушли в крепление насосов раздела 3, в узле остались работы
 * по нитке.
 */
const RENAMED_COMPONENTS: Readonly<Record<string, string>> = {
  'Направляющие насосов и работы по нитке': 'Работы по напорному трубопроводу',
}

export const useCalcTreeStore = defineStore('calcTree', () => {
  const estimate = ref<EstimateDetail | null>(null)
  const tree = ref<CalcTree | null>(null)
  /**
   * Ставки действующего прайса. Экономика берёт их только у дерева, собранного
   * до фиксации ставок, — и до его первого сохранения (План_устранения, 1.3).
   */
  const liveRates = ref<TreeRates>({ ...FALLBACK_RATES })
  /**
   * Подпись сохранённого состояния — дерево, наценка, тираж, какими они ушли
   * на сервер последней записью или пришли с загрузкой. Экран расчёта
   * сверяет с ней текущее и знает, есть ли несохранённое (План_устранения
   * 3.2). `null` — сохранённого нет: дерево пересобрано при загрузке.
   */
  const savedSignature = ref<string | null>(null)
  /** Ставки, по которым считается экономика: дерева, а у старого дерева — прайса. */
  const rates = computed<TreeRates>(() => tree.value?.rates ?? liveRates.value)
  /**
   * Ставки, которых не нашлось в прайсе: взяты константы кода. КП по такому
   * расчёту не выпускается (решение Р5), экран предупреждает.
   */
  const rateFallbacks = computed<RateKey[]>(() => rates.value.fallback ?? [])
  const priceListVersion = ref(1)
  /** Плоский прайс — источник для модала «Компонент из каталога». */
  const catalog = ref<CatalogItem[]>([])
  /**
   * Действующие шаблоны изделий и опубликованные узлы каталога (редактор
   * шаблонов): по ним материализуется расчёт и вставляются узлы вручную.
   */
  const templates = ref<ActiveTemplates>(NO_TEMPLATES)

  const markup = ref(DEFAULT_MARKUP)
  const tirage = ref(1)

  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Ревизия ОЛ, на которой материализовано текущее дерево. Если сохранённый
   * `surveyData.surveyRev` больше — ОЛ правили после материализации, и load()
   * рематериализует дерево с переносом overrides и пометкой конфликтов.
   */
  const treeSurveyRev = ref(0)

  // ── Загрузка ──────────────────────────────────────────────────────────────

  /**
   * Контекст материализации — справочники, прайс, действующие шаблоны
   * изделий и узлы каталога, собранные в индексы (utils/materialize-context.ts).
   *
   * Кешируется на время жизни стора: ОЛ пересчитывает расчёт после каждой
   * правки, и тянуть 1040 позиций прайса и три справочника на каждое нажатие
   * клавиши незачем — они меняются сменой версии прайса, а не вводом в ОЛ.
   */
  let ctxCache: MaterializeContext | null = null
  /**
   * Счётчик загрузок контекста. Сам `ctxCache` не реактивен, и вычисления,
   * которые читают его цены (priceDrift), зависят от этого счётчика: иначе
   * свежий прайс при тех же дереве и номере версии их бы не пересчитал.
   */
  const ctxLoads = ref(0)

  async function ensureContext(opts: { fresh?: boolean } = {}): Promise<MaterializeContext> {
    if (ctxCache && !opts.fresh) return ctxCache
    const loaded = await loadMaterializeContext()
    // Настоящая версия прайса, а не константа: снапшот фиксирует именно её,
    // и топбар обязан показывать то же самое (ТЗ §3).
    priceListVersion.value = loaded.priceListVersion
    catalog.value = loaded.catalog
    liveRates.value = loaded.rates
    templates.value = loaded.templates
    ctxCache = loaded.ctx
    ctxLoads.value++
    return ctxCache
  }

  /** Цена позиции прайса — для подсказок ОЛ (например, цена насоса по марке). */
  function catalogPrice(category: string, name: string, unit: string): number | null {
    return ctxCache?.priceOf(category, name, unit) ?? null
  }

  // ── Очередь записи ────────────────────────────────────────────────────────

  /**
   * Записи расчёта, которые ещё летят на сервер: пересчёт из ОЛ и сохранение.
   *
   * Уход с ОЛ досохраняет последнюю правку (useSurveySync, onBeforeUnmount), а
   * экран расчёта в ту же секунду читает изделие. Без очереди чтение обгоняло
   * запись: расчёт показывал прежнее дерево — цена, только что введённая в ОЛ,
   * «не переносилась», — а первое же сохранение из расчёта возвращало старую
   * цифру и в ОЛ. Поэтому записи идут по одной, а чтение ждёт начатых.
   */
  let writes: Promise<unknown> = Promise.resolve()

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = writes.then(job)
    // Упавшая запись очередь не останавливает: ошибку получит её вызвавший.
    writes = run.catch(() => undefined)
    return run
  }

  /** Дождаться записей, начатых к этому моменту, — перед чтением изделия. */
  function settled(): Promise<void> {
    return writes.then(() => undefined)
  }

  async function load(id: string) {
    loading.value = true
    error.value = null
    try {
      await settled()
      await fetchEstimate(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Не удалось загрузить расчёт'
    } finally {
      loading.value = false
    }
  }

  /** Прочитать изделие и поднять дерево — без ожидания очереди записи. */
  async function fetchEstimate(id: string) {
    // Экран расчёта всегда берёт свежий прайс: между визитами его могли
    // поправить, а кеш нужен только частым пересчётам из ОЛ.
    const [est, ctx] = await Promise.all([estimatesApi.get(id), ensureContext({ fresh: true })])
    estimate.value = est

    const saved = est.surveyData as Record<string, unknown>
    restoreTotals(saved)

    const savedTree = saved.tree && typeof saved.tree === 'object' ? (saved.tree as CalcTree) : null
    const problem = rebuildTree(ctx, est.deviceType, saved, savedTree, { force: false })
    if (problem) error.value = problem
    // Дерево поднято как есть — оно и сохранено; пересобрано по изменившемуся
    // ОЛ — ещё нет, его сохранит автосохранение.
    savedSignature.value = tree.value && toRaw(tree.value) === savedTree ? stateSignature() : null
  }

  /**
   * Наценка и тираж из сохранённых итогов.
   *
   * save() их пишет, а load() раньше не читал — после переоткрытия расчёт молча
   * возвращался к 0,43 и 1 корпусу, а следующее сохранение затирало
   * сохранённое. Оба параметра влияют на цену продажи, поэтому
   * восстанавливаются до первого пересчёта.
   */
  function restoreTotals(saved: Record<string, unknown>) {
    const savedTotals = (saved.totals ?? {}) as Record<string, unknown>
    markup.value = typeof savedTotals.markup === 'number' && Number.isFinite(savedTotals.markup)
      ? savedTotals.markup
      : DEFAULT_MARKUP
    tirage.value = typeof savedTotals.tirage === 'number' && Number.isInteger(savedTotals.tirage) && savedTotals.tirage >= 1
      ? savedTotals.tirage
      : 1
  }

  /**
   * Дерево из сохранённого ОЛ.
   *
   * ОЛ не менялся с последней материализации — дерево поднимается как есть:
   * повторная материализация затёрла бы overrides. Менялся (surveyRev вырос)
   * или пересчёт запрошен явно — строится свежее дерево из новых параметров,
   * и в него переносятся ручные правки. Строки, где override лёг на
   * изменившееся расчётное, помечаются конфликтом «было → стало»
   * (Механика §8.3).
   *
   * Шаблон выбирается по типу изделия: структура разделов у КНС (7), ЕМК (8)
   * и КОЛ (7 без напорного) РАЗНАЯ — материализовать ёмкость шаблоном КНС
   * нельзя.
   *
   * @returns текст проблемы, если строить не из чего, иначе `null`
   */
  function rebuildTree(
    ctx: MaterializeContext,
    deviceType: string,
    saved: Record<string, unknown>,
    baseTree: CalcTree | null,
    opts: { force: boolean },
  ): string | null {
    const savedRev = typeof saved.surveyRev === 'number' ? saved.surveyRev : 0
    const builtRev = typeof saved.treeSurveyRev === 'number' ? saved.treeSurveyRev : 0

    if (baseTree && savedRev <= builtRev && !opts.force) {
      tree.value = baseTree
      treeSurveyRev.value = builtRev
      return null
    }

    const fresh = materializeByDevice(ctx, deviceType, saved)
    if (!fresh) {
      // Параметры ОЛ пропали — не теряем работу, показываем старое дерево.
      if (baseTree) {
        tree.value = baseTree
        treeSurveyRev.value = builtRev
        return null
      }
      return deviceType === 'KNS'
        ? 'В расчёте нет параметров опросного листа — материализация невозможна'
        : `В расчёте нет параметров ОЛ для изделия ${deviceType} — заполните опросный лист`
    }

    if (baseTree) {
      const lost = reconcileTrees(baseTree, fresh)
      const kept = baseTree.lostEdits ?? []
      if (kept.length || lost.length) fresh.lostEdits = [...kept, ...lost]
      lastLostCount.value = lost.length
    } else {
      lastLostCount.value = 0
    }
    tree.value = fresh
    treeSurveyRev.value = savedRev
    recalcAll()
    return null
  }

  /**
   * Правка ОЛ → пересчёт расчёта → сохранение. Одним запросом.
   *
   * ОЛ — основной экран изделия: расчёт следует за ним сам, без кнопки.
   * Дерево строится заново из новых параметров, ручные правки переносятся
   * (reconcileTrees), а конфликты «было → стало» остаются в дереве и
   * дожидаются экрана расчёта. ОЛ, дерево и итоги уходят одним PATCH: двумя
   * запросами сервер между ними держал бы ОЛ новее дерева, и открытый в эту
   * секунду расчёт пересобрался бы ещё раз.
   *
   * @param payload поля surveyData, которые пишет ОЛ (form, kns/emk/kol, derived…)
   * @returns цена продажи после пересчёта, ₽ — её показывает живая панель ОЛ
   */
  function applySurvey(id: string, payload: Record<string, unknown>): Promise<number | null> {
    return enqueue(() => applySurveyNow(id, payload))
  }

  async function applySurveyNow(id: string, payload: Record<string, unknown>): Promise<number | null> {
    let ctx: MaterializeContext
    try {
      ctx = await ensureContext()
    } catch (e) {
      // Справочники или шаблоны не загрузились — дерево не строится:
      // собранное встроенным шаблоном вместо действующего, оно ушло бы в базу
      // молча. Сохраняется только ОЛ; ревизия ОЛ растёт, ревизия дерева —
      // нет, и расчёт пересоберётся при следующей правке или открытии
      // (План_устранения, 1.4). Контекст не закеширован — следующая попытка
      // загрузит его заново.
      const updated = await estimatesApi.patchSurvey(id, payload)
      if (estimate.value?.id === id) estimate.value = mergeEstimate(estimate.value, updated)
      throw new CalcDeferredError(
        `${e instanceof TemplatesUnavailableError ? 'шаблоны изделий' : 'справочники'} не загрузились — расчёт пересоберётся позже`,
      )
    }

    // Первый пересчёт в сессии ОЛ: поднимаем расчёт с сервера — нужны его
    // ручные правки, иначе перенести было бы нечего.
    if (!estimate.value || estimate.value.id !== id) await loadForSurvey(id)

    try {
      return await writeSurvey(id, ctx, payload)
    } catch (e) {
      if (!isEstimateChanged(e)) throw e
      // Расчёт правили после того, как лист его прочитал, — в другой вкладке
      // или другой пользователь (План_устранения 3.1). Перечитываем и
      // пересобираем по своему ОЛ поверх чужих правок — один раз; ревизия
      // ОЛ — выше сохранённой, она не уменьшается.
      await loadForSurvey(id)
      const storedRev = surveyRevOf(estimate.value?.surveyData)
      const rev = typeof payload.surveyRev === 'number' ? payload.surveyRev : null
      return await writeSurvey(id, ctx, rev != null && rev <= storedRev ? { ...payload, surveyRev: storedRev + 1 } : payload)
    }
  }

  /** Поднять расчёт с сервера для пересчёта из ОЛ: ручные правки, итоги, версия. */
  async function loadForSurvey(id: string) {
    const est = await estimatesApi.get(id)
    estimate.value = est
    const saved = est.surveyData as Record<string, unknown>
    restoreTotals(saved)
    tree.value = saved.tree && typeof saved.tree === 'object' ? (saved.tree as CalcTree) : null
  }

  /** Пересобрать дерево по ОЛ и записать — с версией, с которой работали. */
  async function writeSurvey(id: string, ctx: MaterializeContext, payload: Record<string, unknown>): Promise<number | null> {
    const current = estimate.value as EstimateDetail
    const merged = { ...(current.surveyData as Record<string, unknown>), ...payload }
    const problem = rebuildTree(ctx, current.deviceType, merged, tree.value, { force: true })
    const version = baseVersionOf(current)

    // Строить не из чего (ОЛ ещё не заполнен до материализации) — сохраняем
    // сам ОЛ: ввод не должен теряться из-за того, что расчёт пока невозможен.
    if (problem || !tree.value) {
      const updated = await estimatesApi.patchSurvey(id, { ...payload, ...version })
      estimate.value = mergeEstimate(current, updated)
      return null
    }

    const body = {
      ...payload,
      tree: treeForSave(),
      treeSurveyRev: treeSurveyRev.value,
      totals: totalsForSave(),
      ...version,
    }
    estimate.value = mergeEstimate(current, await estimatesApi.patchSurvey(id, body))
    return economics.value.salePriceRub
  }

  /** Версия расчёта для записи; у расчёта до её появления — ничего. */
  function baseVersionOf(est: EstimateDetail): { baseVersion?: number } {
    return typeof est.version === 'number' ? { baseVersion: est.version } : {}
  }

  /** Ревизия ОЛ, сохранённая в расчёте. */
  function surveyRevOf(surveyData: unknown): number {
    const rev = surveyData && typeof surveyData === 'object' ? (surveyData as Record<string, unknown>).surveyRev : null
    return typeof rev === 'number' ? rev : 0
  }

  /** 409: расчёт изменился после того, как его прочитали (План_устранения 3.1). */
  function isEstimateChanged(e: unknown): boolean {
    const r = (e as { response?: { status?: number; data?: { code?: string } } }).response
    return r?.status === 409 && r.data?.code === 'ESTIMATE_CHANGED'
  }

  /**
   * Ответ PATCH — голая запись расчёта, без истории снапшотов: подмешиваем её
   * к загруженной, чтобы не потерять то, чего сервер в этом ответе не шлёт.
   */
  function mergeEstimate(current: EstimateDetail, updated: EstimateDetail): EstimateDetail {
    return { ...current, ...updated, snapshots: updated.snapshots ?? current.snapshots }
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
        return p ? materializeEmk(ctx, emkParamsWithForm(p, saved.form)) : null
      }
      case 'KOL': {
        const p = saved.kol as KolSurveyParams | undefined
        return p ? materializeKol(ctx, kolParamsWithForm(p, saved.form)) : null
      }
      default: {
        const p = surveyToParams(saved)
        return p ? materializeKns(ctx, p) : null
      }
    }
  }

  /** Материал подходящей трубы из формы ОЛ; не из списка — нет. */
  function formMaterial(v: unknown): PipeMaterial | null {
    return (PIPE_MATERIALS as readonly unknown[]).includes(v) ? (v as PipeMaterial) : null
  }

  /**
   * Параметры ёмкости, сохранённые до появления полей оборудования, числа
   * шахт (редакция 2 встроенного шаблона ЕМК) и материала патрубков
   * (редакция 3): ответы ОЛ «Запорная арматура», «Шкаф управления»,
   * «Датчики уровня», марка насосов и материал лежали в самой форме
   * (`form`), но в параметры расчёта не попадали. Недостающее берётся из
   * формы — пересборка старого расчёта строит те же узлы, что построила бы
   * правка ОЛ.
   */
  function emkParamsWithForm(p: EmkSurveyParams, form: unknown): EmkSurveyParams {
    const f = (form && typeof form === 'object' ? form : {}) as Record<string, unknown>
    const flag = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined)
    return {
      ...p,
      shaftCount: p.shaftCount ?? tryEvalExpr(String(f.shaftCount ?? '')),
      pumpModel: p.pumpModel ?? (typeof f.marka === 'string' && f.marka.trim() ? f.marka.trim() : null),
      valveOnInlet: p.valveOnInlet ?? flag(f.hasValves),
      hasControlCabinet: p.hasControlCabinet ?? flag(f.shu),
      hasLevelSensor: p.hasLevelSensor ?? flag(f.datchikiUrov),
      inletMaterial: p.inletMaterial ?? formMaterial(f.podvMat),
      outletMaterial: p.outletMaterial ?? formMaterial(f.otvMat),
    }
  }

  /**
   * Параметры колодца, сохранённые до появления материала патрубков
   * (редакция 3 встроенного шаблона КОЛ): материал берётся из формы ОЛ, как
   * у ёмкости (`emkParamsWithForm`).
   */
  function kolParamsWithForm(p: KolSurveyParams, form: unknown): KolSurveyParams {
    const f = (form && typeof form === 'object' ? form : {}) as Record<string, unknown>
    return {
      ...p,
      inletMaterial: p.inletMaterial ?? formMaterial(f.podvMat),
      outletMaterial: p.outletMaterial ?? formMaterial(f.otvMat),
    }
  }

  /** Параметры ОЛ КНС из surveyData, сохранённые экраном опросного листа. */
  function surveyToParams(saved: Record<string, unknown>): KnsSurveyParams | null {
    const kns = saved.kns as Record<string, string | boolean> | undefined
    const derived = saved.derived as Record<string, number | string | null> | undefined
    if (!kns || typeof derived?.npodzMm !== 'number') return null
    const dNum = (k: string): number | null => (typeof derived[k] === 'number' ? (derived[k] as number) : null)

    const n = (v: unknown) => Number(String(v ?? '').replace(',', '.')) || 0
    return {
      dn: n(kns.dn),
      depthMm: derived.npodzMm,
      pnSurvey: dNum('pn') ?? 0.1,
      sn: dNum('sn') ?? 10000,
      // Марка насоса: подобрана сервером либо введена вручную (ОЛ, блок 4).
      pumpModel: typeof derived.pumpModel === 'string' ? derived.pumpModel : null,
      // Влияет только на обозначение жёсткости в марке трубы (8000/12000).
      mvk: Boolean(kns.mvk),
      inletDn: n(kns.podvDn),
      inletCount: n(kns.podvKol),
      outletDn: n(kns.napDn),
      outletCount: n(kns.napKol),
      // Стеклокомпозитная труба заводится через муфту, прочие — через гильзу.
      inletMaterial: formMaterial(kns.podvMat),
      outletMaterial: formMaterial(kns.napMat),
      pumpsWorking: n(kns.nRab),
      pumpsReserve: n(kns.nRez),
      // Запасные на склад — в поставку насосов, но не в монтаж и такелаж.
      pumpsSpare: n(kns.nZap),
      // Возвышение над землёй — к высоте станции: цепь подъёма насосов,
      // таль, кабели поплавков и датчиков.
      elevationMm: n(kns.vozv),
      emergencyPipeline: Boolean(kns.emergency),
      insulationEnabled: Boolean(kns.insulation),
      insulationDepthMm: n(kns.tiGlubina),
      pipeExecution: kns.ispolnenie === 'частями' ? 'частями' : 'целая',
      hasFlowMeter: Boolean(kns.rashodomer),
      // Блок «Автоматика»: каждый тумблер ведёт свой узел раздела 7.
      hasControlCabinet: Boolean(kns.shu),
      controlCabinetType: typeof kns.shuTip === 'string' ? kns.shuTip : null,
      controlCabinetStart: typeof kns.shuPusk === 'string' ? kns.shuPusk : null,
      hasPressureSensors: Boolean(kns.datchikiDavl),
      hasLevelSensor: Boolean(kns.datchikiUrov),
      // `gaykaGm` — прежнее имя поля (переименовано в тот же день, когда
      // появилось): расчёты, сохранённые между двумя релизами, читаются им.
      emergencyCouplingGm: n(kns.muftaGm ?? kns.gaykaGm) || undefined,
      // Цены — поля ОЛ, связанные со строками трубы и насоса. Разбираются тем
      // же парсером, что поля ОЛ: «12 500» с пробелом-разделителем — число.
      pipePriceRub: tryEvalExpr(String(kns.pipePrice ?? '')),
      pumpPriceRub: tryEvalExpr(String(kns.pumpPrice ?? '')),
      // Ручные количества арматуры из ОЛ. Ключ kranManual исторический — это
      // задвижки напорной стороны (см. useKnsSurvey).
      gatesInletManual: tryEvalExpr(String(kns.zadvManual ?? '')),
      gatesPressureManual: tryEvalExpr(String(kns.kranManual ?? '')),
      checkValvesManual: tryEvalExpr(String(kns.klapanManual ?? '')),
      // Корзина и дробилка — одно поле ОЛ на четыре значения (см. grinderValue).
      hasBasket: hasBasketIn(kns.drobilka as Grinder),
      hasGrinder: hasGrinderIn(kns.drobilka as Grinder),
      // Глубина лотка подводящего — от неё цепь и направляющие обоих узлов.
      inletTrayDepthMm: tryEvalExpr(String(kns.podvLotok ?? '')),
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
    // Наименование — в каноническом виде: у деревьев, собранных до чистки
    // прайса, в именах строк остались двойные пробелы и латиница, а свежая
    // материализация даёт уже приведённые — сопоставление по сырому имени
    // потеряло бы ручные правки этих строк.
    return `${r.kind}|${normalizePriceName(r.name)}|${normalizePriceText(r.unit)}`
  }

  /**
   * Сколько ручных правок не удалось перенести последней пересборкой —
   * для сообщения о ней (экран расчёта, «Пересобрать»).
   */
  const lastLostCount = ref(0)

  /** У строки есть ручная правка — то, что пересборка обязана перенести. */
  function hasManualEdit(r: CalcRowNode): boolean {
    const qty = r.qtyManual != null && String(r.qtyManual).trim() !== ''
    return qty || (r.priceManual != null && !r.priceBinding) || r.enabled === false
  }

  /** Строка той же природы: вид, категория и ЕИ — наименование могло смениться. */
  function sameKind(a: CalcRowNode, b: CalcRowNode): boolean {
    return a.kind === b.kind && a.category === b.category && normalizePriceText(a.unit) === normalizePriceText(b.unit)
  }

  /** Правки строки, которую некуда перенести, — запись для списка. */
  function lostRowOf(os: CalcSection, oc: CalcComponent, r: CalcRowNode): LostEdit {
    return {
      section: os.title,
      component: oc.title,
      row: {
        kind: r.kind,
        category: r.category,
        name: r.name,
        unit: r.unit,
        ...(r.qtyManual != null && String(r.qtyManual).trim() !== '' ? { qtyManual: r.qtyManual } : {}),
        ...(r.priceManual != null && !r.priceBinding ? { priceManual: r.priceManual } : {}),
        ...(r.enabled === false ? { disabled: true } : {}),
      },
    }
  }

  /**
   * Правки узла, которого в свежем дереве нет: по строке на каждую правленую
   * и отдельная запись, если узел выключили вручную (выключенный тумблером ОЛ
   * — не правка инженера).
   */
  function lostComponentOf(os: CalcSection, oc: CalcComponent): LostEdit[] {
    const out = oc.rows.filter(hasManualEdit).map((r) => lostRowOf(os, oc, r))
    if (!oc.enabled && oc.enabledCalc !== false) out.unshift({ section: os.title, component: oc.title, componentDisabled: true })
    return out
  }

  /**
   * Правки строки прежнего дерева — на строку свежего.
   *
   * @param renamed строка найдена не по наименованию, а по природе (вид,
   *   категория, ЕИ): наименование сменилось вместе с параметром ОЛ, и
   *   перенос помечается конфликтом `renamedFrom`
   */
  function carryEdits(or: CalcRowNode, nr: CalcRowNode, renamed: boolean) {
    nr.qtyManual = or.qtyManual
    if (!nr.priceBinding) nr.priceManual = or.priceManual
    nr.enabled = or.enabled

    const before = or.qtyCalcPrev ?? or.qtyCalc
    nr.qtyCalcPrev = nr.qtyManual != null && before != null && before !== nr.qtyCalc ? before : undefined

    if (renamed) {
      // Самое раннее неразрешённое наименование — как у количества.
      nr.renamedFrom = or.renamedFrom ?? or.name
      return
    }
    if (or.renamedFrom) nr.renamedFrom = or.renamedFrom

    // Свежее дерево берёт цены из действующего прайса. Сдвинулся он под
    // строкой — отметка «было → стало», как у количества; непринятая
    // прежняя отметка переносится (engines/reprice.ts). У переименованной
    // строки позиция другая — сравнивать её цену с прежней бессмысленно.
    nr.priceCatalogPrev = priceMarkAfter(or, nr.priceCatalog)
  }

  /**
   * Переносит ручные правки из старого дерева в свежематериализованное:
   * qtyManual/priceManual/enabled строк, тумблеры разделов и компонентов,
   * компоненты «Добавлено вручную» — целиком.
   *
   * Узел ищется по ключу `slot` (CalcComponent.slot), а не по названию: в
   * названии параметры ОЛ — «Нитка напорного трубопровода DN150 ×2», — и при
   * их смене правки узла прежде пропадали молча, а выключенный узел
   * включался снова (План_устранения, 1.1). У деревьев, собранных до ключей,
   * — по названию, затем по его основе без параметров
   * (`engines/component-key.ts`).
   *
   * Строка — по «вид + наименование + ЕИ». Наименование сменилось вместе с
   * параметром ОЛ (DN, длина штока) — правки переходят на строку той же
   * природы с пометкой `renamedFrom`: это конфликт, его подтверждает инженер.
   *
   * Оговорки:
   *  - цена строки, связанной с полем ОЛ (`priceBinding`), НЕ переносится:
   *    её уже положила материализация из ОЛ, а ОЛ здесь источник — старая
   *    цифра из дерева вернула бы то, что инженер только что исправил;
   *  - если у строки с ручным количеством изменилось расчётное, прежнее
   *    расчётное запоминается в `qtyCalcPrev` — это конфликт «было → стало».
   *    Запоминается САМОЕ РАННЕЕ неразрешённое значение: при двух правках ОЛ
   *    подряд инженер должен увидеть то, поверх чего ставил свою цифру;
   *  - что перенести некуда — узла или строки той же природы в свежем дереве
   *    нет, — не пропадает молча, а возвращается списком.
   *
   * @returns правки, которые перенести не удалось
   */
  function reconcileTrees(oldTree: CalcTree, fresh: CalcTree): LostEdit[] {
    const lost: LostEdit[] = []
    // Раздел ищется по названию, номер — запасной ключ: шаблон технолога
    // переставляет разделы, и номер у раздела сменится, а название — нет.
    const sectionOf = (os: CalcSection): CalcSection | undefined =>
      fresh.sections.find((s) => s.title === os.title) ?? fresh.sections.find((s) => s.code === os.code)
    // Узел — сначала в своём разделе, а не нашёлся там — в любом: узел могли
    // перенести в другой раздел. Сопоставленный второй раз не берётся.
    const everywhere = fresh.sections.flatMap((s) => s.components)
    const taken = new Set<CalcComponent>()
    const componentOf = (ns: CalcSection | undefined, oc: CalcComponent): CalcComponent | undefined => {
      const pick = (match: (c: CalcComponent) => boolean) =>
        (ns && ns.components.find((c) => !taken.has(c) && match(c))) ?? everywhere.find((c) => !taken.has(c) && match(c))
      // Ключ решает всё: узла с тем же ключом нет — это узел другой роли
      // (плоское днище сменилось эллиптическими), и его правки чужому узлу
      // не достаются.
      if (oc.slot) return pick((c) => c.slot === oc.slot)
      const title = RENAMED_COMPONENTS[oc.title] ?? oc.title
      const stem = titleStem(title)
      return pick((c) => c.title === title) ?? pick((c) => titleStem(c.title) === stem)
    }

    for (const os of oldTree.sections) {
      const ns = sectionOf(os)
      if (ns) ns.enabled = os.enabled

      for (const oc of os.components) {
        // Ручные строки и вставленные вручную узлы шаблоном не порождаются —
        // переносим компонент целиком. Раздела больше нет — в последний:
        // ручную работу не теряем.
        if (oc.id.startsWith('custom-')) {
          const target = ns ?? fresh.sections[fresh.sections.length - 1]
          target?.components.push({ ...oc, rows: oc.rows.map((r) => ({ ...r })) })
          continue
        }

        const nc = componentOf(ns, oc)
        if (!nc) {
          lost.push(...lostComponentOf(os, oc))
          continue
        }
        taken.add(nc)
        nc.enabled = reconciledEnabled(oc, nc)

        const used = new Set<number>()
        const unmatched: CalcRowNode[] = []
        for (const or of oc.rows) {
          const key = rowMatchKey(or)
          const idx = nc.rows.findIndex((nr, i) => !used.has(i) && rowMatchKey(nr) === key)
          if (idx < 0) {
            if (hasManualEdit(or)) unmatched.push(or)
            continue
          }
          used.add(idx)
          carryEdits(or, nc.rows[idx]!, false)
        }
        for (const or of unmatched) {
          const idx = nc.rows.findIndex((nr, i) => !used.has(i) && sameKind(nr, or))
          if (idx < 0) {
            lost.push(lostRowOf(os, oc, or))
            continue
          }
          used.add(idx)
          carryEdits(or, nc.rows[idx]!, true)
        }
      }
    }
    return lost
  }

  /**
   * Состояние узла после пересборки.
   *
   * Узел, включаемый тумблером ОЛ (`enabledCalc`), берёт состояние из ОЛ,
   * если тумблер там сменился, и остаётся, как оставил инженер, если нет:
   * выигрывает последняя правка. У остальных узлов ОЛ состоянием не
   * управляет — оно переносится как есть.
   *
   * У деревьев, собранных до появления `enabledCalc`, прежний ответ ОЛ
   * неизвестен — считаем, что узел в расчёте не переключали. Иначе первая же
   * правка тумблера в ОЛ потерялась бы, а так теряется лишь ручное
   * переключение узла, сделанное в расчёте до этой версии.
   */
  function reconciledEnabled(oc: CalcComponent, nc: CalcComponent): boolean {
    if (nc.enabledCalc === undefined) return oc.enabled
    // Лестница и вентстояк до связи с ОЛ строились включёнными всегда:
    // прежний «ответ ОЛ» у их старых деревьев известен — «да». Выключенный
    // в расчёте узел — ручная правка, и ответ ОЛ «да» её не отменяет.
    const legacy = nc.nodeCode && ALWAYS_ON_BEFORE_SURVEY.has(nc.nodeCode) ? true : oc.enabled
    const before = oc.enabledCalc ?? legacy
    return before === nc.enabledCalc ? oc.enabled : nc.enabled
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

  /**
   * Строки без цены — блокируют выпуск КП (Механика §10).
   *
   * Только те, что входят в итог: строка с нулевым количеством — в том числе
   * в выключенном узле («призраке») — ничего не стоит, и гейт сервера её не
   * считает (`isRowWithoutPrice`, backend/src/utils/estimate-tree.ts). Иначе
   * выключенный в ОЛ шкаф управления висел бы в счётчике «без цены», хотя КП
   * выпускается.
   */
  const missingPriceIds = computed(
    () =>
      new Set(
        rows.value
          .filter((r) => {
            const res = results.value.get(r.id)
            return res?.missingPrice && res.qty !== 0
          })
          .map((r) => r.id),
      ),
  )

  /**
   * Конфликты: override поверх изменившегося расчётного (Механика §8.3).
   *
   * Читаются из дерева (`qtyCalcPrev`), а не из памяти экрана: ОЛ пересчитывает
   * расчёт сам, и конфликт, рождённый в ОЛ, иначе не дожил бы до экрана
   * расчёта.
   */
  const conflictIds = computed(() => {
    const s = new Set<string>()
    for (const r of rows.value) {
      if (manualQty(r).value != null && r.qtyCalcPrev != null && r.qtyCalcPrev !== r.qtyCalc) s.add(r.id)
      // Правки перенесены на строку с другим наименованием — их подтверждает инженер.
      if (r.renamedFrom != null) s.add(r.id)
    }
    return s
  })

  /** Правки, которые пересборка не смогла перенести (CalcTree.lostEdits). */
  const lostEdits = computed<LostEdit[]>(() => tree.value?.lostEdits ?? [])

  /** Расчётное «было» у строк в конфликте — для подписи «было → стало». */
  const prevQtyCalc = computed<Record<string, number | null>>(() => {
    const m: Record<string, number | null> = {}
    for (const r of rows.value) if (r.qtyCalcPrev != null) m[r.id] = r.qtyCalcPrev
    return m
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

  // ── Версия прайса (Механика §5.2) ─────────────────────────────────────────

  /**
   * Дерево посчитано по прайсу старше действующего — что изменит пересчёт:
   * новое дерево и сводка. `null` — дерево на действующей версии.
   */
  const priceDrift = computed(() => {
    void ctxLoads.value
    const ctx = ctxCache
    if (!tree.value || !ctx || (tree.value.priceListVersion ?? 1) >= priceListVersion.value) return null
    return repriceTree(tree.value, ctx.priceOf, priceListVersion.value)
  })

  /**
   * Цены строк расходятся с действующим прайсом.
   *
   * Материализация фиксирует цены вместе с версией прайса, и после импорта
   * нового прайса старый расчёт продолжал показывать прежние — ничего об этом
   * не говоря. Теперь экран предлагает пересчёт, а выпуск КП спрашивает, по
   * какой версии его выпускать.
   *
   * Решает фактическое расхождение, а не номер версии: версию поднимает и
   * правка одной цены (План_устранения, 1.2), и расчёт, где этой позиции
   * нет, пересчитывать незачем.
   */
  const priceOutdated = computed(() => !!priceDrift.value && hasPriceDrift(priceDrift.value.summary))

  /**
   * Что даст пересчёт по действующему прайсу — до того, как его сделать:
   * сколько строк сменит цену и как сдвинутся себестоимость и цена продажи.
   */
  const repricePreview = computed(() => {
    const drift = priceDrift.value
    if (!drift || !hasPriceDrift(drift.summary)) return null
    const { tree: next, summary } = drift
    // После пересчёта — ставки нового прайса: он ставит их дереву.
    const after = computeEconomics(
      aggregateRows(flattenRows(next), { sectionEnabled: sectionEnabledFor(next), tirage: tirage.value }),
      next.rates ?? rates.value,
      { markup: markup.value },
    )
    return {
      summary,
      costBefore: economics.value.costRub,
      costAfter: after.costRub,
      saleBefore: economics.value.salePriceRub,
      saleAfter: after.salePriceRub,
    }
  })

  /**
   * Строки с непринятым ручным вводом: количество не разобрано или меньше
   * нуля, ручная цена меньше нуля (План_устранения, 1.5). В расчёте у них
   * расчётное и цена прайса, ячейка подсвечена ошибкой.
   */
  const invalidInputIds = computed(() => {
    const s = new Set<string>()
    for (const [id, res] of results.value) if (res.qtyIssue || res.priceIssue) s.add(id)
    return s
  })

  /** Строки с непринятой отметкой «цена прайса изменилась». */
  const priceDeltaIds = computed(() => new Set(rows.value.filter(hasPriceDelta).map((r) => r.id)))

  // ── Действия ──────────────────────────────────────────────────────────────

  function setQtyManual(id: string, expr: string) {
    const row = rows.value.find((r) => r.id === id)
    if (!row) return
    row.qtyManual = expr.trim() === '' ? null : expr
    recalcAll()
  }

  /** Ручная цена строки; меньше нуля не принимается (решение Р4). */
  function setPriceManual(id: string, value: number | null) {
    if (value != null && value < 0) return
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
    const row = rows.value.find((r) => r.id === id)
    if (!row) return
    row.qtyCalcPrev = undefined
    row.renamedFrom = undefined
  }

  /**
   * «Принять новое» — сбрасывает override к расчётному. У строки со
   * сменившимся наименованием — все перенесённые правки: количество, цену и
   * выключение, — они относились к прежней позиции.
   */
  function dropOverride(id: string) {
    const row = rows.value.find((r) => r.id === id)
    if (row?.renamedFrom != null) {
      if (!row.priceBinding) row.priceManual = null
      row.enabled = true
      row.renamedFrom = undefined
    }
    resetQty(id)
    if (row) row.qtyCalcPrev = undefined
  }

  /**
   * Вернуть непереносимую правку строкой, добавленной вручную: в раздел с тем
   * же названием, а нет его — в последний. Правка узла целиком (узел был
   * выключен) строкой не возвращается — её можно только убрать из списка.
   */
  function restoreLostEdit(index: number) {
    const t = tree.value
    const entry = t?.lostEdits?.[index]
    if (!t || !entry?.row) return
    const section = t.sections.find((s) => s.title === entry.section) ?? t.sections[t.sections.length - 1]
    if (!section) return
    const { row } = entry
    addRow(section.code, {
      kind: row.kind,
      category: row.category,
      name: row.name,
      unit: row.unit,
      qtyManual: row.qtyManual != null ? String(row.qtyManual) : null,
      priceManual: row.priceManual ?? null,
      enabled: !row.disabled,
    })
    dismissLostEdit(index)
    recalcAll()
  }

  /** Убрать правку из списка непереносимых — инженер разобрался с ней сам. */
  function dismissLostEdit(index: number) {
    const t = tree.value
    if (!t?.lostEdits) return
    t.lostEdits = t.lostEdits.filter((_, i) => i !== index)
    if (!t.lostEdits.length) delete t.lostEdits
  }

  /** Убрать весь список непереносимых правок. */
  function dismissAllLostEdits() {
    if (tree.value) delete tree.value.lostEdits
  }

  /**
   * Пересчитать цены строк по действующему прайсу (engines/reprice.ts).
   *
   * Берётся прайс, загруженный с расчётом (экран расчёта читает его свежим).
   * Строки со сменившейся ценой получают отметку «было → стало»; версия
   * прайса дерева становится действующей.
   *
   * @returns сводка пересчёта; `null` — пересчитывать нечего
   */
  function repriceToCurrent(): RepriceSummary | null {
    const ctx = ctxCache
    if (!tree.value || !ctx) return null
    const { tree: next, summary } = repriceTree(tree.value, ctx.priceOf, priceListVersion.value)
    tree.value = next
    return summary
  }

  /** Принять новую цену прайса — снять отметку. */
  function acceptPriceDelta(id: string) {
    const row = rows.value.find((r) => r.id === id)
    if (row) row.priceCatalogPrev = undefined
  }

  /** Принять новые цены у всех строк разом. */
  function acceptAllPriceDeltas() {
    for (const r of rows.value) if (r.priceCatalogPrev !== undefined) r.priceCatalogPrev = undefined
  }

  /**
   * Оставить прежнюю цену: она становится ручной, отметка снимается.
   *
   * Нужно, когда цена согласована с заказчиком раньше, чем её сдвинул прайс.
   * У строки, где и так стоит ручная цена, менять нечего — её отметка только
   * принимается.
   */
  function keepPrevPrice(id: string) {
    const row = rows.value.find((r) => r.id === id)
    if (!row) return
    if (row.priceManual == null && row.priceCatalogPrev != null) row.priceManual = row.priceCatalogPrev
    row.priceCatalogPrev = undefined
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
    // Вставленный узел каталога — тоже `custom-…`, но у него есть код узла:
    // свободные строки в него не подмешиваются.
    let c = sec.components.find((x) => x.id.startsWith('custom-') && !x.nodeCode)
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

  /**
   * Удалять можно только строки, добавленные вручную (Механика §12.5).
   * Вместе с операцией уходит её ФОТ-спутник: без родителя он был бы
   * часами ни от чего.
   */
  function removeRow(id: string) {
    if (!tree.value) return
    for (const s of tree.value.sections) {
      for (const c of s.components) {
        const i = c.rows.findIndex((r) => r.id === id && r.isCustom)
        if (i >= 0) {
          c.rows = c.rows.filter((r) => r.id !== id && r.parentId !== id)
          return
        }
      }
    }
  }

  // ── Узлы каталога и действующий шаблон (редактор шаблонов) ────────────────

  /** Узлы каталога для вставки в расчёт: опубликованные, вне архива. */
  const catalogNodes = computed<CatalogNode[]>(() => templates.value.nodes)

  /** Версия действующего шаблона изделия этого расчёта: 0 — встроенный. */
  const activeTemplateVersion = computed(() =>
    tree.value ? activeTemplateVersionOf(templates.value, tree.value.deviceType) : 0,
  )

  /**
   * Технолог опубликовал другую версию шаблона или откатил его после сборки
   * расчёта. Дерево без отметки собрано встроенным шаблоном — это версия 0.
   */
  const templateChanged = computed(
    () => !!tree.value && (tree.value.templateVersion ?? 0) !== activeTemplateVersion.value,
  )

  /** Действующая редакция встроенного шаблона изделия этого расчёта (код). */
  const activeBuiltinRevision = computed(() => (tree.value ? builtinRevision(tree.value.deviceType) : 0))

  /**
   * Код новее редакции, которой собран расчёт: релиз изменил формулы или
   * состав встроенных узлов. Дерево без отметки собрано до учёта редакций —
   * заведомо прежним кодом.
   */
  const builtinOutdated = computed(
    () => !!tree.value && (tree.value.builtinRevision ?? 0) < activeBuiltinRevision.value,
  )

  /** Что изменилось во встроенном шаблоне с редакции расчёта — для плашки. */
  const builtinChanges = computed<BuiltinRevision[]>(() =>
    tree.value && builtinOutdated.value ? revisionsAfter(tree.value.deviceType, tree.value.builtinRevision) : [],
  )

  /** Состав расчёта не совпадает с тем, что собрал бы сейчас действующий шаблон. */
  const templateOutdated = computed(() => templateChanged.value || builtinOutdated.value)

  /**
   * Пересобрать расчёт по действующему шаблону: свежая материализация из
   * сохранённого ОЛ, ручные правки переносятся так же, как при правке ОЛ
   * (reconcileTrees). Цены строк свежее дерево берёт из действующего прайса.
   *
   * @returns текст проблемы; `null` — пересобрано
   */
  function rebuildByActiveTemplate(): string | null {
    if (!estimate.value || !ctxCache) return 'Расчёт не загружен'
    const saved = estimate.value.surveyData as Record<string, unknown>
    return rebuildTree(ctxCache, estimate.value.deviceType, saved, tree.value, { force: true })
  }

  let nodeSeq = 0
  /**
   * Вставить узел каталога в раздел: материализация с параметрами из формы
   * вставки. Компонент ручной (`custom-…`): пересборка по ОЛ переносит его
   * целиком, строки удаляются, как добавленные вручную.
   *
   * Id строк — свои (`cn-…`), не из счётчика материализации: счётчик после
   * перезагрузки страницы начинается заново, и строки вставленного узла
   * совпали бы по id со строками следующей пересборки.
   */
  function addCatalogNode(sectionCode: string, node: CatalogNode, values: NodeParamValues): CalcComponent | null {
    const sec = tree.value?.sections.find((s) => s.code === sectionCode)
    if (!sec || !ctxCache) return null
    const built = materializeNode(ctxCache, node, values)
    const stamp = `${++nodeSeq}${Date.now().toString(36)}`
    const ids = new Map(built.rows.map((r, i) => [r.id, `cn-${stamp}-${i}`]))
    const comp: CalcComponent = {
      ...built,
      id: `custom-n${stamp}`,
      rows: built.rows.map((r) => ({
        ...r,
        id: ids.get(r.id)!,
        ...(r.parentId ? { parentId: ids.get(r.parentId) } : {}),
        isCustom: true,
      })),
    }
    sec.components.push(comp)
    recalcAll()
    return comp
  }

  /** Убрать вставленный вручную узел целиком. Узлы шаблона только выключаются. */
  function removeComponent(sectionCode: string, componentId: string) {
    const sec = tree.value?.sections.find((s) => s.code === sectionCode)
    if (!sec || !componentId.startsWith('custom-')) return
    sec.components = sec.components.filter((c) => c.id !== componentId)
  }

  /** Коэффициент ФОТ строки-спутника — для метки «ФОТ · k=0,28». */
  function fotKOf(row: CalcRowNode): number | null {
    if (row.kind !== 'ФОТ' || !row.parentId) return null
    const parent = rows.value.find((r) => r.id === row.parentId)
    return row.fotK ?? (parent ? resolveFotK(parent) : null)
  }

  /**
   * Копия дерева, в которой у каждой строки проставлено `qtyResolved` —
   * количество за ОДНО изделие, уже вычисленное движком.
   *
   * Зачем: `qtyManual` хранит выражение («1,55*2+2,88*2»), разбирает его
   * парсер `engines/expr.ts`, и на бэкенде такого парсера нет. Раньше бэкенд
   * пытался прочитать выражение через Number(), получал NaN и считал, что
   * количества нет: строка без цены переставала блокировать выпуск КП и
   * пропадала из спецификации. Заводить вторую реализацию грамматики на
   * сервере — значит гарантированно её рассинхронизировать, поэтому результат
   * считает тот, у кого есть движок, и кладёт его в дерево.
   *
   * Тираж сюда НЕ входит: он живёт в totals, и умножает на него потребитель.
   */
  function treeForSave(): CalcTree {
    const src = tree.value as CalcTree
    return {
      ...src,
      sections: src.sections.map((s) => ({
        ...s,
        components: s.components.map((c) => ({
          ...c,
          rows: c.rows.map((r) => ({
            ...r,
            qtyResolved: resolveQty(r, { sectionEnabled: true, tirage: 1 }).qty,
          })),
        })),
      })),
    }
  }

  /** Итоги расчёта в том виде, в котором их хранит surveyData. */
  function totalsForSave() {
    return {
      costRub: economics.value.costRub,
      salePriceRub: economics.value.salePriceRub,
      markup: markup.value,
      tirage: tirage.value,
    }
  }

  /**
   * Цены связанных строк — обратно в ОЛ (см. EngineRow.priceBinding).
   *
   * Цену трубы или насоса можно поправить и в расчёте. Не запиши мы её в ОЛ,
   * следующая же правка ОЛ пересобрала бы дерево со старой цифрой из поля и
   * молча откатила бы исправление.
   *
   * Поле ОЛ живёт в двух блоках surveyData: форма (`form`, у КНС ещё и её
   * копия `kns`) — строкой, как её вводят; параметры ЕМК/КОЛ (`emk`/`kol`) —
   * числом, как их читает материализация.
   *
   * @returns изменённые блоки surveyData или `null`, если писать нечего
   */
  function boundPricesPatch(): Record<string, unknown> | null {
    if (!estimate.value || !tree.value) return null
    const saved = estimate.value.surveyData as Record<string, unknown>
    const form = saved.form as Record<string, unknown> | undefined
    if (!form) return null

    const nextForm: Record<string, unknown> = { ...form }
    const params: Record<string, Record<string, unknown>> = {}
    for (const key of ['kns', 'emk', 'kol']) {
      const block = saved[key]
      if (block && typeof block === 'object') params[key] = { ...(block as Record<string, unknown>) }
    }
    let changed = false
    // У связи может быть несколько строк (труба частями: сегменты — та же
    // труба), а поле одно: источником служит первая — труба корпуса.
    const seen = new Set<PriceBinding>()

    for (const r of flattenRows(tree.value)) {
      if (!r.priceBinding || seen.has(r.priceBinding)) continue
      seen.add(r.priceBinding)
      const { formField, paramsField } = PRICE_BINDING_FIELDS[r.priceBinding]
      const text = r.priceManual == null ? '' : String(r.priceManual)
      if (String(nextForm[formField] ?? '') === text) continue
      nextForm[formField] = text
      // У КНС параметры — копия формы (строки), у ЕМК/КОЛ — числа.
      if (params.kns) params.kns[formField] = text
      if (params.emk) params.emk[paramsField] = r.priceManual
      if (params.kol) params.kol[paramsField] = r.priceManual
      changed = true
    }

    return changed ? { form: nextForm, ...params } : null
  }

  function save(): Promise<void> {
    return enqueue(saveNow)
  }

  /**
   * Прайс обновился, а цены строк с ним совпадают — дерево переходит на
   * действующую версию: пересчитывать нечего, а подпись «прайс vN» в КП и
   * снапшоте не должна отставать от прайса, по которому цены верны.
   */
  function catchUpPriceVersion() {
    const drift = priceDrift.value
    if (tree.value && drift && !hasPriceDrift(drift.summary)) tree.value.priceListVersion = priceListVersion.value
  }

  /**
   * Дерево, собранное до фиксации ставок, получает ставки действующего
   * прайса — те, по которым оно сейчас и посчитано. С этого сохранения его
   * экономика больше не зависит от прайса, а снапшот её восстанавливает.
   */
  function stampRates() {
    if (tree.value && !tree.value.rates) tree.value.rates = { ...liveRates.value }
  }

  /** Подпись текущего состояния — для сравнения с сохранённым (savedSignature). */
  function stateSignature(): string {
    return stableStringify({ tree: tree.value, markup: markup.value, tirage: tirage.value })
  }

  async function saveNow() {
    if (!estimate.value || !tree.value) return
    catchUpPriceVersion()
    stampRates()
    // Подпись того, что уходит: правки, сделанные, пока запись в пути, в неё
    // не попадают и останутся несохранёнными.
    const sent = stateSignature()
    const current = estimate.value
    let updated: EstimateDetail
    try {
      updated = await estimatesApi.patchSurvey(current.id, {
        ...boundPricesPatch(),
        tree: treeForSave(),
        // Фиксируем, из какой ревизии ОЛ построено дерево, — чтобы load()
        // не рематериализовал его повторно, а сервер отклонил запись, если
        // ОЛ с тех пор поправили (backend/src/utils/survey-write.ts).
        treeSurveyRev: treeSurveyRev.value,
        totals: totalsForSave(),
        // Версия, с которой работали: расчёт с тех пор правили — 409
        // (План_устранения 3.1).
        ...baseVersionOf(current),
      })
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } }).response?.data?.code
      if (code === 'SURVEY_CHANGED') {
        // ОЛ поправили в другой вкладке: в базе дерево новее нашего. Своё не
        // пишем — оно откатило бы ОЛ, — а поднимаем свежее.
        await fetchEstimate(current.id)
        throw new Error('Опросный лист изменился после того, как был открыт расчёт. Расчёт перечитан — повторите правку')
      }
      if (code === 'ESTIMATE_CHANGED') {
        // Расчёт сохранили в другой вкладке или другой пользователь: записать
        // своё — значит стереть его правки молча. Поднимаем свежее.
        await fetchEstimate(current.id)
        throw new Error('Расчёт изменили в другой вкладке или другой пользователь. Расчёт перечитан — повторите правку')
      }
      throw e
    }
    estimate.value = mergeEstimate(current, updated)
    savedSignature.value = sent
  }

  function clear() {
    estimate.value = null
    tree.value = null
    // Стор — синглтон Pinia: без сброса наценка и тираж предыдущего расчёта
    // перетекали в следующий и молча меняли его цену продажи.
    markup.value = DEFAULT_MARKUP
    tirage.value = 1
    priceListVersion.value = 1
    savedSignature.value = null
  }

  return {
    estimate, tree, rates, rateFallbacks, markup, tirage, loading, error, catalog,
    // Несохранённое на экране расчёта (План_устранения 3.2).
    savedSignature, stateSignature,
    // Активная версия прайса на сервере. Отличается от tree.priceListVersion,
    // который хранит версию, из которой расчёт был материализован, — топбар
    // показывает именно её.
    priceListVersion,
    rows, results, economics, economicsUnit, missingPriceIds, conflictIds, overrideIds, invalidInputIds, enabledFor, prevQtyCalc,
    // Пересчёт цен по действующему прайсу и отметки «было → стало» у цены.
    priceOutdated, repricePreview, priceDeltaIds,
    repriceToCurrent, acceptPriceDelta, acceptAllPriceDeltas, keepPrevPrice,
    load, save, clear, recalcAll, settled,
    // Пересчёт из ОЛ и цены прайса для его подсказок.
    applySurvey, ensureContext, catalogPrice,
    setQtyManual, setPriceManual, resetQty, resetPrice,
    toggleSection, toggleComponent, keepOverride, dropOverride, fotKOf,
    // Правки, которые пересборка не смогла перенести (План_устранения, 1.1).
    lostEdits, lastLostCount, restoreLostEdit, dismissLostEdit, dismissAllLostEdits,
    addRow, removeRow,
    // Шаблоны изделий и узлы каталога (редактор шаблонов).
    templates, catalogNodes, activeTemplateVersion, templateOutdated, rebuildByActiveTemplate,
    // Редакция встроенного шаблона (код) и что изменилось с редакции расчёта.
    templateChanged, activeBuiltinRevision, builtinOutdated, builtinChanges,
    addCatalogNode, removeComponent,
  }
})
