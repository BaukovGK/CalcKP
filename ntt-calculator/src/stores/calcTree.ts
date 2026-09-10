import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { aggregateRows, computeEconomics, DEFAULT_MARKUP, type Rates } from '@/engines/economics'
import { recalcFotSatellites, resolveFotK } from '@/engines/fot'
import { computeRow, resolveQty } from '@/engines/row'
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
import { matrixLengthBucketMm } from '@/engines/survey-emk-kol'
import { estimatesApi, type EstimateDetail } from '@/api/estimates'
import { refsApi } from '@/api/refs'
import type { PriceBinding, RowResult } from '@/engines/types'
import { PRICE_BINDING_FIELDS } from '@/engines/price-binding'
import { tryEvalExpr } from '@/engines/expr'
import { hasBasketIn, hasGrinderIn, type Grinder } from '@/types/survey'
import { normalizePriceName, normalizePriceText } from '@/engines/price-name'

/** Ключ цены — тройка в каноническом виде (engines/price-name.ts). */
const priceKey = (category: string, name: string, unit: string): string =>
  `${normalizePriceText(category)}|${normalizePriceName(name)}|${normalizePriceText(unit)}`

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
 * Мс на стыке берётся по МИНИМАЛЬНОМУ давлению из справочника f(Dу, PN).
 *
 * Правило завода (2026-09-09): изделия безнапорные, поэтому считается
 * минимально возможная ламинация. В таблице она задана в атмосферах, и нижняя
 * строка — 4 атм, то есть 0,4 МПа; эталон читает именно её и в КНС (отдельная
 * колонка листа, заполненная только в этой строке), и в ЕМК (точный поиск,
 * попадающий в первую строку группы).
 *
 * Минимум ищется, а не задаётся константой 4, потому что правило звучит как
 * «минимально возможная», а не «строка номер 4»: если технолог заведёт класс
 * ниже, расчёт последует за таблицей, а не за магическим числом.
 *
 * Не путать с поиском ВЕСА трубы: там 0,1 и 0,4 ссылаются на 0,6, потому что
 * по технологии производства это одна и та же труба (`pnForWeightLookup`,
 * engines/survey-kns.ts).
 */
function jointLayerIndex(rows: ReadonlyArray<{ d: number; pn: number; massKg: number }>): Map<number, number> {
  const min = new Map<number, { pn: number; massKg: number }>()
  for (const r of rows) {
    const cur = min.get(r.d)
    if (!cur || r.pn < cur.pn) min.set(r.d, { pn: r.pn, massKg: r.massKg })
  }
  return new Map([...min].map(([d, v]) => [d, v.massKg]))
}

/**
 * Узлы, которые до своей связи с тумблером ОЛ строились включёнными всегда:
 * B1 — лестница, C1 — вентстояк (у ёмкости и колодца тумблеры дошли до них
 * 10.09.2026). См. reconciledEnabled.
 */
const ALWAYS_ON_BEFORE_SURVEY = new Set(['B1', 'C1'])

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
   * Ревизия ОЛ, на которой материализовано текущее дерево. Если сохранённый
   * `surveyData.surveyRev` больше — ОЛ правили после материализации, и load()
   * рематериализует дерево с переносом overrides и пометкой конфликтов.
   */
  const treeSurveyRev = ref(0)

  // ── Загрузка ──────────────────────────────────────────────────────────────

  /**
   * Контекст материализации — справочники и прайс, собранные в индексы.
   *
   * Кешируется на время жизни стора: ОЛ пересчитывает расчёт после каждой
   * правки, и тянуть 1040 позиций прайса и три справочника на каждое нажатие
   * клавиши незачем — они меняются сменой версии прайса, а не вводом в ОЛ.
   */
  let ctxCache: MaterializeContext | null = null

  async function ensureContext(opts: { fresh?: boolean } = {}): Promise<MaterializeContext> {
    if (ctxCache && !opts.fresh) return ctxCache
    const [prices, weights, engineering, priceVersion] = await Promise.all([
      refsApi.nomenclature(),
      refsApi.pipeWeights(),
      refsApi.engineering(),
      refsApi.priceVersion(),
    ])
    // Настоящая версия прайса, а не константа: снапшот фиксирует именно её,
    // и топбар обязан показывать то же самое (ТЗ §3).
    priceListVersion.value = priceVersion.version

    // Индексы справочников: поиск по тройке (категория, наименование, ЕИ)
    // и по (DN; PN_трубы; SN) — ровно как VLOOKUP эталона. Тройка приводится
    // к каноническому виду с обеих сторон: невидимая разница в пробелах или
    // латинская «x» в прайсе не должна делать строку расчёта «красной».
    const priceIdx = new Map<string, number | null>()
    const flat: typeof catalog.value = []
    for (const [category, items] of Object.entries(prices)) {
      for (const p of items) {
        priceIdx.set(priceKey(category, p.name, p.unit), p.priceRub)
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
      fotRub: priceIdx.get(priceKey('ФОТ', 'ФОТ', 'чел. ч')) ?? FALLBACK_RATES.fotRub,
      overheadRub: priceIdx.get(priceKey('ФОТ', 'Накладные расходы', 'чел. ч')) ?? FALLBACK_RATES.overheadRub,
      acetoneRub: priceIdx.get(priceKey('Прочие материалы', 'Ацетон', 'кг')) ?? FALLBACK_RATES.acetoneRub,
      ppeRub: priceIdx.get(priceKey('Прочие материалы', 'СИЗ и РМ', 'ед.')) ?? FALLBACK_RATES.ppeRub,
    }

    // Нормы патрубков — источник массы формовки гильз (лист «Для расчетов»).
    // Ключ — DN гильзы; сетка дискретна, промахи дают «красную» строку.
    const normIdx = new Map(engineering.nozzles.map((n) => [n.dn, n]))

    // Мс — масса формованных слоёв на стыке. Таблица приходит целиком
    // (Dу × PN), а в расчёт идёт минимальное давление каждого диаметра:
    // изделия безнапорные, ламинация считается минимально возможная.
    const jointIdx = jointLayerIndex(engineering.jointLayers ?? [])

    // Эллиптическое днище — ячейка матрицы (DN × строка длины «До 3 м» …
    // «До 12»). Длина приводится к строке тем же правилом, что в эталоне.
    const bottomIdx = new Map(
      (engineering.ellipticBottom ?? []).map((c) => [`${c.d}|${c.lengthMm}`, { massKg: c.massKg, thicknessMm: c.thicknessMm }]),
    )

    ctxCache = {
      priceOf: (c, n, u) => priceIdx.get(priceKey(c, n, u)) ?? null,
      pipeWeightOf: (dn, pn, sn) => weightIdx.get(`${dn}|${pn}|${sn}`) ?? null,
      nozzleNormOf: (dn) => normIdx.get(dn) ?? null,
      jointLayerMassOf: (d) => jointIdx.get(d) ?? null,
      ellipticBottomOf: (dn, lengthMm) => bottomIdx.get(`${dn}|${matrixLengthBucketMm(lengthMm)}`) ?? null,
      priceListVersion: priceListVersion.value,
    }
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

    if (baseTree) reconcileTrees(baseTree, fresh)
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
    const ctx = await ensureContext()

    // Первый пересчёт в сессии ОЛ: поднимаем расчёт с сервера — нужны его
    // ручные правки, иначе перенести было бы нечего.
    if (!estimate.value || estimate.value.id !== id) {
      const est = await estimatesApi.get(id)
      estimate.value = est
      const saved = est.surveyData as Record<string, unknown>
      restoreTotals(saved)
      tree.value = saved.tree && typeof saved.tree === 'object' ? (saved.tree as CalcTree) : null
    }

    const current = estimate.value as EstimateDetail
    const merged = { ...(current.surveyData as Record<string, unknown>), ...payload }
    const problem = rebuildTree(ctx, current.deviceType, merged, tree.value, { force: true })

    // Строить не из чего (ОЛ ещё не заполнен до материализации) — сохраняем
    // сам ОЛ: ввод не должен теряться из-за того, что расчёт пока невозможен.
    if (problem || !tree.value) {
      const updated = await estimatesApi.patchSurvey(id, payload)
      estimate.value = mergeEstimate(current, updated)
      return null
    }

    const body = {
      ...payload,
      tree: treeForSave(),
      treeSurveyRev: treeSurveyRev.value,
      totals: totalsForSave(),
    }
    estimate.value = mergeEstimate(current, await estimatesApi.patchSurvey(id, body))
    return economics.value.salePriceRub
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
      pumpsWorking: n(kns.nRab),
      pumpsReserve: n(kns.nRez),
      valveOnInlet: Boolean(kns.valveOnInlet),
      emergencyPipeline: Boolean(kns.emergency),
      insulationEnabled: Boolean(kns.insulation),
      insulationDepthMm: n(kns.tiGlubina),
      pipeExecution: kns.ispolnenie === 'частями' ? 'частями' : 'целая',
      hasFlowMeter: Boolean(kns.rashodomer),
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
   * Переносит ручные правки из старого дерева в свежематериализованное:
   * qtyManual/priceManual/enabled строк, тумблеры разделов и компонентов,
   * компоненты «Добавлено вручную» — целиком.
   *
   * Две оговорки:
   *  - цена строки, связанной с полем ОЛ (`priceBinding`), НЕ переносится:
   *    её уже положила материализация из ОЛ, а ОЛ здесь источник — старая
   *    цифра из дерева вернула бы то, что инженер только что исправил;
   *  - если у строки с ручным количеством изменилось расчётное, прежнее
   *    расчётное запоминается в `qtyCalcPrev` — это конфликт «было → стало».
   *    Запоминается САМОЕ РАННЕЕ неразрешённое значение: при двух правках ОЛ
   *    подряд инженер должен увидеть то, поверх чего ставил свою цифру.
   */
  function reconcileTrees(oldTree: CalcTree, fresh: CalcTree) {
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
        nc.enabled = reconciledEnabled(oc, nc)

        const used = new Set<number>()
        for (const or of oc.rows) {
          const key = rowMatchKey(or)
          const idx = nc.rows.findIndex((nr, i) => !used.has(i) && rowMatchKey(nr) === key)
          const nr = idx >= 0 ? nc.rows[idx] : undefined
          if (!nr) continue
          used.add(idx)
          nr.qtyManual = or.qtyManual
          if (!nr.priceBinding) nr.priceManual = or.priceManual
          nr.enabled = or.enabled

          const before = or.qtyCalcPrev ?? or.qtyCalc
          nr.qtyCalcPrev = nr.qtyManual != null && before != null && before !== nr.qtyCalc ? before : undefined
        }
      }
    }
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

  /** Строки без цены — блокируют выпуск КП (Механика §10). */
  const missingPriceIds = computed(
    () => new Set(rows.value.filter((r) => results.value.get(r.id)?.missingPrice).map((r) => r.id)),
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
      if (r.qtyManual != null && r.qtyCalcPrev != null && r.qtyCalcPrev !== r.qtyCalc) s.add(r.id)
    }
    return s
  })

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
    const row = rows.value.find((r) => r.id === id)
    if (row) row.qtyCalcPrev = undefined
  }

  /** «Принять новое» — сбрасывает override к расчётному. */
  function dropOverride(id: string) {
    resetQty(id)
    const row = rows.value.find((r) => r.id === id)
    if (row) row.qtyCalcPrev = undefined
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

  async function saveNow() {
    if (!estimate.value || !tree.value) return
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
      })
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } }).response?.data?.code
      if (code !== 'SURVEY_CHANGED') throw e
      // ОЛ поправили в другой вкладке: в базе дерево новее нашего. Своё не
      // пишем — оно откатило бы ОЛ, — а поднимаем свежее.
      await fetchEstimate(current.id)
      throw new Error('Опросный лист изменился после того, как был открыт расчёт. Расчёт перечитан — повторите правку')
    }
    estimate.value = mergeEstimate(current, updated)
  }

  function clear() {
    estimate.value = null
    tree.value = null
    // Стор — синглтон Pinia: без сброса наценка и тираж предыдущего расчёта
    // перетекали в следующий и молча меняли его цену продажи.
    markup.value = DEFAULT_MARKUP
    tirage.value = 1
    priceListVersion.value = 1
  }

  return {
    estimate, tree, rates, markup, tirage, loading, error, catalog,
    // Активная версия прайса на сервере. Отличается от tree.priceListVersion,
    // который хранит версию, из которой расчёт был материализован, — топбар
    // показывает именно её.
    priceListVersion,
    rows, results, economics, economicsUnit, missingPriceIds, conflictIds, overrideIds, enabledFor, prevQtyCalc,
    load, save, clear, recalcAll, settled,
    // Пересчёт из ОЛ и цены прайса для его подсказок.
    applySurvey, ensureContext, catalogPrice,
    setQtyManual, setPriceManual, resetQty, resetPrice,
    toggleSection, toggleComponent, keepOverride, dropOverride, fotKOf,
    addRow, removeRow,
  }
})
