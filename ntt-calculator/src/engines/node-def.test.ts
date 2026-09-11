import { beforeEach, describe, expect, it } from 'vitest'
import { recalcFotSatellites } from './fot'
import {
  blankNodeDef,
  defaultParams,
  hasBlockingIssues,
  materializeNode,
  validateNodeDef,
  type NodeDefBody,
} from './node-def'
import { RESERVED_NODE_CODES } from './code-nodes'
import { __resetIds, buildLadder, LADDER_ITEMS, type MaterializeContext } from './template-kns'

const PRICES: Record<string, number> = {
  'Металлопрокат|Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93|м': 950,
  'Металлопрокат|Труба 25х2 мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81|м': 610,
  'Собственное производство|Изготовление Лестницы|чел. ч': 1207.8,
  'Собственное производство|Монтаж Лестницы|чел. ч': 1207.8,
  'Собственное производство|Ручная формовка настила|кг': 310.2,
  'ФОТ|ФОТ|чел. ч': 1207.8,
}

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICES[`${c}|${n}|${u}`] ?? null,
  pipeWeightOf: () => null,
  priceListVersion: 4,
}

beforeEach(() => __resetIds())

/**
 * Площадка обслуживания — узел, которого нет среди встроенных (Библиотека B5○):
 * технолог собирает его из функций реестра без релиза.
 */
const PLATFORM: NodeDefBody = {
  code: 'B5',
  name: 'Площадка обслуживания Ø{d}',
  tag: 'конструкции обслуживания',
  description: 'Настил и ограждение над горловиной',
  params: [
    { key: 'd', label: 'DN корпуса', type: 'number', unit: 'мм', default: 2000 },
    { key: 'h', label: 'Высота ограждения', type: 'number', unit: 'м', default: 1.1 },
    { key: 'railing', label: 'С ограждением', type: 'bool', default: true },
    { key: 'on', label: 'Площадка нужна', type: 'bool', default: true },
  ],
  enabledBy: 'on',
  rows: [
    { kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', unit: 'м', qty: 'ОКРВВЕРХ(ПИ() * d / 1000 * 2 + h * 4; 1)', when: 'railing', note: 'ограждение по периметру' },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Ручная формовка настила', unit: 'кг', qty: 'd / 1000 * d / 1000 * 0,785 * 12', fotK: 1 },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Монтаж площадки Ø{d}', unit: 'чел. ч', qty: '' },
  ],
}

describe('узел каталога: проверка', () => {
  it('годный узел — без ошибок; пустое количество — лишь предупреждение', () => {
    const issues = validateNodeDef(PLATFORM, { reservedCodes: RESERVED_NODE_CODES })
    expect(hasBlockingIssues(issues)).toBe(false)
    expect(issues).toEqual([{ path: 'rows[2].qty', message: expect.stringMatching(/введут в расчёте/), warn: true }])
  })

  it('коды встроенных узлов заняты', () => {
    const issues = validateNodeDef({ ...PLATFORM, code: 'B1' }, { reservedCodes: RESERVED_NODE_CODES })
    expect(issues.find((i) => i.path === 'code')?.message).toMatch(/занят встроенным узлом/)
    expect(RESERVED_NODE_CODES.has('A10')).toBe(true)
    expect(RESERVED_NODE_CODES.has('B5')).toBe(false)
  })

  it('имена параметров: формат, повтор, совпадение с функцией', () => {
    const bad: NodeDefBody = {
      ...PLATFORM,
      params: [
        { key: '1d', label: 'x', type: 'number' },
        { key: 'h', label: 'x', type: 'number' },
        { key: 'h', label: 'x', type: 'number' },
        { key: 'МАКС', label: 'x', type: 'number' },
        { key: 'ok', label: '', type: 'number', default: 'текст' },
      ],
    }
    const msgs = validateNodeDef(bad).map((i) => `${i.path}: ${i.message}`)
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^params\[0\]\.key: Имя «1d»/),
      expect.stringMatching(/^params\[2\]\.key: Параметр «h» повторяется/),
      expect.stringMatching(/^params\[3\]\.key: Имя «МАКС» занято функцией/),
      expect.stringMatching(/^params\[4\]\.label/),
      expect.stringMatching(/^params\[4\]\.default/),
    ]))
  })

  it('ФОТ: у операции в кг коэффициент обязателен, у остальных запрещён; строки ФОТ не заводятся', () => {
    const rows: NodeDefBody['rows'] = [
      { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Формовка', unit: 'кг', qty: '1' },
      { kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Болт', unit: 'шт', qty: '1', fotK: 0.28 },
      { kind: 'МАТЕРИАЛ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', qty: '1' },
    ]
    const paths = validateNodeDef({ ...PLATFORM, rows }).map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['rows[0].fotK', 'rows[1].fotK', 'rows[2].category']))
  })

  it('формулы, условия и шаблоны наименований проверяются по параметрам узла', () => {
    const rows: NodeDefBody['rows'] = [
      { kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Болт М{m}', unit: 'шт', qty: 'n * 4', when: 'flag' },
    ]
    const msgs = validateNodeDef({ ...PLATFORM, rows, enabledBy: 'x > 1' }).map((i) => `${i.path}: ${i.message}`)
    expect(msgs).toEqual(expect.arrayContaining([
      expect.stringMatching(/^enabledBy: Неизвестное имя «x»/),
      expect.stringMatching(/^rows\[0\]\.name: .*«m»/),
      expect.stringMatching(/^rows\[0\]\.qty: Неизвестное имя «n»/),
      expect.stringMatching(/^rows\[0\]\.when: Неизвестное имя «flag»/),
    ]))
  })

  it('заготовка нового узла — рабочая после заполнения кода и названия', () => {
    const b = { ...blankNodeDef('C7'), name: 'Прочее', rows: [{ kind: 'МАТЕРИАЛ' as const, category: 'Метизы' as const, name: 'Болт', unit: 'шт', qty: '2' }] }
    expect(hasBlockingIssues(validateNodeDef(b))).toBe(false)
  })
})

describe('узел каталога: материализация', () => {
  it('строки считаются формулами от параметров, цены — из прайса по наименованию', () => {
    const c = materializeNode(ctx, { body: PLATFORM, version: 3 }, { d: 3000, h: 1.2 })
    expect(c.title).toBe('Площадка обслуживания Ø3000')
    expect(c.nodeCode).toBe('B5')
    expect(c.nodeVersion).toBe(3)

    const angle = c.rows[0]!
    expect(angle.qtyCalc).toBe(Math.ceil((Math.PI * 3 * 2 + 1.2 * 4) * 10) / 10)
    expect(angle.priceCatalog).toBe(950)
    expect(angle.note).toMatch(/^ограждение по периметру · ƒ ОКРВВЕРХ\(ПИ\(\) × 3000 \/ 1000 × 2 \+ 1,2 × 4; 1\) = /)
  })

  it('операция в кг получает ФОТ-спутник с коэффициентом узла', () => {
    const c = materializeNode(ctx, { body: PLATFORM }, { d: 2000 })
    const op = c.rows.find((r) => r.name === 'Ручная формовка настила')!
    const fot = c.rows.find((r) => r.parentId === op.id)!
    expect(op.kind).toBe('ОПЕРАЦИЯ')
    expect(op.qtyCalc).toBeCloseTo(2 * 2 * 0.785 * 12, 9)
    expect(fot).toMatchObject({ kind: 'ФОТ', category: 'ФОТ', fotK: 1, priceCatalog: 1207.8 })
    const settled = recalcFotSatellites(c.rows)
    expect(settled.find((r) => r.id === fot.id)!.qtyCalc).toBe(Math.ceil(2 * 2 * 0.785 * 12 * 10) / 10)
  })

  it('пустое количество рождается пустым — его вводят в расчёте; вставка в наименовании берёт параметр', () => {
    const c = materializeNode(ctx, { body: PLATFORM }, {})
    const mount = c.rows.find((r) => r.name.startsWith('Монтаж площадки'))!
    expect(mount.name).toBe('Монтаж площадки Ø2000')
    expect(mount.qtyCalc).toBeNull()
    expect(mount.note).toBe('количество вводится в расчёте')
    expect(mount.priceCatalog).toBeNull()
  })

  it('условие строки убирает её, условие узла делает его «призраком»', () => {
    const noRailing = materializeNode(ctx, { body: PLATFORM }, { railing: false })
    expect(noRailing.rows.some((r) => r.name.startsWith('Уголок'))).toBe(false)

    const off = materializeNode(ctx, { body: PLATFORM }, { on: false })
    expect(off.enabled).toBe(false)
    expect(off.enabledCalc).toBe(false)
    expect(off.rows.length).toBeGreaterThan(0)

    const always = materializeNode(ctx, { body: { ...PLATFORM, enabledBy: '' } }, { on: false })
    expect(always.enabled).toBe(true)
    expect(always.enabledCalc).toBeUndefined()
  })

  it('нет значения параметра — количество пустое, в примечании сказано почему', () => {
    const body: NodeDefBody = { ...PLATFORM, params: [{ key: 'd', label: 'DN', type: 'number' }], enabledBy: '', rows: [PLATFORM.rows[1]!] }
    const c = materializeNode(ctx, { body }, {})
    expect(c.title).toBe('Площадка обслуживания Ø?')
    expect(c.rows[0]!.qtyCalc).toBeNull()
    expect(c.rows[0]!.note).toMatch(/нет значения: введите вручную/)
  })

  it('ошибка формулы не роняет материализацию: строка пустая, ошибка — в примечании', () => {
    const body: NodeDefBody = { ...PLATFORM, enabledBy: '', rows: [{ ...PLATFORM.rows[1]!, qty: 'd / (h - h)' }] }
    const c = materializeNode(ctx, { body }, {})
    expect(c.rows[0]!.qtyCalc).toBeNull()
    expect(c.rows[0]!.note).toMatch(/⚠ формула .*Деление на ноль/)
  })

  it('умолчания параметров', () => {
    expect(defaultParams(PLATFORM)).toEqual({ d: 2000, h: 1.1, railing: true, on: true })
    expect(defaultParams({ params: [{ key: 'x', label: 'x', type: 'number' }, { key: 't', label: 't', type: 'text' }] })).toEqual({ x: null, t: '' })
  })

  it('узел из функций реестра считает так же, как встроенный: лестница B1', () => {
    const LADDER: NodeDefBody = {
      code: 'B1x',
      name: 'Лестница нержавеющая',
      tag: 'конструкции обслуживания',
      params: [{ key: 'h', label: 'Высота', type: 'number', unit: 'м' }],
      rows: [
        { kind: 'МАТЕРИАЛ', ...LADDER_ITEMS.stringer, qty: 'ladderMaterialM(h)' },
        { kind: 'МАТЕРИАЛ', ...LADDER_ITEMS.rungs, qty: 'ladderRungPipeM(h)' },
        { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Изготовление Лестницы', unit: 'чел. ч', qty: 'ladderHours(h)' },
        { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Монтаж Лестницы', unit: 'чел. ч', qty: 'ladderHours(h) / 2' },
      ],
    }
    const own = materializeNode(ctx, { body: LADDER }, { h: 11.6 })
    const builtin = buildLadder(ctx, { depthMm: 11600, device: 'KNS' })[0]!
    const pick = (rows: typeof own.rows) => rows.map((r) => [r.kind, r.category, r.name, r.unit, r.qtyCalc, r.priceCatalog])
    expect(pick(own.rows)).toEqual(pick(builtin.rows))
  })
})
