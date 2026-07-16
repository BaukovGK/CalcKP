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

// FOT coefficient by operation name — from Excel COUNTIF logic
export function fotCoeff(name: string): number {
  const n = name.toLowerCase()
  if (n.includes('мех') || n.includes('формов')) return 0.28
  if (n.includes('ламин')) return 0.56
  return 1.0
}

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
