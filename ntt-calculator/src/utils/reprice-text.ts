/**
 * Тексты пересчёта цен по новой версии прайса — для плашки экрана расчёта,
 * окна перед выпуском КП и тоста (engines/reprice.ts, stores/calcTree.ts).
 *
 * @module utils/reprice-text
 */

import type { RepriceSummary } from '@/engines/reprice'

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

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtRub = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`

/** Сдвиг себестоимости в процентах; меньше десятой доли — так и сказано, а не «+0 %». */
export function costShiftText(before: number, after: number): string {
  if (before <= 0 || after === before) return 'без изменений'
  const pct = ((after - before) / before) * 100
  if (Math.abs(pct) < 0.05) return pct > 0 ? 'рост менее 0,1 %' : 'снижение менее 0,1 %'
  return `${pct > 0 ? '+' : ''}${pct.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`
}

/**
 * Что даст пересчёт — словами: сколько строк сменит цену, что станет со
 * ставкой ФОТ, себестоимостью и ценой продажи, чего нет в новом прайсе.
 */
export function repriceSummaryText(p: RepricePreview): string {
  const s = p.summary
  const parts: string[] = []
  if (!s.changed && !s.fotRate) {
    parts.push('Цены строк расчёта в нём те же — пересчёт только отметит версию.')
  } else {
    const what: string[] = []
    if (s.changed) what.push(`цена ${s.changed} ${pluralRu(s.changed, 'строки', 'строк', 'строк')}`)
    if (s.fotRate) what.push(`ставка ФОТ ${s.fotRate.from == null ? '—' : fmt(s.fotRate.from)} → ${fmt(s.fotRate.to)} ₽`)
    parts.push(
      `Изменится ${what.join(' и ')}: себестоимость ${fmtRub(p.costBefore)} → ${fmtRub(p.costAfter)} ` +
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

/** Итог пересчёта для тоста. */
export function repricedToastText(changed: number, version: number): string {
  return changed
    ? `Цены пересчитаны по прайсу v${version}: изменилась цена ${changed} ${pluralRu(changed, 'строки', 'строк', 'строк')}`
    : `Расчёт отмечен прайсом v${version}: цены строк не изменились`
}
