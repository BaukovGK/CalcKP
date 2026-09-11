import { beforeEach, describe, expect, it } from 'vitest'
import { BUILTIN_TEMPLATES } from '@/engines/code-nodes'
import { materializeTemplate, type TemplateBody } from '@/engines/template-def'
import { SAMPLE_SURVEYS } from '@/engines/template-samples'
import { __resetIds, flattenRows, type MaterializeContext } from '@/engines/template-kns'
import { diffTrees, settleTree, treeTotals } from './tree-preview'

const RATES = { fotRub: 1207.8, overheadRub: 1584.73, acetoneRub: 109.4, ppeRub: 122 }
const ctx: MaterializeContext = {
  // Прайс знает всё, кроме насосов: их строки остаются «красными».
  priceOf: (c) => (c === 'Насосы, АТМ' ? null : 100),
  pipeWeightOf: () => 900,
  nozzleNormOf: (dn) => ({ dn, odMm: null, minLengthMm: null, moldingMassKg: 1, h1Mm: null, s1Mm: null, flangeMassKg: 2, bolt: 'М20х90', boltCount: 8 }),
  jointLayerMassOf: () => 100,
  priceListVersion: 1,
}
const env = { device: 'KNS' as const, survey: SAMPLE_SURVEYS.KNS }
const build = (body: TemplateBody) => settleTree(materializeTemplate(ctx, env, { deviceType: 'KNS', version: 1, body }))

beforeEach(() => __resetIds())

describe('предпросмотр шаблона', () => {
  it('ФОТ-спутники считаются, как на экране расчёта', () => {
    const raw = materializeTemplate(ctx, env, { deviceType: 'KNS', version: 0, body: BUILTIN_TEMPLATES.KNS })
    expect(flattenRows(raw).filter((r) => r.kind === 'ФОТ').every((r) => r.qtyCalc === 0)).toBe(true)
    const settled = settleTree(raw)
    expect(flattenRows(settled).some((r) => r.kind === 'ФОТ' && (r.qtyCalc ?? 0) > 0)).toBe(true)
  })

  it('итоги: себестоимость, цена продажи и «красные» строки с ненулевым количеством', () => {
    const t = treeTotals(build(BUILTIN_TEMPLATES.KNS), RATES)
    expect(t.costRub).toBeGreaterThan(0)
    expect(t.salePriceRub).toBeGreaterThan(t.costRub)
    // Насосы и трубные муфты — категория «Насосы, АТМ»; труба корпуса — договорная.
    expect(t.unpriced).toBeGreaterThanOrEqual(2)
    expect(t.rows).toBeGreaterThan(t.unpriced)
  })

  it('отличия от действующей: добавлен, убран, перенесён узел', () => {
    const before = build(BUILTIN_TEMPLATES.KNS)
    const body = structuredClone(BUILTIN_TEMPLATES.KNS)
    body.sections[0]!.nodes = body.sections[0]!.nodes.filter((n) => n.kind !== 'builtin' || n.ref !== 'kns.cableEntry')
    body.sections[3]!.nodes = []
    body.sections[2]!.nodes.push({ kind: 'builtin', ref: 'kns.vent' })
    const d = diffTrees(before, build(body))
    expect(d.removed).toEqual([{ title: 'Кабельный ввод', section: 'Корпус' }])
    expect(d.moved).toEqual([{ title: 'Вентиляционный стояк ПЭ Ду110', section: 'Перекрытие, площадка, несущие балки', from: 'Вентиляционный стояк' }])
    expect(d.added).toEqual([])
    expect(d.changedRows).toBe(0)
  })

  it('тот же шаблон на другом ОЛ — новое количество строк, состав тот же', () => {
    const a = build(BUILTIN_TEMPLATES.KNS)
    __resetIds()
    const b = settleTree(materializeTemplate(ctx, { device: 'KNS', survey: { ...SAMPLE_SURVEYS.KNS, depthMm: 9000 } }, { deviceType: 'KNS', version: 1, body: BUILTIN_TEMPLATES.KNS }))
    const d = diffTrees(a, b)
    expect(d.added.length + d.removed.length + d.moved.length).toBe(0)
    expect(d.changedRows).toBeGreaterThan(5)
  })
})
