/**
 * Составное изделие в КП: подпозиции «1.N.M» и раскладка цены по ним.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ПОЧЕМУ (образец коммерческого отдела «КП (2).xlsx», 23.11.2026, поз. 1.4 —
 * ДНС): КП больше нельзя выпускать одной строкой «изделие · 1 компл. · цена».
 * Изделие составное, и в таблице оно печатается шапкой с подпозициями:
 *
 *   1.4    Стеклокомпозитная ДНС … (тип, марка, ТУ, габариты, соответствие) — 1 компл.
 *   1.4.1  Стеклокомпозитный корпус … - 1 шт.; - люки; - гильзы; - лестницы … — 1 компл.
 *   1.4.2  Корзина сороулавливающая …                                   — 1 компл.
 *   1.4.3  Система вентиляции …                                          — 1 компл.
 *   1.4.4  Напорный трубопровод … в комплекте: задвижки, клапаны …       — 1 компл.
 *   1.4.5  Грузоподъемное устройство (таль + тренога)                    — 1 компл.
 *   1.4.6… цепи, направляющие, муфты, насосы, поплавки, датчики, шкаф    — N шт.
 *
 * У каждой подпозиции свои количество, единица, цена и сумма.
 *
 * ОТКУДА ЦЕНЫ ПОДПОЗИЦИЙ. Цена изделия — из снапшота (итог расчёта, вверх до
 * 100 ₽), и она не меняется: подпозиции только РАСКЛАДЫВАЮТ её.
 *  1. Каждая строка дерева расчёта относится к одной группе — по узлу
 *     (компоненту) дерева, а насосная группа и обслуживание — по самой строке
 *     ({@link groupOfRow}).
 *  2. Цена группы в продаже = Σ (кол-во × цена × k) её строк, где k —
 *     коэффициент наценки строки (`markupK`, Механика §9.2), а без него —
 *     1 + общая наценка. Так «Оптимизировать наценку» (закупка ×1,05)
 *     становится видна в КП, а без оптимизации группа получает общую наценку.
 *  3. Цена за единицу округляется до рубля; сумма = цена × количество.
 *  4. Всё, что осталось от цены изделия (ПЗР, ацетон, СИЗ, накладные с
 *     наценкой и округление до 100 ₽), ложится на корпус — продукцию
 *     собственного производства. Сумма подпозиций = цена изделия до копейки.
 *  Если остаток на корпусе получился бы ≤ 0 (ручные k сильно выше общей
 *  наценки) — цена изделия делится между группами пропорционально (п. 2).
 *
 * ЧТО ПЕЧАТАЕТСЯ. Наименования подпозиций — из комплектации (черновик из ОЛ
 * плюс правка менеджера в окне выпуска, `kp-kit.ts`): каждая строка
 * комплектации относится к группе по наименованию ({@link groupOfKitItem}).
 * Первая строка группы — наименование подпозиции, остальные печатаются под
 * ней «в комплекте». Строки, не узнанные ни одной группой, — в комплект
 * корпуса. Группа, у которой в расчёте есть стоимость, а в комплектации нет
 * ни одной строки (менеджер её убрал), отдельной подпозицией не печатается:
 * её стоимость уходит в корпус — убранная строка пропадает из документа, а
 * цена изделия остаётся прежней.
 *
 * Дерева нет или количество строки не определено (выражение без
 * `qtyResolved`) — раскладывать нечем: {@link buildParts} возвращает `null`,
 * и позиция печатается прежним видом, одной строкой с «В комплекте».
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @module utils/kp-parts
 */

import { markupOf, priceOf, qtyOf } from './estimate-economics'
import type { TreeRow } from './estimate-tree'
import { docNumber, type KitItem } from './kp-product'

/** Группа подпозиций: что это за узел изделия. */
export type PartKey =
  | 'shell'
  | 'basket'
  | 'grinder'
  | 'vent'
  | 'pipeline'
  | 'lift'
  | 'chains'
  | 'guides'
  | 'coupling'
  | 'pumps'
  | 'floats'
  | 'pressure'
  | 'level'
  | 'flow'
  | 'cabinet'
  | 'gas'

/**
 * Порядок подпозиций — как в образце ДНС: корпус, корзина, вентиляция,
 * напорный трубопровод, грузоподъёмное устройство, цепи, направляющие,
 * муфты, насосы, поплавки, датчики, шкаф.
 */
export const PART_ORDER: readonly PartKey[] = [
  'shell',
  'basket',
  'grinder',
  'vent',
  'pipeline',
  'lift',
  'chains',
  'guides',
  'coupling',
  'pumps',
  'floats',
  'pressure',
  'level',
  'flow',
  'cabinet',
  'gas',
]

/** Подпозиция изделия — строка таблицы «1.N.M». */
export interface KpPart {
  number: string
  key: PartKey
  description: string
  qty: number
  unit: string
  /** Цена за единицу, ₽, с НДС. */
  priceRub: number
  /** Сумма, ₽, с НДС: цена × количество (у корпуса — остаток цены изделия). */
  totalRub: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const has = (text: string, re: RegExp): boolean => re.test(text.toLowerCase())

/**
 * Группа строки дерева расчёта.
 *
 * Сначала — по самой строке: в «Насосной группе» лежат насосы, муфты и
 * поплавки, в «Оборудовании для обслуживания» — тренога с талью и
 * газоанализатор. Затем — по узлу (компоненту), затем — по разделу. Не
 * узнано — корпус: всё, что не отдельное оборудование, входит в его комплект.
 */
export function groupOfRow(row: TreeRow, componentTitle: string, sectionTitle: string): PartKey {
  const name = String(row.name ?? '')
  const comp = componentTitle
  const category = String(row.category ?? '')

  if (has(name, /газоанализатор/)) return 'gas'
  if (has(name, /тренога|(^|[\s(+])таль([\s,)]|$)/)) return 'lift'
  if (has(name, /поплавков/)) return 'floats'
  if (has(name, /трубная муфта/)) return 'coupling'
  if (has(category, /^насосы/) && has(name, /^насос/)) return 'pumps'
  if (has(name, /^монтаж насосов/)) return 'pumps'
  if (has(name, /^монтаж систем автоматической трубной муфты/)) return 'coupling'
  if (has(name, /^монтаж поплавков/)) return 'floats'

  // Патрубки корпуса («Патрубок напорный DN150») — корпус, не трубопровод.
  if (has(comp, /^(фланцевый )?патрубок/)) return 'shell'
  if (has(comp, /корзин/)) return 'basket'
  if (has(comp, /дробилк/) || has(name, /дробилк/)) return 'grinder'
  if (has(comp, /вентиляц/)) return 'vent'
  // Уровень — раньше давления: «датчик уровня (гидростатического давления)».
  if (has(comp, /датчик.* уровн/)) return 'level'
  if (has(comp, /датчик.* давлени/)) return 'pressure'
  if (has(comp, /расходомер/)) return 'flow'
  if (has(comp, /шкаф/)) return 'cabinet'
  if (has(comp, /крепление насосного/)) return 'guides'
  if (has(comp, /грузоподъ[её]м насосов/)) return 'chains'
  if (has(comp, /обслуживани/)) return 'lift'
  if (has(comp, /насосная группа/)) return 'pumps'
  if (has(comp, /напорн|аварийн|запорной арматуры|фланцевых соединений|задвижка/)) return 'pipeline'

  if (has(sectionTitle, /корзин/)) return 'basket'
  if (has(sectionTitle, /напорный трубопровод/)) return 'pipeline'
  return 'shell'
}

/** Группа строки комплектации — по наименованию, как его прочтёт заказчик. */
export function groupOfKitItem(name: string): PartKey {
  if (has(name, /корпус/)) return 'shell'
  if (has(name, /корзин/)) return 'basket'
  if (has(name, /дробилк/)) return 'grinder'
  if (has(name, /газоанализатор/)) return 'gas'
  if (has(name, /поплавков/)) return 'floats'
  if (has(name, /трубная муфта/)) return 'coupling'
  if (has(name, /направляющ/)) return 'guides'
  if (has(name, /датчик.* уровн/)) return 'level'
  if (has(name, /датчик.* давлени/)) return 'pressure'
  if (has(name, /расходомер/)) return 'flow'
  if (has(name, /шкаф/)) return 'cabinet'
  if (has(name, /тренога|(^|[\s(+])таль([\s,)]|$)|грузоподъ/)) return 'lift'
  if (has(name, /цеп/)) return 'chains'
  if (has(name, /^насос/)) return 'pumps'
  if (has(name, /вентиляц/)) return 'vent'
  if (has(name, /трубопровод|задвижк|клапан/)) return 'pipeline'
  return 'shell'
}

/**
 * Стоимость групп в продаже по дереву: Σ кол-во × цена × k.
 *
 * @returns `null` — дерева нет или количество хотя бы одной строки не
 *   определено: раскладка была бы выдуманной.
 */
export function groupSales(survey: unknown): Map<PartKey, number> | null {
  if (!isObj(survey) || !isObj(survey.tree)) return null
  const sections = asArray(survey.tree.sections)
  if (sections.length === 0) return null
  const totals = isObj(survey.totals) ? survey.totals : null
  const tirage = typeof totals?.tirage === 'number' && Number.isInteger(totals.tirage) && totals.tirage >= 1 ? totals.tirage : 1
  const defaultK = 1 + markupOf(survey)

  const out = new Map<PartKey, number>()
  for (const s of sections) {
    if (!isObj(s) || s.enabled === false) continue
    const sectionTitle = String(s.title ?? '')
    for (const c of asArray(s.components)) {
      if (!isObj(c) || c.enabled === false) continue
      const componentTitle = String(c.title ?? '')
      for (const r of asArray(c.rows)) {
        if (!isObj(r)) continue
        const row = r as TreeRow & { markupK?: unknown }
        const qty = qtyOf(row, tirage)
        if (qty == null) return null
        if (qty === 0) continue
        const price = priceOf(row)
        if (price == null) continue
        const k = typeof row.markupK === 'number' && Number.isFinite(row.markupK) && row.markupK > 0 ? row.markupK : defaultK
        const key = groupOfRow(row, componentTitle, sectionTitle)
        out.set(key, (out.get(key) ?? 0) + qty * price * k)
      }
    }
  }
  return out
}

/** Строка «в комплекте»: «- Лестница из нержавеющей стали - 1 шт.;». */
function nested(item: KitItem): string {
  return `- ${item.name} - ${docNumber(item.qty)} ${item.unit};`
}

/**
 * Наименование подпозиции: первая строка группы — заголовок, остальные —
 * списком под ним. У корпуса заголовок сам несёт количество («- 1 шт.;»), как
 * в образце (поз. 1.4.1): подпозиция — «1 компл.», корпус в ней — «1 шт.».
 */
function partDescription(key: PartKey, items: KitItem[]): string {
  const [head, ...rest] = items
  if (!head) return ''
  if (key === 'shell') {
    return [`${head.name} - ${docNumber(head.qty)} ${head.unit};`, ...rest.map(nested)].join('\n')
  }
  if (rest.length === 0) return head.name
  return [head.name, 'в комплекте:', ...rest.map(nested)].join('\n')
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Единица подпозиции корпуса: корпус «в комплекте» с узлами — комплект. */
const SHELL_UNIT = 'компл.'

/**
 * Подпозиции изделия с ценами.
 *
 * @param number номер позиции изделия («1.4») — подпозиции получают «1.4.M»
 * @param kit комплектация изделия (правленая менеджером или черновик)
 * @param totalRub цена изделия за весь тираж, ₽ — из снапшота
 * @param tirage количество изделий: корпус — по одному на изделие
 * @returns `null` — раскладывать нечем (см. шапку модуля)
 */
export function buildParts(
  number: string,
  survey: unknown,
  kit: readonly KitItem[],
  totalRub: number,
  tirage: number,
): KpPart[] | null {
  const sales = groupSales(survey)
  if (!sales || !(totalRub > 0)) return null

  // Комплектация по группам; корпус — первой строкой своей группы.
  const items = new Map<PartKey, KitItem[]>()
  for (const item of kit) {
    if (!item.name.trim() || !(item.qty > 0)) continue
    const key = groupOfKitItem(item.name)
    const list = items.get(key) ?? []
    if (key === 'shell' && has(item.name, /корпус/) && !list.some((i) => has(i.name, /корпус/))) list.unshift(item)
    else list.push(item)
    items.set(key, list)
  }

  // Группа без строк комплектации — в корпус (и её цена, и ничего больше).
  const sale = new Map<PartKey, number>()
  for (const [key, rub] of sales) {
    const target = key !== 'shell' && (items.get(key)?.length ?? 0) > 0 ? key : 'shell'
    sale.set(target, (sale.get(target) ?? 0) + rub)
  }
  // Группа со строками комплектации, но без стоимости в расчёте (узел
  // добавлен вручную или в расчёте выключен) — строкой в комплект корпуса:
  // отдельная подпозиция с нулевой ценой читалась бы как «бесплатно».
  for (const key of PART_ORDER) {
    if (key === 'shell') continue
    const list = items.get(key)
    if (list && list.length > 0 && !((sale.get(key) ?? 0) > 0)) {
      items.set('shell', [...(items.get('shell') ?? []), ...list])
      items.delete(key)
    }
  }

  const keys = PART_ORDER.filter((key) => key === 'shell' || (items.get(key)?.length ?? 0) > 0)
  const qtyOfPart = (key: PartKey): number => {
    if (key === 'shell') return Math.max(1, tirage)
    const head = items.get(key)?.[0]
    return head && head.qty > 0 ? head.qty : 1
  }
  const unitOfPart = (key: PartKey): string => (key === 'shell' ? SHELL_UNIT : (items.get(key)?.[0]?.unit ?? 'шт.'))

  const priced = (weights: Map<PartKey, number>, scale: number) =>
    keys
      .filter((k) => k !== 'shell')
      .map((key) => {
        const qty = qtyOfPart(key)
        const priceRub = Math.round(((weights.get(key) ?? 0) * scale) / qty)
        return { key, qty, priceRub, totalRub: priceRub * qty }
      })

  let others = priced(sale, 1)
  let rest = totalRub - others.reduce((s, p) => s + p.totalRub, 0)
  if (!(rest > 0)) {
    // Остатка на корпус нет — делим цену изделия пропорционально.
    const all = [...sale.values()].reduce((s, v) => s + v, 0)
    if (!(all > 0)) return null
    others = priced(sale, totalRub / all)
    rest = totalRub - others.reduce((s, p) => s + p.totalRub, 0)
    if (!(rest > 0)) return null
  }

  const shellQty = qtyOfPart('shell')
  const shellItems = items.get('shell') ?? []
  const shell: KpPart = {
    number: '',
    key: 'shell',
    description: shellItems.length > 0 ? partDescription('shell', shellItems) : 'Стеклокомпозитный корпус',
    qty: shellQty,
    unit: unitOfPart('shell'),
    priceRub: round2(rest / shellQty),
    totalRub: round2(rest),
  }

  const parts: KpPart[] = [
    shell,
    ...others.map((p) => ({
      number: '',
      key: p.key,
      description: partDescription(p.key, items.get(p.key) ?? []),
      qty: p.qty,
      unit: unitOfPart(p.key),
      priceRub: p.priceRub,
      totalRub: p.totalRub,
    })),
  ]
  return parts.map((p, i) => ({ ...p, number: `${number}.${i + 1}` }))
}
