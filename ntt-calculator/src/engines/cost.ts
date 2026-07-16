/**
 * УСТАРЕВШИЙ движок свободного дерева «связка→группа→подгруппа→строка».
 *
 * Заменяется движком §9 (`engines/row.ts`, `fot.ts`, `economics.ts`,
 * `rounding.ts`). Живёт до этапа 5, пока на нём держатся текущие компоненты
 * калькулятора; новый код сюда добавлять не нужно.
 *
 * Осторожно: здесь всё считается через parseFloat поверх строк и без
 * округления — расхождения с эталоном ожидаемы. Единственный источник истины
 * по округлению — `engines/rounding.ts`.
 */
import type { CalcRow, CalcSubgroup, CalcGroup, CalcBundle } from '@/types/calculator'

export const rowSum = (r: CalcRow): number =>
  (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0)

export const sgSum = (sg: CalcSubgroup): number =>
  sg.rows.reduce((s, r) => s + rowSum(r), 0)

export const gSum = (g: CalcGroup): number =>
  g.subgroups.reduce((s, sg) => s + sgSum(sg), 0)

export const bSum = (b: CalcBundle): number =>
  b.groups.reduce((s, g) => s + gSum(g), 0)

export const grandTotal = (bundles: CalcBundle[]): number =>
  bundles.reduce((s, b) => s + bSum(b), 0)

export const fmt = (n: number): string =>
  n ? n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—'

// fotCoeff удалён: не вызывался ниоткуда и содержал ошибку — возвращал 0,28 на
// любое вхождение «формов», то есть и для «Ручной формовки», которой по §9.3
// положено 1,0 (0,28 — только механическая формовка).
// Актуальная реализация: engines/fot.ts → fotCoeffByName / resolveFotK.

// Recalculate auto-linked rows within a subgroup
export function recalcAuto(sg: CalcSubgroup): void {
  for (const r of sg.rows) {
    if (!r.isAuto || !r.autoParentId || r.autoCoeff == null) continue
    const parent = sg.rows.find(x => x.id === r.autoParentId)
    if (!parent) continue
    const pQty = parseFloat(parent.qty) || 0
    r.qty = String(Math.round(pQty * r.autoCoeff * 1000) / 1000)
  }
}
