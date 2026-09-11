import { aggregateRows, computeEconomics, DEFAULT_MARKUP, type Rates } from '@/engines/economics'
import { recalcFotSatellites } from '@/engines/fot'
import { computeRow } from '@/engines/row'
import { flattenRows, sectionEnabledFor, type CalcRowNode, type CalcTree } from '@/engines/template-kns'

/**
 * Предпросмотр материализации в редакторе шаблонов: дерево «как у инженера»
 * — с ФОТ-спутниками, итогами и сравнением с действующей версией.
 *
 * Считает тот же движок, что экран расчёта (economics.ts, fot.ts), поэтому
 * цифры предпросмотра — те, что увидит инженер на том же ОЛ.
 */

/** Дерево с пересчитанными ФОТ-спутниками — материализация их не считает. */
export function settleTree(tree: CalcTree): CalcTree {
  const byId = new Map(recalcFotSatellites(flattenRows(tree), { tirage: 1 }).map((r) => [r.id, r as CalcRowNode]))
  return {
    ...tree,
    sections: tree.sections.map((s) => ({
      ...s,
      components: s.components.map((c) => ({ ...c, rows: c.rows.map((r) => byId.get(r.id) ?? r) })),
    })),
  }
}

export interface TreeTotals {
  costRub: number
  salePriceRub: number
  /** Строк, которые считаются: включены и с ненулевым количеством. */
  rows: number
  /** Строки без цены с ненулевым количеством — «красные». */
  unpriced: number
}

/** Итоги дерева по наценке по умолчанию, за один корпус. */
export function treeTotals(tree: CalcTree, rates: Rates): TreeTotals {
  const rows = flattenRows(tree)
  const enabled = sectionEnabledFor(tree)
  const e = computeEconomics(aggregateRows(rows, { sectionEnabled: enabled, tirage: 1 }), rates, { markup: DEFAULT_MARKUP })
  let counted = 0
  let unpriced = 0
  for (const r of rows) {
    const res = computeRow(r, { sectionEnabled: enabled(r), tirage: 1 })
    if (res.qty === 0) continue
    counted++
    if (res.missingPrice) unpriced++
  }
  return { costRub: e.costRub, salePriceRub: e.salePriceRub, rows: counted, unpriced }
}

export interface ComponentPlace {
  title: string
  section: string
}

export interface TreeDiff {
  added: ComponentPlace[]
  removed: ComponentPlace[]
  /** Компонент в другом разделе: `section` — новый, `from` — прежний. */
  moved: Array<ComponentPlace & { from: string }>
  /** Строки, у которых сменилось расчётное количество, — в общих компонентах. */
  changedRows: number
}

const place = (tree: CalcTree) => {
  const out = new Map<string, string>()
  for (const s of tree.sections) for (const c of s.components) if (!out.has(c.title)) out.set(c.title, s.title)
  return out
}

/**
 * Что изменит шаблон относительно действующего на том же ОЛ: какие узлы
 * появятся, пропадут, переедут в другой раздел и у скольких строк сменится
 * расчётное количество. Компоненты сопоставляются по названию — как при
 * пересборке расчёта (stores/calcTree.ts, reconcileTrees).
 */
export function diffTrees(before: CalcTree, after: CalcTree): TreeDiff {
  const a = place(before)
  const b = place(after)
  const added: ComponentPlace[] = []
  const removed: ComponentPlace[] = []
  const moved: TreeDiff['moved'] = []
  for (const [title, section] of b) {
    const was = a.get(title)
    if (was === undefined) added.push({ title, section })
    else if (was !== section) moved.push({ title, section, from: was })
  }
  for (const [title, section] of a) if (!b.has(title)) removed.push({ title, section })

  const key = (c: string, r: CalcRowNode) => `${c}|${r.kind}|${r.name}|${r.unit}`
  const qtyOf = (tree: CalcTree) => {
    const m = new Map<string, number | null>()
    for (const s of tree.sections) for (const c of s.components) for (const r of c.rows) if (r.kind !== 'ФОТ') m.set(key(c.title, r), r.qtyCalc)
    return m
  }
  const qa = qtyOf(before)
  let changedRows = 0
  for (const [k, q] of qtyOf(after)) if (qa.has(k) && qa.get(k) !== q) changedRows++
  return { added, removed, moved, changedRows }
}
