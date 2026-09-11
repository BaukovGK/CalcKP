import { beforeEach, describe, expect, it } from 'vitest'
import type { DeviceType } from '@/types/device'
import { BUILTIN_NODES, BUILTIN_TEMPLATES, builtinNodesOf } from './code-nodes'
import { activeTemplate, materializeEmk, materializeKns, materializeKol } from './materialize'
import type { CatalogNode, NodeDefBody } from './node-def'
import { SAMPLE_SURVEYS } from './template-samples'
import {
  bindParams,
  builtinTemplate,
  materializeTemplate,
  surveyFieldsOf,
  surveyScope,
  templateCatalogCodes,
  validateTemplate,
  type ProductTemplate,
  type TemplateBody,
} from './template-def'
import { __resetIds, flattenRows, type CalcTree, type MaterializeContext } from './template-kns'

const PLATFORM: NodeDefBody = {
  code: 'B5',
  name: 'Площадка обслуживания Ø{d}',
  tag: 'конструкции обслуживания',
  params: [
    { key: 'd', label: 'DN корпуса', type: 'number', unit: 'мм', default: 2000 },
    { key: 'h', label: 'Высота станции', type: 'number', unit: 'м' },
    { key: 'on', label: 'Площадка нужна', type: 'bool', default: true },
    { key: 'mark', label: 'Марка', type: 'text', default: 'ПО-1' },
  ],
  enabledBy: 'on',
  rows: [
    { kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', unit: 'м', qty: 'ПИ() * d / 1000 + h' },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Монтаж площадки {mark}', unit: 'чел. ч', qty: 'ОКРВВЕРХ(d / 1000; 0)' },
  ],
}
const CATALOG: Record<string, CatalogNode> = { B5: { code: 'B5', version: 2, body: PLATFORM } }

const baseCtx: MaterializeContext = {
  priceOf: (c, n) => (n.startsWith('Уголок') ? 950 : c === 'ФОТ' ? 1207.8 : null),
  pipeWeightOf: (dn) => dn / 10,
  nozzleNormOf: (dn) => ({ dn, odMm: null, minLengthMm: null, moldingMassKg: dn / 100, h1Mm: null, s1Mm: null, flangeMassKg: dn / 50, bolt: 'М20х90', boltCount: 8 }),
  jointLayerMassOf: (d) => d / 20,
  ellipticBottomOf: (dn) => ({ massKg: dn / 5, thicknessMm: 10 }),
  catalogNodeOf: (code) => CATALOG[code] ?? null,
  priceListVersion: 5,
}

const withTemplate = (t: ProductTemplate): MaterializeContext => ({ ...baseCtx, templateOf: (d) => (d === t.deviceType ? t : null) })

const rowKeys = (tree: CalcTree) => flattenRows(tree).map((r) => `${r.kind}|${r.name}|${r.unit}|${r.qtyCalc}`).sort()

beforeEach(() => __resetIds())

describe('встроенные шаблоны — данные', () => {
  it.each(['KNS', 'EMK', 'KOL'] as DeviceType[])('%s: ссылается только на свои встроенные узлы, каждый ровно раз', (device) => {
    const issues = validateTemplate(device, BUILTIN_TEMPLATES[device], () => null)
    expect(issues).toEqual([])
    const used = BUILTIN_TEMPLATES[device].sections.flatMap((s) => s.nodes.map((n) => (n.kind === 'builtin' ? n.ref : '')))
    expect(used.sort()).toEqual(builtinNodesOf(device).map((n) => n.ref).sort())
  })

  it('без шаблона технолога изделие собирается встроенным, версия 0', () => {
    const tree = materializeKns(baseCtx, SAMPLE_SURVEYS.KNS)
    expect(tree.templateVersion).toBe(0)
    expect(activeTemplate(baseCtx, 'KNS').version).toBe(0)
  })

  it('ссылки встроенных узлов уникальны', () => {
    const refs = BUILTIN_NODES.map((n) => n.ref)
    expect(new Set(refs).size).toBe(refs.length)
  })

  it.each(['KNS', 'EMK', 'KOL'] as DeviceType[])('%s: пример ОЛ предпросмотра собирается и содержит строки', (device) => {
    const m = { KNS: materializeKns, EMK: materializeEmk, KOL: materializeKol }[device] as (c: MaterializeContext, s: unknown) => CalcTree
    const tree = m(baseCtx, SAMPLE_SURVEYS[device])
    expect(flattenRows(tree).length).toBeGreaterThan(40)
  })
})

describe('шаблон технолога: перестановки узлов', () => {
  /** Корзину и дробилку КНС — в отдельный раздел, перекрытие — раньше лестницы. */
  const reordered = (): TemplateBody => {
    const b = structuredClone(BUILTIN_TEMPLATES.KNS)
    const korpus = b.sections[0]!
    korpus.nodes = korpus.nodes.filter((n) => n.kind !== 'builtin' || (n.ref !== 'kns.basket' && n.ref !== 'kns.grinder'))
    const [ladder, slab] = [b.sections[1]!, b.sections[2]!]
    b.sections.splice(1, 2, slab, ladder)
    b.sections.splice(2, 0, { title: 'Корзина и дробилка', nodes: [{ kind: 'builtin', ref: 'kns.basket' }, { kind: 'builtin', ref: 'kns.grinder' }] })
    return b
  }

  it('разделы и узлы идут в порядке шаблона, номер раздела — его место', () => {
    const tree = materializeKns(withTemplate({ deviceType: 'KNS', version: 3, body: reordered() }), SAMPLE_SURVEYS.KNS)
    expect(tree.templateVersion).toBe(3)
    expect(tree.sections.map((s) => `${s.code} ${s.title}`)).toEqual([
      '1 Корпус',
      '2 Перекрытие, площадка, несущие балки',
      '3 Корзина и дробилка',
      '4 Лестница',
      '5 Вентиляционный стояк',
      '6 Напорный трубопровод',
      '7 Крепёж',
      '8 Оборудование и запорная арматура',
    ])
    expect(tree.sections[2]!.components.map((c) => c.nodeCode)).toEqual(['D3', 'D4'])
    expect(tree.sections[0]!.components.some((c) => c.nodeCode === 'D3')).toBe(false)
  })

  it('перестановка не меняет ни одной строки — только их место', () => {
    const before = materializeKns(baseCtx, SAMPLE_SURVEYS.KNS)
    const after = materializeKns(withTemplate({ deviceType: 'KNS', version: 3, body: reordered() }), SAMPLE_SURVEYS.KNS)
    expect(rowKeys(after)).toEqual(rowKeys(before))
  })

  it('убранный из шаблона узел не материализуется; проверка предупреждает', () => {
    const b = structuredClone(BUILTIN_TEMPLATES.KNS)
    b.sections[0]!.nodes = b.sections[0]!.nodes.filter((n) => n.kind !== 'builtin' || n.ref !== 'kns.cableEntry')
    const tree = materializeKns(withTemplate({ deviceType: 'KNS', version: 1, body: b }), SAMPLE_SURVEYS.KNS)
    expect(tree.sections[0]!.components.some((c) => c.nodeCode === 'A7')).toBe(false)
    const issues = validateTemplate('KNS', b, () => null)
    expect(issues).toEqual([{ path: 'sections', message: expect.stringMatching(/«Кабельный ввод» не входит/), warn: true }])
  })

  it('шаблон другого изделия не применяется', () => {
    const foreign: ProductTemplate = { deviceType: 'EMK', version: 9, body: BUILTIN_TEMPLATES.EMK }
    const ctx = { ...baseCtx, templateOf: () => foreign }
    expect(activeTemplate(ctx, 'KNS').version).toBe(0)
    expect(materializeKns(ctx, SAMPLE_SURVEYS.KNS).sections).toHaveLength(7)
  })
})

describe('шаблон технолога: узлы каталога с биндингами на ОЛ', () => {
  const withPlatform = (bindings: Record<string, string>, title?: string): ProductTemplate => {
    const body = structuredClone(BUILTIN_TEMPLATES.KNS)
    body.sections[2]!.nodes.push({ kind: 'catalog', code: 'B5', bindings, ...(title ? { title } : {}) })
    return { deviceType: 'KNS', version: 4, body }
  }

  it('параметры узла берутся из полей ОЛ через формулы биндингов', () => {
    const t = withPlatform({ d: 'dn', h: 'heightM', on: 'hasBasket' })
    const tree = materializeKns(withTemplate(t), SAMPLE_SURVEYS.KNS)
    const c = tree.sections[2]!.components.slice(-1)[0]!
    expect(c).toMatchObject({ nodeCode: 'B5', nodeVersion: 2, title: 'Площадка обслуживания Ø3000', enabled: true, enabledCalc: true })
    // π × 3000/1000 + высота станции (11,6 + 0,2)
    expect(c.rows[0]!.qtyCalc).toBeCloseTo(Math.PI * 3 + 11.8, 9)
    expect(c.rows[0]!.priceCatalog).toBe(950)
    expect(c.rows[1]!.name).toBe('Монтаж площадки ПО-1')
    expect(c.rows[1]!.qtyCalc).toBe(3)
  })

  it('поле ОЛ «нет» делает узел призраком; своё название экземпляра', () => {
    const t = withPlatform({ d: 'dn', on: 'hasGrinder' }, 'Площадка над люком {mark}')
    const c = materializeKns(withTemplate(t), SAMPLE_SURVEYS.KNS).sections[2]!.components.slice(-1)[0]!
    expect(c.title).toBe('Площадка над люком ПО-1')
    expect(c.enabled).toBe(false)
  })

  it('узел каталога, которого нет среди опубликованных, пропускается', () => {
    const t = withPlatform({ d: 'dn' })
    const ctx = { ...withTemplate(t), catalogNodeOf: () => null }
    const tree = materializeKns(ctx, SAMPLE_SURVEYS.KNS)
    expect(tree.sections[2]!.components.some((c) => c.nodeCode === 'B5')).toBe(false)
  })

  it('bindParams: число — формула, логика — не 0, текст — поле ОЛ или сам текст, пусто и ошибка — умолчание', () => {
    const scope = surveyScope({ device: 'KNS', survey: SAMPLE_SURVEYS.KNS })
    expect(bindParams(PLATFORM, { d: 'dn / 2', on: 'pumps > 5', mark: 'pumpModel' }, scope)).toEqual({ d: 1500, on: false, mark: '' })
    expect(bindParams(PLATFORM, { mark: 'ПО-7', d: '', h: 'нетТакого + 1' }, scope)).toEqual({ mark: 'ПО-7' })
  })

  it('проверка биндингов: неизвестный параметр узла и неизвестное поле ОЛ', () => {
    const t = withPlatform({ d: 'dnn', zz: '1' })
    const issues = validateTemplate('KNS', t.body, (c) => CATALOG[c] ?? null)
    expect(issues.filter((i) => !i.warn).map((i) => i.message)).toEqual([
      expect.stringMatching(/DN корпуса: Неизвестное имя «dnn»/),
      expect.stringMatching(/нет параметра «zz»/),
    ])
  })

  it('проверка: неопубликованный узел, чужой встроенный, повтор встроенного, повтор названия раздела', () => {
    const body = structuredClone(BUILTIN_TEMPLATES.KNS)
    body.sections[0]!.nodes.push({ kind: 'catalog', code: 'B9', bindings: {} }, { kind: 'builtin', ref: 'emk.shaft' }, { kind: 'builtin', ref: 'kns.bottom' })
    body.sections[1]!.title = 'корпус'
    const msgs = validateTemplate('KNS', body, () => null).filter((i) => !i.warn).map((i) => i.message)
    expect(msgs).toEqual([
      expect.stringMatching(/B9 не опубликован/),
      expect.stringMatching(/«emk\.shaft» у этого изделия нет/),
      expect.stringMatching(/«Днище» уже стоит/),
      expect.stringMatching(/Раздел «корпус» повторяется/),
    ])
  })

  it('два экземпляра с одним названием в разделе — предупреждение о пересборке', () => {
    const t = withPlatform({ d: 'dn' })
    t.body.sections[2]!.nodes.push({ kind: 'catalog', code: 'B5', bindings: { d: 'dn' } })
    const warns = validateTemplate('KNS', t.body, (c) => CATALOG[c] ?? null).filter((i) => i.warn)
    expect(warns.map((w) => w.message)).toEqual([expect.stringMatching(/задайте экземпляру своё название/)])
    expect(templateCatalogCodes(t.body)).toEqual(['B5'])
  })
})

describe('поля ОЛ для биндингов', () => {
  it('производные поля КНС: высота станции, длина трубы, установленные насосы', () => {
    const scope = surveyScope({ device: 'KNS', survey: SAMPLE_SURVEYS.KNS })
    expect(scope).toMatchObject({ heightM: 11.8, lengthM: 11.6, pumps: 3, pipeParts: false, dn: 3000 })
  })

  it('у ЕМК и колодца пустые «Лестница» и «Вентиляция» — «да», как строятся узлы', () => {
    const emk = surveyScope({ device: 'EMK', survey: { ...SAMPLE_SURVEYS.EMK, hasLadder: undefined, ventilation: undefined } })
    expect(emk).toMatchObject({ hasLadder: true, ventilation: true, horizontal: false })
    const kol = surveyScope({ device: 'KOL', survey: { ...SAMPLE_SURVEYS.KOL, hasLadder: undefined } })
    expect(kol).toMatchObject({ hasLadder: true, totalDepthMm: 3500 })
  })

  it.each(['KNS', 'EMK', 'KOL'] as DeviceType[])('%s: ключи уникальны, вводимые поля есть в примере ОЛ', (device) => {
    const fields = surveyFieldsOf(device)
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length)
    const sample = SAMPLE_SURVEYS[device] as unknown as Record<string, unknown>
    for (const f of fields.filter((x) => x.input)) {
      if (!['elevationMm', 'sn', 'pipeLengthMm', 'shaftDiameterMm', 'shaftHeightMm', 'pumpModel', 'hasLadder', 'ventilation'].includes(f.key)) {
        expect(sample, `${device}.${f.key}`).toHaveProperty(f.key)
      }
    }
  })

  it('встроенный шаблон через интерпретатор и builtinTemplate — одно и то же дерево', () => {
    const a = materializeTemplate(baseCtx, { device: 'KOL', survey: SAMPLE_SURVEYS.KOL }, builtinTemplate('KOL'))
    __resetIds()
    const b = materializeKol(baseCtx, SAMPLE_SURVEYS.KOL)
    expect(b).toEqual(a)
  })
})
