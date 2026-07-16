import { defineStore } from 'pinia'
import { reactive, computed } from 'vue'
import type { CalcBundle, CalcGroup, CalcSubgroup, CalcRow, RowType, BuyState } from '@/types/calculator'
import { bSum, gSum, sgSum, rowSum, grandTotal, recalcAuto } from '@/engines/cost'
import { BCOLORS, FOT_RATE, RTYPE_ORDER, BUY_CYCLE } from '@/data/nomenclature'

// ── UID ──────────────────────────────────────────────────────────────────────
let _id = 100
const uid = () => 'u' + (++_id)

// ── FACTORIES ─────────────────────────────────────────────────────────────────
export function mkRow(o: Partial<CalcRow> = {}): CalcRow {
  return reactive<CalcRow>({
    id: uid(), rtype: 'МАТ', category: 'Собственное производство',
    name: '', purchase: 'нет', qty: '', unit: 'шт', price: '', note: '',
    isAuto: false, autoParentId: null, autoCoeff: null,
    ...o,
  })
}

export function mkFOT(parentId: string, coeff = 1.0): CalcRow {
  return mkRow({
    rtype: 'ФОТ', category: 'ФОТ', name: 'ФОТ',
    price: FOT_RATE, unit: 'ч·ч',
    isAuto: true, autoParentId: parentId, autoCoeff: coeff,
  })
}

export function mkSubgroup(o: Partial<CalcSubgroup> = {}): CalcSubgroup {
  return reactive<CalcSubgroup>({ id: uid(), title: 'Подгруппа', collapsed: false, rows: [], ...o })
}

export function mkGroup(o: Partial<CalcGroup> = {}): CalcGroup {
  return reactive<CalcGroup>({ id: uid(), title: 'Группа', collapsed: false, subgroups: [], ...o })
}

export function mkBundle(colorIdx = 0, o: Partial<CalcBundle> = {}): CalcBundle {
  return reactive<CalcBundle>({
    id: uid(), title: 'Новая связка',
    color: BCOLORS[colorIdx % BCOLORS.length] ?? BCOLORS[0],
    collapsed: false, groups: [],
    ...o,
  })
}

// ── STORE ─────────────────────────────────────────────────────────────────────
export const useCalculatorStore = defineStore('calculator', () => {
  const bundles = reactive<CalcBundle[]>([])

  const total = computed(() => grandTotal(bundles))

  // ── Finders ────────────────────────────────────────────────────────────────
  const findBundle = (id: string) => bundles.find(b => b.id === id)

  function findGroup(id: string) {
    for (const b of bundles)
      for (const g of b.groups)
        if (g.id === id) return { b, g }
    return null
  }

  function findSG(id: string) {
    for (const b of bundles)
      for (const g of b.groups)
        for (const sg of g.subgroups)
          if (sg.id === id) return { b, g, sg }
    return null
  }

  function findRow(id: string) {
    for (const b of bundles)
      for (const g of b.groups)
        for (const sg of g.subgroups)
          for (const r of sg.rows)
            if (r.id === id) return { b, g, sg, r }
    return null
  }

  // ── Row mutations ──────────────────────────────────────────────────────────
  function setField(rid: string, field: keyof CalcRow, value: string) {
    const f = findRow(rid)
    if (!f) return
    ;(f.r as any)[field] = value
    if (field === 'qty' || field === 'price') recalcAuto(f.sg)
  }

  function setQty(rid: string, value: string) {
    const f = findRow(rid)
    if (!f) return
    f.r.qty = value
    recalcAuto(f.sg)
  }

  function overrideAuto(rid: string, value: string) {
    const f = findRow(rid)
    if (!f) return
    f.r.qty = value
    f.r.isAuto = false
    f.r.autoParentId = null
  }

  function cycleRtype(rid: string) {
    const f = findRow(rid)
    if (!f) return
    const i = RTYPE_ORDER.indexOf(f.r.rtype as any)
    f.r.rtype = RTYPE_ORDER[(i + 1) % RTYPE_ORDER.length] as RowType
    if (f.r.rtype === 'ФОТ') {
      f.r.category = 'ФОТ'
      f.r.name = 'ФОТ'
      f.r.price = FOT_RATE
    }
  }

  function cycleBuy(rid: string) {
    const f = findRow(rid)
    if (!f) return
    const i = BUY_CYCLE.indexOf(f.r.purchase as any)
    f.r.purchase = BUY_CYCLE[(i + 1) % BUY_CYCLE.length] as BuyState
  }

  function addRowToSG(sgid: string, rtype: RowType = 'МАТ') {
    const f = findSG(sgid)
    if (!f) return
    const nr = mkRow({
      rtype,
      category: rtype === 'ФОТ' ? 'ФОТ' : 'Собственное производство',
      name: rtype === 'ФОТ' ? 'ФОТ' : '',
      price: rtype === 'ФОТ' ? FOT_RATE : '',
    })
    const rows = f.sg.rows
    const lastFotIdx = [...rows].map((r, i) => ({ r, i }))
      .filter(({ r }) => r.rtype === 'ФОТ').slice(-1)[0]?.i ?? rows.length
    if (rtype !== 'ФОТ') rows.splice(lastFotIdx, 0, nr)
    else rows.push(nr)
    return nr.id
  }

  function dupRow(rid: string) {
    const f = findRow(rid)
    if (!f) return
    const nr = mkRow({ ...f.r, id: uid(), isAuto: false, autoParentId: null })
    f.sg.rows.splice(f.sg.rows.indexOf(f.r) + 1, 0, nr)
  }

  function deleteRow(rid: string) {
    const f = findRow(rid)
    if (!f) return
    if (f.sg.rows.length === 1 && !confirm('Удалить последнюю строку?')) return
    f.sg.rows.splice(f.sg.rows.indexOf(f.r), 1)
  }

  // ── Subgroup mutations ─────────────────────────────────────────────────────
  function addSubgroup(gid: string, afterId?: string) {
    const f = findGroup(gid)
    if (!f) return
    const mat = mkRow({ rtype: 'МАТ', name: '' })
    const fot = mkFOT(mat.id, 1.0)
    const nsg = mkSubgroup({ title: 'Новая подгруппа', rows: [mat, fot] })
    if (afterId) {
      const i = f.g.subgroups.findIndex(s => s.id === afterId)
      f.g.subgroups.splice(i + 1, 0, nsg)
    } else {
      f.g.subgroups.push(nsg)
    }
    return nsg.id
  }

  function dupSubgroup(sgid: string) {
    const f = findSG(sgid)
    if (!f) return
    const idMap: Record<string, string> = {}
    const newRows = f.sg.rows.map(r => {
      const nr = mkRow({ ...r, id: uid() })
      idMap[r.id] = nr.id
      return nr
    })
    newRows.forEach(r => { if (r.autoParentId) r.autoParentId = idMap[r.autoParentId] || r.autoParentId })
    const nsg = mkSubgroup({ title: f.sg.title + ' (копия)', rows: newRows })
    f.g.subgroups.splice(f.g.subgroups.indexOf(f.sg) + 1, 0, nsg)
  }

  function deleteSubgroup(sgid: string) {
    const f = findSG(sgid)
    if (!f) return
    if (f.g.subgroups.length === 1 && !confirm('Удалить последнюю подгруппу?')) return
    f.g.subgroups.splice(f.g.subgroups.indexOf(f.sg), 1)
  }

  function moveSG(gid: string, sgid: string, dir: -1 | 1) {
    const f = findGroup(gid)
    if (!f) return
    const i = f.g.subgroups.findIndex(s => s.id === sgid)
    const ni = i + dir
    if (ni < 0 || ni >= f.g.subgroups.length) return
    const sg = f.g.subgroups.splice(i, 1)[0]!
    f.g.subgroups.splice(ni, 0, sg)
  }

  function moveRow(fromRid: string, toRid: string) {
    const fromF = findRow(fromRid)
    const toF = findRow(toRid)
    if (!fromF || !toF || fromRid === toRid) return
    fromF.sg.rows.splice(fromF.sg.rows.indexOf(fromF.r), 1)
    const ti = toF.sg.rows.findIndex(r => r.id === toRid)
    toF.sg.rows.splice(ti, 0, fromF.r)
  }

  // ── Group mutations ────────────────────────────────────────────────────────
  function addGroup(bid: string) {
    const b = findBundle(bid)
    if (!b) return
    const mat = mkRow({ rtype: 'МАТ' })
    const fot = mkFOT(mat.id, 1.0)
    const ng = mkGroup({
      title: `${b.groups.length + 1}. Группа`,
      subgroups: [mkSubgroup({ title: 'Подгруппа 1', rows: [mat, fot] })],
    })
    b.groups.push(ng)
    return ng.id
  }

  function dupGroup(bid: string, gid: string) {
    const b = findBundle(bid)
    const f = findGroup(gid)
    if (!b || !f) return
    const ng = mkGroup({
      title: f.g.title + ' (копия)',
      subgroups: f.g.subgroups.map(sg => {
        const idMap: Record<string, string> = {}
        const nr = sg.rows.map(r => { const x = mkRow({ ...r, id: uid() }); idMap[r.id] = x.id; return x })
        nr.forEach(r => { if (r.autoParentId) r.autoParentId = idMap[r.autoParentId] || r.autoParentId })
        return mkSubgroup({ title: sg.title, rows: nr })
      }),
    })
    b.groups.splice(b.groups.indexOf(f.g) + 1, 0, ng)
  }

  function deleteGroup(bid: string, gid: string) {
    const b = findBundle(bid)
    if (!b) return
    if (b.groups.length === 1 && !confirm('Удалить последнюю группу?')) return
    b.groups.splice(b.groups.findIndex(g => g.id === gid), 1)
  }

  function moveGroup(bid: string, gid: string, dir: -1 | 1) {
    const b = findBundle(bid)
    if (!b) return
    const i = b.groups.findIndex(g => g.id === gid)
    const ni = i + dir
    if (ni < 0 || ni >= b.groups.length) return
    const g = b.groups.splice(i, 1)[0]!
    b.groups.splice(ni, 0, g)
  }

  function moveSGToGroup(sgid: string, toGid: string, beforeSGid?: string) {
    const f = findSG(sgid)
    const toG = findGroup(toGid)
    if (!f || !toG) return
    f.g.subgroups.splice(f.g.subgroups.indexOf(f.sg), 1)
    const ti = beforeSGid ? toG.g.subgroups.findIndex(s => s.id === beforeSGid) : toG.g.subgroups.length
    toG.g.subgroups.splice(ti < 0 ? toG.g.subgroups.length : ti, 0, f.sg)
  }

  // ── Bundle mutations ───────────────────────────────────────────────────────
  function addBundle() {
    const nb = mkBundle(bundles.length)
    const mat = mkRow({ rtype: 'МАТ' })
    const fot = mkFOT(mat.id, 1.0)
    nb.groups.push(mkGroup({
      title: '1. Группа',
      subgroups: [mkSubgroup({ title: 'Подгруппа 1', rows: [mat, fot] })],
    }))
    bundles.push(nb)
    return nb.id
  }

  function deleteBundle(bid: string) {
    if (!confirm('Удалить связку со всеми данными?')) return
    bundles.splice(bundles.findIndex(b => b.id === bid), 1)
  }

  function moveBundle(bid: string, dir: -1 | 1) {
    const i = bundles.findIndex(b => b.id === bid)
    const ni = i + dir
    if (ni < 0 || ni >= bundles.length) return
    const b = bundles.splice(i, 1)[0]!
    bundles.splice(ni, 0, b)
  }

  function moveBundleDrop(fromId: string, toId: string) {
    if (fromId === toId) return
    const fi = bundles.findIndex(b => b.id === fromId)
    const ti = bundles.findIndex(b => b.id === toId)
    if (fi < 0 || ti < 0) return
    const b = bundles.splice(fi, 1)[0]!
    bundles.splice(ti, 0, b)
  }

  function collapseAll() {
    bundles.forEach(b => b.groups.forEach(g => {
      g.collapsed = true
      g.subgroups.forEach(sg => sg.collapsed = true)
    }))
  }

  function expandAll() {
    bundles.forEach(b => {
      b.collapsed = false
      b.groups.forEach(g => {
        g.collapsed = false
        g.subgroups.forEach(sg => sg.collapsed = false)
      })
    })
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function exportTxt() {
    const lines = ['НТТ · Калькулятор\n']
    bundles.forEach(b => {
      lines.push(`\n═ ${b.title} (${bSum(b)} ₽)`)
      b.groups.forEach(g => {
        lines.push(`  ─ ${g.title} (${gSum(g)} ₽)`)
        g.subgroups.forEach(sg => {
          lines.push(`    ▸ ${sg.title} (${sgSum(sg)} ₽)`)
          sg.rows.forEach(r => {
            const s = rowSum(r)
            lines.push(`      ${r.isAuto ? '[авто] ' : ''}[${r.rtype}] ${r.name}\t${r.qty} ${r.unit} × ${r.price || '—'} = ${s} ₽`)
          })
        })
      })
    })
    lines.push(`\n\nИТОГО: ${grandTotal(bundles)} ₽`)
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })),
      download: 'калькулятор_нтт.txt',
    })
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return {
    bundles, total,
    bSum, gSum, sgSum, rowSum,
    findBundle, findGroup, findSG, findRow,
    setField, setQty, overrideAuto, cycleRtype, cycleBuy,
    addRowToSG, dupRow, deleteRow, moveRow,
    addSubgroup, dupSubgroup, deleteSubgroup, moveSG, moveSGToGroup,
    addGroup, dupGroup, deleteGroup, moveGroup,
    addBundle, deleteBundle, moveBundle, moveBundleDrop,
    collapseAll, expandAll, exportTxt,
  }
})
