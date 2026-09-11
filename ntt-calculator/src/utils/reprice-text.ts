/**
 * Тексты пересчёта цен по новой версии прайса — для плашки экрана расчёта,
 * окна перед выпуском КП и тоста (engines/reprice.ts, stores/calcTree.ts).
 *
 * @module utils/reprice-text
 */

import { RATE_ITEMS, type RateKey, type TreeRates } from '@/engines/economics'
import type { RateShift, RepriceSummary } from '@/engines/reprice'

/** Предпросмотр пересчёта: сводка и итоги до и после (stores/calcTree.ts, repricePreview). */
export interface RepricePreview {
  summary: RepriceSummary
  costBefore: number
  costAfter: number
  saleBefore: number
  saleAfter: number
}

/** Склонение: 1 строка, 2 строки, 5 строк. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10
  const n100 = n % 100
  if (n10 === 1 && n100 !== 11) return one
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few
  return many
}

/** «а», «а и б», «а, б и в». */
function listRu(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} и ${items[items.length - 1]}`
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtRub = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`

/** Сдвиг себестоимости в процентах; меньше десятой доли — так и сказано, а не «+0 %». */
export function costShiftText(before: number, after: number): string {
  if (before <= 0 || after === before) return 'без изменений'
  const pct = ((after - before) / before) * 100
  if (Math.abs(pct) < 0.05) return pct > 0 ? 'рост менее 0,1 %' : 'снижение менее 0,1 %'
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`
}

/** Сдвиг ставки словами: «ставка «Накладные расходы» 1 584,73 → 1 650 ₽/чел.ч». */
export function rateShiftText(r: RateShift): string {
  const { label, per } = RATE_ITEMS[r.key]
  const source = r.fromFallback && !r.toFallback
    ? ' (теперь из прайса)'
    : r.toFallback && !r.fromFallback ? ' (позиции нет в прайсе — константа программы)' : ''
  const value = r.from === r.to ? `${fmt(r.to)} ${per}` : `${fmt(r.from)} → ${fmt(r.to)} ${per}`
  return `ставка «${label}» ${value}${source}`
}

/**
 * Что даст пересчёт — словами: сколько строк сменит цену, что станет со
 * ставками, себестоимостью и ценой продажи, чего нет в новом прайсе.
 */
export function repriceSummaryText(p: RepricePreview): string {
  const s = p.summary
  const parts: string[] = []
  const shifts = s.rateShifts ?? []
  if (!s.changed && !s.fotRate && !shifts.length) {
    parts.push('Цены строк и ставки расчёта в нём те же — пересчёт только отметит версию.')
  } else {
    const what: string[] = []
    if (s.changed) what.push(`цена ${s.changed} ${pluralRu(s.changed, 'строки', 'строк', 'строк')}`)
    // Ставка ФОТ дерева и у спутников — одна: сдвиг показывается один раз.
    const fotInShifts = shifts.some((r) => r.key === 'fotRub')
    if (s.fotRate && !fotInShifts) what.push(`ставка ФОТ ${s.fotRate.from == null ? '—' : fmt(s.fotRate.from)} → ${fmt(s.fotRate.to)} ₽`)
    for (const r of shifts) what.push(rateShiftText(r))
    parts.push(
      `Изменится ${listRu(what)}: себестоимость ${fmtRub(p.costBefore)} → ${fmtRub(p.costAfter)} ` +
        `(${costShiftText(p.costBefore, p.costAfter)}), цена продажи ${fmtRub(p.saleBefore)} → ${fmtRub(p.saleAfter)}.`,
    )
    if (s.changedUnderManual) {
      parts.push(`У ${s.changedUnderManual} из них стоит ручная цена — она останется.`)
    }
  }
  if (s.notFound) {
    parts.push(`${s.notFound} ${pluralRu(s.notFound, 'позиции', 'позиций', 'позиций')} нет в новом прайсе — их цены останутся прежними.`)
  }
  return parts.join(' ')
}

/**
 * Откуда ставка расчёта — для сносок строк экономики: значение и источник.
 *
 * @param priceListVersion версия прайса, из которой ставка взята
 */
export function rateSourceText(key: RateKey, rates: TreeRates, priceListVersion: number): string {
  const { label, per } = RATE_ITEMS[key]
  const value = `Ставка «${label}» — ${fmt(rates[key])} ${per}`
  return rates.fallback?.includes(key)
    ? `${value}: константа программы — позиции нет в прайсе, КП не выпускается.`
    : `${value}, из прайса НН v${priceListVersion}; в расчёте она до пересчёта по прайсу.`
}

/**
 * Ставки не из прайса — заголовок плашки, пояснение и текст отказа в выпуске
 * КП (решение Р5).
 */
export function rateFallbackText(keys: readonly RateKey[]): { title: string; detail: string; blocked: string } {
  const names = keys.map((k) => `«${RATE_ITEMS[k].label}»`)
  const items = keys.map((k) => `«${RATE_ITEMS[k].category} / ${RATE_ITEMS[k].name} / ${RATE_ITEMS[k].unit}»`)
  const many = keys.length > 1
  return {
    title: `${many ? 'Ставок' : 'Ставки'} ${listRu(names)} нет в прайсе`,
    detail:
      `Расчёт посчитан по ${many ? 'константам' : 'константе'} программы, и КП по нему не выпускается. ` +
      `Добавьте в прайс ${many ? 'позиции' : 'позицию'} ${listRu(items)} и пересчитайте расчёт по нему.`,
    blocked: `КП не выпущено: ${many ? 'ставок' : 'ставки'} ${listRu(names)} нет в прайсе — расчёт посчитан по константам программы`,
  }
}

/** Итог пересчёта для тоста. */
export function repricedToastText(changed: number, version: number): string {
  return changed
    ? `Цены пересчитаны по прайсу v${version}: изменилась цена ${changed} ${pluralRu(changed, 'строки', 'строк', 'строк')}`
    : `Расчёт отмечен прайсом v${version}: цены строк не изменились`
}
