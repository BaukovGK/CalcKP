import type { DeviceType } from '@/types/device'
import { FALLBACK_RATES, ratesFromPrices, type TreeRates } from '@/engines/economics'
import { normalizePriceName, normalizePriceText } from '@/engines/price-name'
import { matrixLengthBucketMm } from '@/engines/survey-emk-kol'
import type { MaterializeContext } from '@/engines/template-kns'
import {
  refsApi,
  type ActiveTemplates,
  type EngineeringRefs,
  type Nomenclature,
  type PipeWeightGrp,
  type PriceVersionInfo,
} from '@/api/refs'

/**
 * Контекст материализации из справочников сервера: прайс, веса труб,
 * инженерные матрицы, версия прайса, действующие шаблоны изделий и узлы
 * каталога — собранные в индексы.
 *
 * Общий для калькулятора (stores/calcTree.ts) и предпросмотра в редакторе
 * шаблонов: оба материализуют одним движком по одним данным, поэтому то, что
 * технолог видит в предпросмотре, и есть то, что получит инженер.
 */

/** Ключ цены — тройка в каноническом виде (engines/price-name.ts). */
const priceKey = (category: string, name: string, unit: string): string =>
  `${normalizePriceText(category)}|${normalizePriceName(name)}|${normalizePriceText(unit)}`

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

/** Ставки по умолчанию живут в движке (engines/economics.ts) — рядом с позициями ставок. */
export { FALLBACK_RATES }

/** Позиция прайса плоским списком — поиск «Компонент из каталога». */
export interface CatalogItem {
  category: string
  name: string
  unit: string
  priceRub: number | null
}

/** Справочники в том виде, в котором их отдаёт сервер. */
export interface RefsData {
  prices: Nomenclature
  weights: { grp: PipeWeightGrp[] }
  engineering: EngineeringRefs
  priceVersion: PriceVersionInfo
  templates: ActiveTemplates
}

export interface LoadedContext {
  ctx: MaterializeContext
  /** Ставки действующего прайса — для деревьев, собранных до фиксации ставок. */
  rates: TreeRates
  catalog: CatalogItem[]
  priceListVersion: number
  templates: ActiveTemplates
}

/** Нет своих шаблонов и узлов — всё встроенное. */
export const NO_TEMPLATES: ActiveTemplates = { products: {}, nodes: [] }

/** Собирает контекст из уже загруженных справочников. */
export function buildMaterializeContext(refs: RefsData): LoadedContext {
  const { prices, weights, engineering, priceVersion, templates } = refs

  // Индексы справочников: поиск по тройке (категория, наименование, ЕИ)
  // и по (DN; PN_трубы; SN) — ровно как VLOOKUP эталона. Тройка приводится
  // к каноническому виду с обеих сторон: невидимая разница в пробелах или
  // латинская «x» в прайсе не должна делать строку расчёта «красной».
  const priceIdx = new Map<string, number | null>()
  const flat: CatalogItem[] = []
  for (const [category, items] of Object.entries(prices)) {
    for (const p of items) {
      priceIdx.set(priceKey(category, p.name, p.unit), p.priceRub)
      flat.push({ category, name: p.name, unit: p.unit, priceRub: p.priceRub })
    }
  }
  const weightIdx = new Map<string, number>()
  for (const w of weights.grp) weightIdx.set(`${w.dn}|${w.pn}|${w.sn}`, w.kgPerM)

  // Все четыре ставки — позиции прайса (Механика §9): обновление прайса
  // меняет экономику новых расчётов, старые держат ставки своего дерева.
  // Позиции в базе нет — константа с отметкой (engines/economics.ts).
  const rates = ratesFromPrices((c, n, u) => priceIdx.get(priceKey(c, n, u)) ?? null)

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

  // Узлы каталога — действующие версии вне архива (редактор шаблонов).
  const nodeIdx = new Map(templates.nodes.map((n) => [n.code, n]))

  const ctx: MaterializeContext = {
    priceOf: (c, n, u) => priceIdx.get(priceKey(c, n, u)) ?? null,
    pipeWeightOf: (dn, pn, sn) => weightIdx.get(`${dn}|${pn}|${sn}`) ?? null,
    nozzleNormOf: (dn) => normIdx.get(dn) ?? null,
    jointLayerMassOf: (d) => jointIdx.get(d) ?? null,
    ellipticBottomOf: (dn, lengthMm) => bottomIdx.get(`${dn}|${matrixLengthBucketMm(lengthMm)}`) ?? null,
    templateOf: (device) => {
      const t = templates.products[device]
      return t ? { deviceType: device, version: t.version, body: t.body } : null
    },
    catalogNodeOf: (code) => nodeIdx.get(code) ?? null,
    priceListVersion: priceVersion.version,
  }
  return { ctx, rates, catalog: flat, priceListVersion: priceVersion.version, templates }
}

/**
 * Шаблоны изделий не загрузились (План_устранения, 1.4).
 *
 * Прежде сбой запроса превращался в «своих шаблонов нет», и изделие молча
 * собиралось встроенным шаблоном вместо действующего, а автосохранение ОЛ
 * записывало такое дерево в базу. Встроенный шаблон — только когда сервер
 * ответил, что своих шаблонов нет.
 */
export class TemplatesUnavailableError extends Error {
  constructor(readonly reason: unknown) {
    super('Шаблоны изделий не загрузились — обновите страницу позже')
    this.name = 'TemplatesUnavailableError'
  }
}

/**
 * Загружает справочники и собирает контекст.
 *
 * Любой сбой — и справочников, и шаблонов — отказ: собранный наполовину
 * контекст дал бы расчёт не по тем данным. Сбой шаблонов —
 * {@link TemplatesUnavailableError}.
 */
export async function loadMaterializeContext(): Promise<LoadedContext> {
  const [prices, weights, engineering, priceVersion, templates] = await Promise.all([
    refsApi.nomenclature(),
    refsApi.pipeWeights(),
    refsApi.engineering(),
    refsApi.priceVersion(),
    refsApi.templates().catch((e: unknown) => {
      throw new TemplatesUnavailableError(e)
    }),
  ])
  return buildMaterializeContext({ prices, weights, engineering, priceVersion, templates })
}

/** Версия действующего шаблона изделия: 0 — встроенный. */
export function activeTemplateVersion(templates: ActiveTemplates, device: DeviceType): number {
  return templates.products[device]?.version ?? 0
}
