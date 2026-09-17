/**
 * Модель печатной формы КП — то, что уходит заказчику.
 *
 * Чистая сборка: снапшот + карточка расчёта + правки менеджера → структура
 * документа. Рендеры (`kp-docx.ts`, `kp-pdf.ts`) не знают ни про Prisma, ни
 * про HTTP и получают готовую модель, поэтому вёрстку можно менять, не трогая
 * данные.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ВИД ДОКУМЕНТА — по рабочему КП коммерческого отдела
 * (разбор: `doc/Эталон_КП_разбор.md`, 17.09.2026)
 *
 * Шапка «Исх. ⟨номер⟩ от ⟨дата⟩», заказчик и объект; таблица
 * «№ · Наименование номенклатуры · Кол-во · Ед. изм. · Цена · Сумма»;
 * «Общая сумма»; девять пунктов условий; подпись, исполнитель, реквизиты.
 *
 * 1. СТРОКА ТАБЛИЦЫ — ИЗДЕЛИЕ, А НЕ СТРОКА РАСЧЁТА. Заказчик читает описание
 *    изделия (тип, марка, ТУ, габариты, жёсткость, толщина стенки), под ним —
 *    «В комплекте» с узлами. Ровинга, смолы, заготовок и работ в документе
 *    нет вовсе. Состав собирается из опросного листа (`utils/kp-kit.ts`) и
 *    правится менеджером при выпуске.
 *
 * 2. ЦЕНА — НА СТРОКЕ ИЗДЕЛИЯ. В расчёте цена строки — это цена ЗАКУПКИ из
 *    прайса НН (себестоимость), а цена заказчику получается из неё через
 *    наценку (`engines/economics.ts`, salePriceFromCost). Печатать строки с их
 *    ценами — значит показать заказчику себестоимость и всю маржу. В эталоне
 *    цена стоит на строке-листе, и итог суммирует всю колонку: здесь лист —
 *    это изделие, узлы состава цен не несут, и двойного счёта нет.
 *
 * 3. НДС не начисляется сверху, а выделяется «в том числе»: цены прайса уже
 *    с налогом (`engines/economics.ts`, Economics.costRub). Ставка влияет
 *    только на справочную строку; итог от неё не зависит.
 *
 * 4. ВНУТРЕННЕГО В ДОКУМЕНТЕ НЕТ: ни версии снапшота, ни версии прайса, ни
 *    идентификаторов расчёта. Они остаются в аудите и в имени файла.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @module utils/kp-document
 */

import { tirageOf } from './estimate-tree'
import { buildProductDraft } from './kp-kit'
import { productDescription, type KitItem, type ProductSpec } from './kp-product'
import {
  companyFromEnv,
  defaultSignature,
  defaultTerms,
  type KpCompany,
  type KpSignature,
  type KpTerms,
} from './kp-terms'

/** КП выпускается на одну единицу оборудования или на проект целиком. */
export type KpScope = 'unit' | 'project'

/**
 * Ставка НДС по умолчанию для строки «в том числе», %.
 *
 * Не начисляется сверху (см. решение 3 в шапке модуля): цена уже включает
 * налог. Изменение ставки не меняет итоговую сумму КП. 22, а не 20: образцы
 * заказчика прямо пишут «Цены приведены с учетом НДС 22 %».
 */
export const VAT_RATE_PCT = 22

/** Единица измерения изделия в таблице КП: поставляется комплектом. */
export const PRODUCT_UNIT = 'компл.'

/**
 * Правки менеджера по позиции, сохранённые при выпуске КП.
 *
 * Черновик собирается из опросного листа, но последнее слово за менеджером:
 * он видит описание и состав в окне выпуска и правит их. Что отредактировано,
 * то и печатается — заново из ОЛ документ не пересобирается, иначе повторная
 * печать разошлась бы с тем, что согласовал заказчик.
 */
export interface KpPositionOverride {
  /** Обозначение по проекту («НЕ1») — первой строкой ячейки. */
  tag?: string | null
  /** Марка изделия: правило завода не задано, поэтому только вручную. */
  mark?: string | null
  /** ТУ, если отличается от типового для этого изделия. */
  tu?: string | null
  /** Описание целиком: задано — печатается как есть, ОЛ не спрашивается. */
  description?: string | null
  /** Правленый состав; null — собрать из опросного листа. */
  kit?: KitItem[] | null
  /** Единица измерения изделия, если не «компл.». */
  unit?: string | null
}

/** Единица оборудования с её снапшотом — кирпич обоих документов. */
export interface KpUnitInput {
  estimateId: string
  estimateTitle: string
  deviceType: string
  /** Толщина стенки корпуса, мм — маршрут ищет её по прайсу труб. */
  wallMm?: number | null
  /** Правки менеджера из снапшота выпуска. */
  kp?: KpPositionOverride | null
  snapshot: {
    version: number
    priceListVersion: number
    totalRub: number
    createdAt: Date
    /** Снимок опросного листа и дерева расчёта на момент выпуска КП. */
    bundlesJson: unknown
  }
}

/** Шапка и постоянная часть: их задаёт менеджер в окне выпуска. */
export interface KpHeaderInput {
  /** Исходящий номер; пусто — печатается только дата. */
  number?: string | null
  terms?: Partial<KpTerms> | null
  signature?: Partial<KpSignature> | null
  company?: KpCompany | null
  /** Исполнитель — как правило, автор расчёта. */
  executor?: { name?: string | null; email?: string | null } | null
}

export interface KpDocumentInput extends KpUnitInput, KpHeaderInput {
  project: { title: string; customer: string | null; address: string | null } | null
}

export interface KpProjectDocumentInput extends KpHeaderInput {
  projectId: string
  project: { title: string; customer: string | null; address: string | null } | null
  /** Единицы проекта в порядке, в котором они попадут в документ. */
  units: KpUnitInput[]
}

/**
 * Позиция документа — одна единица оборудования: описание, количество и цена.
 *
 * КП на единицу — документ из одной позиции, КП на проект — из нескольких:
 * состав и цена у каждой свои (у каждой свой снапшот), а общая сумма
 * складывается из них. Одна структура на оба случая держит вёрстку общей.
 */
export interface KpPosition {
  /** Номер в таблице: «1.1», «1.2» … — раздел «1» и место позиции в нём. */
  number: string
  estimateId: string
  /** Внутреннее название единицы — в документ не печатается. */
  title: string
  deviceType: string
  /** Ячейка «Наименование номенклатуры» целиком. */
  description: string
  spec: ProductSpec
  kit: KitItem[]
  /**
   * Количество изделий в заказе (тираж, Механика §9.1) — оно же «Кол-во».
   *
   * Цена печатается за одно изделие, сумма — за тираж: так читается таблица
   * эталона, где «Сумма = Цена × Кол-во».
   */
  qty: number
  unit: string
  /** Цена заказчику за одно изделие, ₽, с НДС. */
  priceRub: number
  /** Сумма по позиции, ₽, с НДС — цена × количество, из снапшота. */
  totalRub: number
  /** Служебное: редакция снапшота и версия прайса. В документ не идут. */
  snapshotVersion: number
  priceListVersion: number
}

/** Реквизиты и содержание печатной формы. */
export interface KpDocument {
  /** Исходящий номер: «Исх. ⟨номер⟩ от ⟨дата⟩». Пусто — печатается дата. */
  number: string | null
  scope: KpScope
  /**
   * Дата выпуска = дата снапшота; у проекта — самого позднего из вошедших.
   * Не «сейчас»: документ обязан быть воспроизводимым, две печати одних и тех
   * же данных должны совпадать до символа.
   */
  issuedAt: Date
  customer: string | null
  /** Объект и адрес — одной строкой, как в эталоне. */
  object: string | null
  positions: KpPosition[]
  /** Общая сумма по позициям, ₽, с НДС. */
  totalRub: number
  /** Справочно: НДС в составе цены, ₽. */
  vatRub: number
  vatRatePct: number
  terms: KpTerms
  signature: KpSignature
  company: KpCompany
  /** Служебное для имени файла и аудита — в документ не печатается. */
  meta: { positionsCount: number; snapshotVersions: number[]; priceListVersions: number[] }
}

/** НДС, выделенный из суммы, уже включающей налог: сумма × ставка / (100 + ставка). */
export function vatIncludedIn(totalRub: number, ratePct: number = VAT_RATE_PCT): number {
  if (!Number.isFinite(totalRub) || totalRub <= 0) return 0
  return round2((totalRub * ratePct) / (100 + ratePct))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Объект и адрес в одну строку: в эталоне это одно поле «Объект». */
function objectLine(project: { title: string; address: string | null } | null): string | null {
  if (!project) return null
  return [project.title, project.address].filter((v) => v && v.trim() !== '').join(', ') || null
}

/** Описание и состав позиции: правки менеджера поверх черновика из ОЛ. */
function buildPosition(unit: KpUnitInput, index: number): KpPosition {
  const { snapshot } = unit
  const over = unit.kp ?? {}

  const draft = buildProductDraft(unit.deviceType, snapshot.bundlesJson, {
    wallMm: unit.wallMm ?? null,
    tag: over.tag ?? null,
    mark: over.mark ?? null,
    tu: over.tu ?? null,
  })
  const kit = over.kit ?? draft.kit
  const description = over.description?.trim() || productDescription(draft.spec, kit)

  const totalRub = Number.isFinite(snapshot.totalRub) && snapshot.totalRub > 0 ? snapshot.totalRub : 0
  // Тираж — количество изделий в заказе; цена снапшота относится ко всему
  // тиражу, поэтому цена за изделие получается делением, а не наоборот.
  const qty = Math.max(1, tirageOf(snapshot.bundlesJson))

  return {
    number: `1.${index}`,
    estimateId: unit.estimateId,
    title: unit.estimateTitle,
    deviceType: unit.deviceType,
    description,
    spec: draft.spec,
    kit,
    qty,
    unit: over.unit?.trim() || PRODUCT_UNIT,
    priceRub: round2(totalRub / qty),
    totalRub,
    snapshotVersion: snapshot.version,
    priceListVersion: snapshot.priceListVersion,
  }
}

/** Условия, подпись и реквизиты: дефолты плюс то, что задал менеджер. */
function headerParts(
  input: KpHeaderInput,
  issuedAt: Date,
  project: { address: string | null; title: string } | null,
): Pick<KpDocument, 'terms' | 'signature' | 'company' | 'vatRatePct'> {
  const terms: KpTerms = {
    ...defaultTerms(issuedAt, { deliveryTo: objectLine(project) }),
    ...(input.terms ?? {}),
  }
  const signature: KpSignature = {
    ...defaultSignature(input.executor ?? {}),
    ...(input.signature ?? {}),
  }
  return {
    terms,
    signature,
    company: input.company ?? companyFromEnv(),
    vatRatePct: terms.vatRatePct,
  }
}

function assemble(
  scope: KpScope,
  input: KpHeaderInput,
  positions: KpPosition[],
  issuedAt: Date,
  project: { title: string; customer: string | null; address: string | null } | null,
): KpDocument {
  const totalRub = round2(positions.reduce((sum, p) => sum + p.totalRub, 0))
  const parts = headerParts(input, issuedAt, project)

  return {
    number: input.number?.trim() || null,
    scope,
    issuedAt,
    customer: project?.customer ?? null,
    object: objectLine(project),
    positions,
    totalRub,
    vatRub: vatIncludedIn(totalRub, parts.vatRatePct),
    ...parts,
    meta: {
      positionsCount: positions.length,
      snapshotVersions: positions.map((p) => p.snapshotVersion),
      priceListVersions: positions.map((p) => p.priceListVersion),
    },
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
  return assemble('unit', input, [position], input.snapshot.createdAt, input.project)
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

  // Дата документа — самый поздний снапшот: документ описывает состояние на
  // этот момент, и повторная печать тех же данных даёт ту же дату.
  const issuedAt = new Date(
    Math.max(...input.units.map((u) => u.snapshot.createdAt.getTime()), 0),
  )
  return assemble('project', input, positions, issuedAt, input.project)
}

/**
 * Часовой пояс дат в документах — Москва (решение Р10, План_устранения 1.6).
 *
 * Контейнер живёт по UTC, и КП, выпущенное до 03:00 по Москве, получало
 * вчерашнюю дату. Данные поясов — в ICU самой Node (в образе
 * node:24-alpine полный ICU), от tzdata контейнера они не зависят.
 */
export const DOCUMENT_TIME_ZONE = 'Europe/Moscow'

const DATE_PARTS = new Intl.DateTimeFormat('ru-RU', {
  timeZone: DOCUMENT_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

/** День, месяц и год момента `d` по Москве. */
function moscowDate(d: Date): { day: string; month: string; year: string } {
  const part = (type: string) => DATE_PARTS.formatToParts(d).find((p) => p.type === type)?.value ?? ''
  return { day: part('day'), month: part('month'), year: part('year') }
}

/** Дата в формате документа, по Москве: 08.09.2026. */
export function formatDate(d: Date): string {
  const { day, month, year } = moscowDate(d)
  return `${day}.${month}.${year}`
}

/** Дата для имён файлов, по Москве: 2026-09-08. */
export function isoDate(d: Date): string {
  const { day, month, year } = moscowDate(d)
  return `${year}-${month}-${day}`
}

/**
 * Неразрывный пробел U+00A0 — записан escape-последовательностью намеренно:
 * литеральный символ в исходнике неотличим от обычного пробела и теряется
 * при первой же правке.
 */
export const NBSP = ' '

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

/** Сумма в колонке таблицы: без знака рубля — он в заголовке колонки. */
export function formatAmount(v: number): string {
  return formatMoney(v).replace(`${NBSP}₽`, '')
}

/** Количество: целые — без дробной части, дробные — до трёх знаков. */
export function formatQty(v: number): string {
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(3))).replace('.', ',')
}

/** Имя файла печатной формы: «КП 12-26 от 17.09.2026.docx». */
export function documentFileName(doc: KpDocument, ext: string): string {
  const head = doc.number ? `КП ${doc.number}` : 'КП'
  return `${head} от ${formatDate(doc.issuedAt)}.${ext}`
}
