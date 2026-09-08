/**
 * Модель печатной формы КП — то, что уходит заказчику.
 *
 * Чистая сборка: снапшот + карточка расчёта → структура документа. Рендеры
 * (`kp-docx.ts`, `kp-pdf.ts`) не знают ни про Prisma, ни про HTTP и получают
 * готовую модель, поэтому вёрстку можно менять, не трогая данные.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ДВА РЕШЕНИЯ, КОТОРЫЕ НУЖНО ПОДТВЕРДИТЬ ОБРАЗЦОМ ЗАКАЗЧИКА
 *
 * 1. Цены по строкам НЕ печатаются. В расчёте цена строки — это ЦЕНА ЗАКУПКИ
 *    из прайса НН (себестоимость), а цена заказчику получается из неё через
 *    наценку (`engines/economics.ts`, salePriceFromCost). Напечатать строки с
 *    их ценами — значит показать заказчику себестоимость и, вместе с итогом,
 *    всю маржу. Поэтому КП содержит спецификацию БЕЗ цен и одну итоговую
 *    цену. Когда образец придёт, включить цены построчно — правка одного
 *    этого файла и шаблона рендера.
 *
 * 2. НДС не начисляется сверху, а выделяется «в том числе». Движок прямо
 *    фиксирует: «Себестоимость с НДС: НДС зашит в цены прайса, отдельно не
 *    выделяется» (`engines/economics.ts`, Economics.costRub). Значит цена
 *    продажи — уже с НДС, и накрутить 20% сверх неё нельзя: это удорожило бы
 *    КП на пятую часть. Ставка {@link VAT_RATE_PCT} — предположение, влияющее
 *    ТОЛЬКО на справочную строку «в том числе НДС»; итог от неё не зависит.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * @module utils/kp-document
 */

import { extractSpecification, type SpecSection } from './estimate-tree'

/**
 * Ставка НДС для справочной строки «в том числе», %.
 *
 * Не начисляется сверху (см. решение 2 в шапке модуля): цена уже включает
 * налог. Изменение ставки не меняет итоговую сумму КП.
 */
export const VAT_RATE_PCT = 20

/** Реквизиты и содержание печатной формы. */
export interface KpDocument {
  /** Номер документа: «КП-<8 символов id>-v<версия снапшота>». */
  number: string
  /** Дата выпуска КП = дата снапшота, ISO-строка. */
  issuedAt: Date
  customer: string | null
  project: string | null
  address: string | null
  /** Обозначение изделия, напр. «КНС DN3000». */
  deviceTitle: string
  deviceType: string
  /** Версия прайса, из которой посчитан снапшот (ТЗ §3). */
  priceListVersion: number
  /** Версия снапшота — она же номер редакции КП. */
  snapshotVersion: number
  sections: SpecSection[]
  /** Цена заказчику, ₽, с НДС — зафиксирована снапшотом. */
  totalRub: number
  /** Справочно: НДС в составе цены, ₽. */
  vatRub: number
  vatRatePct: number
  /** Итог по строкам спецификации — сколько позиций попало в документ. */
  positionsCount: number
}

export interface KpDocumentInput {
  estimateId: string
  estimateTitle: string
  deviceType: string
  project: { title: string; customer: string | null; address: string | null } | null
  snapshot: {
    version: number
    priceListVersion: number
    totalRub: number
    createdAt: Date
    /** Снимок дерева расчёта на момент выпуска КП. */
    bundlesJson: unknown
  }
}

/** НДС, выделенный из суммы, уже включающей налог: сумма × ставка / (100 + ставка). */
export function vatIncludedIn(totalRub: number, ratePct: number = VAT_RATE_PCT): number {
  if (!Number.isFinite(totalRub) || totalRub <= 0) return 0
  return round2((totalRub * ratePct) / (100 + ratePct))
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * Собрать модель КП из снапшота.
 *
 * Источник цифры — ИМЕННО снапшот, а не текущее состояние расчёта: расчёт
 * после выпуска КП не замораживается и продолжает правиться (Механика §10),
 * поэтому документ обязан воспроизводить то, что было согласовано.
 */
export function buildKpDocument(input: KpDocumentInput): KpDocument {
  const { snapshot } = input
  const sections = extractSpecification(snapshot.bundlesJson)
  const totalRub = Number.isFinite(snapshot.totalRub) && snapshot.totalRub > 0 ? snapshot.totalRub : 0

  return {
    number: `КП-${input.estimateId.slice(0, 8).toUpperCase()}-v${snapshot.version}`,
    issuedAt: snapshot.createdAt,
    customer: input.project?.customer ?? null,
    project: input.project?.title ?? null,
    address: input.project?.address ?? null,
    deviceTitle: input.estimateTitle,
    deviceType: input.deviceType,
    priceListVersion: snapshot.priceListVersion,
    snapshotVersion: snapshot.version,
    sections,
    totalRub,
    vatRub: vatIncludedIn(totalRub),
    vatRatePct: VAT_RATE_PCT,
    positionsCount: sections.reduce((n, s) => n + s.rows.length, 0),
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
