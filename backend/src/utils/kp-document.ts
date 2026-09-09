/**
 * Модель печатной формы КП — то, что уходит заказчику.
 *
 * Чистая сборка: снапшот + карточка расчёта → структура документа. Рендеры
 * (`kp-docx.ts`, `kp-pdf.ts`) не знают ни про Prisma, ни про HTTP и получают
 * готовую модель, поэтому вёрстку можно менять, не трогая данные.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ДВА РЕШЕНИЯ ПО ЦЕНАМ (образец заказчика получен 09.09.2026 — «КПВ6393»)
 *
 * 1. Цены печатаются ПО ПОЗИЦИЯМ (по единицам оборудования), но не по строкам
 *    спецификации. В расчёте цена строки — это ЦЕНА ЗАКУПКИ из прайса НН
 *    (себестоимость), а цена заказчику получается из неё через наценку
 *    (`engines/economics.ts`, salePriceFromCost). Напечатать строки с их
 *    ценами — значит показать заказчику себестоимость и, вместе с итогом, всю
 *    маржу.
 *
 *    В образце цена стоит у каждой строки — но там строки собраны иначе: это
 *    узлы изделия, а не строки расчёта, и цена узла требует разнести по узлам
 *    накладные, ПЗР, ацетон и СИЗ, которые в движке общие на изделие. Правило
 *    разнесения заводом не задано, а выдуманное разошлось бы с итогом
 *    снапшота. Поэтому цена печатается на уровне, где она точна, — позиции.
 *
 * 2. НДС не начисляется сверху, а выделяется «в том числе» — образец
 *    подтверждает: «Цены приведены с учётом НДС». Движок фиксирует то же:
 *    «Себестоимость с НДС: НДС зашит в цены прайса, отдельно не выделяется»
 *    (`engines/economics.ts`, Economics.costRub). Ставка {@link VAT_RATE_PCT}
 *    влияет ТОЛЬКО на справочную строку «в том числе НДС»; итог от неё не
 *    зависит.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @module utils/kp-document
 */

import { extractSpecification, type SpecSection, type Specification } from './estimate-tree'

/**
 * Спецификацию не удалось собрать точно: у части строк количество задано
 * выражением, которое посчитал фронт, а в снапшоте результат не сохранён.
 *
 * Печатать в этом случае нельзя ни с каким числом: и «пропустить строку», и
 * «подставить расчётное» дают заказчику документ, который расходится с
 * расчётом. Маршрут превращает это в 422.
 */
export class KpSpecificationIncomplete extends Error {
  constructor(
    readonly rows: Specification['unresolved'],
    /** Единица, на которой споткнулись — в КП на проект их несколько. */
    readonly estimateTitle?: string,
  ) {
    super(`Количество не определено у строк: ${rows.length}`)
    this.name = 'KpSpecificationIncomplete'
  }
}

/** КП выпускается на одну единицу оборудования или на проект целиком. */
export type KpScope = 'unit' | 'project'

/**
 * Ставка НДС для справочной строки «в том числе», %.
 *
 * Не начисляется сверху (см. решение 2 в шапке модуля): цена уже включает
 * налог. Изменение ставки не меняет итоговую сумму КП.
 *
 * 22, а не 20: образец заказчика «КПВ6393» от 21.07.2026 прямо пишет «Цены
 * приведены с учетом НДС 22%». Прежнее значение было предположением кода.
 */
export const VAT_RATE_PCT = 22

/**
 * Позиция документа — одна единица оборудования со своей спецификацией и
 * своей ценой.
 *
 * КП на единицу — документ из одной позиции, КП на проект — из нескольких:
 * состав и цена у каждой свои (у каждой свой снапшот), а общая сумма
 * складывается из них. Одна структура на оба случая держит вёрстку общей:
 * иначе рядом жили бы два документа, расходящиеся при первой же правке.
 */
export interface KpPosition {
  /** Номер позиции: 1, 2, … Им же нумеруются строки спецификации — «1.1». */
  number: number
  estimateId: string
  /** Обозначение изделия, напр. «КНС DN3000». */
  title: string
  deviceType: string
  /**
   * Количество изделий в заказе (тираж, Механика §9.1).
   *
   * Количества в спецификации и цена — оба на весь тираж. Печатать состав на
   * одно изделие рядом с ценой за N нельзя: документ будет внутренне
   * противоречив, а расхождение заметят уже после отправки заказчику.
   */
  tirage: number
  /** Цена заказчику, ₽, с НДС — зафиксирована снапшотом. Это цена за весь тираж. */
  totalRub: number
  /** Версия снапшота — она же номер редакции по этой позиции. */
  snapshotVersion: number
  /** Версия прайса, из которой посчитан снапшот (ТЗ §3). */
  priceListVersion: number
  sections: SpecSection[]
  /** Строк спецификации в позиции. */
  rowsCount: number
}

/** Реквизиты и содержание печатной формы. */
export interface KpDocument {
  /**
   * Номер документа: «КП-<8 символов id расчёта>-v<версия снапшота>» для
   * единицы, «КП-<8 символов id проекта>» для проекта — у проекта общей
   * редакции нет, редакции печатаются по позициям.
   */
  number: string
  scope: KpScope
  /**
   * Дата выпуска = дата снапшота; у проекта — самого позднего из вошедших.
   * Не «сейчас»: документ обязан быть воспроизводимым, две печати одних и тех
   * же данных должны совпадать до символа.
   */
  issuedAt: Date
  customer: string | null
  project: string | null
  address: string | null
  positions: KpPosition[]
  /** Общая сумма по позициям, ₽, с НДС. */
  totalRub: number
  /** Справочно: НДС в составе цены, ₽. */
  vatRub: number
  vatRatePct: number
  /** Итог по строкам спецификации — сколько позиций попало в документ. */
  positionsCount: number
}

/** Единица оборудования с её снапшотом — кирпич обоих документов. */
export interface KpUnitInput {
  estimateId: string
  estimateTitle: string
  deviceType: string
  snapshot: {
    version: number
    priceListVersion: number
    totalRub: number
    createdAt: Date
    /** Снимок дерева расчёта на момент выпуска КП. */
    bundlesJson: unknown
  }
}

export interface KpDocumentInput extends KpUnitInput {
  project: { title: string; customer: string | null; address: string | null } | null
}

export interface KpProjectDocumentInput {
  projectId: string
  project: { title: string; customer: string | null; address: string | null } | null
  /** Единицы проекта в порядке, в котором они попадут в документ. */
  units: KpUnitInput[]
}

/** НДС, выделенный из суммы, уже включающей налог: сумма × ставка / (100 + ставка). */
export function vatIncludedIn(totalRub: number, ratePct: number = VAT_RATE_PCT): number {
  if (!Number.isFinite(totalRub) || totalRub <= 0) return 0
  return round2((totalRub * ratePct) / (100 + ratePct))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Спецификация и цена одной единицы — общая часть обоих документов. */
function buildPosition(unit: KpUnitInput, number: number): KpPosition {
  const { snapshot } = unit
  const spec = extractSpecification(snapshot.bundlesJson)
  if (spec.unresolved.length > 0) {
    throw new KpSpecificationIncomplete(spec.unresolved, unit.estimateTitle)
  }

  const totalRub = Number.isFinite(snapshot.totalRub) && snapshot.totalRub > 0 ? snapshot.totalRub : 0

  return {
    number,
    estimateId: unit.estimateId,
    title: unit.estimateTitle,
    deviceType: unit.deviceType,
    tirage: spec.tirage,
    totalRub,
    snapshotVersion: snapshot.version,
    priceListVersion: snapshot.priceListVersion,
    sections: spec.sections,
    rowsCount: spec.sections.reduce((n, s) => n + s.rows.length, 0),
  }
}

/**
 * Собрать модель КП на одну единицу оборудования.
 *
 * Источник цифры — ИМЕННО снапшот, а не текущее состояние расчёта: расчёт
 * после выпуска КП не замораживается и продолжает правиться (Механика §10),
 * поэтому документ обязан воспроизводить то, что было согласовано.
 */
export function buildKpDocument(input: KpDocumentInput): KpDocument {
  const position = buildPosition(input, 1)

  return {
    number: `КП-${input.estimateId.slice(0, 8).toUpperCase()}-v${input.snapshot.version}`,
    scope: 'unit',
    issuedAt: input.snapshot.createdAt,
    customer: input.project?.customer ?? null,
    project: input.project?.title ?? null,
    address: input.project?.address ?? null,
    positions: [position],
    totalRub: position.totalRub,
    vatRub: vatIncludedIn(position.totalRub),
    vatRatePct: VAT_RATE_PCT,
    positionsCount: position.rowsCount,
  }
}

/**
 * Собрать модель КП на проект целиком: по позиции на каждую единицу.
 *
 * Общая сумма складывается из цен снапшотов, а не пересчитывается: каждая
 * цена уже согласована по своей единице, и любое «уточнение» здесь развело бы
 * документ с тем, что видел инженер.
 *
 * Единицы без снапшота сюда не доходят — маршрут отказывается печатать, пока
 * по ним не выпущено КП: молча выброшенная из документа единица дороже отказа.
 */
export function buildProjectKpDocument(input: KpProjectDocumentInput): KpDocument {
  const positions = input.units.map((unit, i) => buildPosition(unit, i + 1))
  const totalRub = round2(positions.reduce((sum, p) => sum + p.totalRub, 0))

  // Дата документа — самый поздний снапшот: документ описывает состояние на
  // этот момент, и повторная печать тех же данных даёт ту же дату.
  const issuedAt = new Date(
    Math.max(...input.units.map((u) => u.snapshot.createdAt.getTime()), 0),
  )

  return {
    number: `КП-${input.projectId.slice(0, 8).toUpperCase()}`,
    scope: 'project',
    issuedAt,
    customer: input.project?.customer ?? null,
    project: input.project?.title ?? null,
    address: input.project?.address ?? null,
    positions,
    totalRub,
    vatRub: vatIncludedIn(totalRub),
    vatRatePct: VAT_RATE_PCT,
    positionsCount: positions.reduce((n, p) => n + p.rowsCount, 0),
  }
}

/** Дата в формате документа: 08.09.2026. */
export function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * Неразрывный пробел U+00A0 — записан escape-последовательностью намеренно:
 * литеральный символ в исходнике неотличим от обычного пробела и теряется
 * при первой же правке.
 */
export const NBSP = '\u00A0'

/**
 * Деньги в формате документа: 1 234 567,89 ₽.
 *
 * Разделитель разрядов — неразрывный пробел: иначе число рвётся по переносу
 * строки и в docx, и в PDF.
 */
export function formatMoney(v: number): string {
  const fixed = Math.abs(v).toFixed(2)
  const [int, frac] = fixed.split('.')
  const grouped = (int as string).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
  return `${v < 0 ? '−' : ''}${grouped},${frac}${NBSP}₽`
}

/** Количество: целые — без дробной части, дробные — до трёх знаков. */
export function formatQty(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(3))).replace('.', ',')
}
