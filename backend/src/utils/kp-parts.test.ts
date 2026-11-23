/**
 * Составное изделие в КП (образец «КП (2).xlsx», поз. 1.4 — ДНС): подпозиции
 * и раскладка цены изделия по ним. Главное, что держат тесты: сумма
 * подпозиций равна цене изделия до копейки, а «Общая сумма» не складывает
 * подпозиции второй раз.
 */
import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { buildKpDocument, tableLines } from './kp-document'
import { buildParts, groupOfKitItem, groupOfRow, groupSales } from './kp-parts'
import { renderKpXlsxWorkbook } from './kp-xlsx'

type Row = Record<string, unknown>
const row = (name: string, qty: number, price: number, extra: Row = {}): Row => ({
  id: name, kind: 'МАТЕРИАЛ', name, unit: 'шт', qtyResolved: qty, priceCatalog: price, ...extra,
})

/** Дерево ДНС в разрезе узлов шаблона КНС; наценка 0,5 — k = 1,5. */
function dns(over: { markup?: number; tirage?: number; pumpK?: number } = {}) {
  const comp = (title: string, rows: Row[]) => ({ id: title, title, enabled: true, rows })
  return {
    totals: { markup: over.markup ?? 0.5, tirage: over.tirage ?? 1 },
    tree: {
      sections: [
        {
          code: '1', title: 'Корпус', enabled: true,
          components: [
            comp('Обечайка корпуса', [row('Труба СК/НПС-К 2600', 10, 10_000)]),
            // Патрубок с «напорный» в названии — всё равно корпус.
            comp('Патрубок напорный DN150 ×2', [row('Формовка гильз', 1, 1_000)]),
            comp('Корзина сороудерживающая', [row('Лист перфорированный', 1, 2_000)]),
          ],
        },
        { code: '2', title: 'Лестница', enabled: true, components: [comp('Лестница нержавеющая', [row('Уголок', 1, 1_000)])] },
        { code: '4', title: 'Вентиляционный стояк', enabled: true, components: [comp('Вентиляционный стояк ПЭ Ду110', [row('Дефлектор ПВХ Ду110', 1, 600)])] },
        { code: '5', title: 'Напорный трубопровод', enabled: true, components: [comp('Нитка напорного трубопровода DN150 ×2', [row('Фланец', 2, 1_000)])] },
        {
          code: '7', title: 'Оборудование и запорная арматура', enabled: true,
          components: [
            comp('Узел запорной арматуры', [row('Задвижка клиновая DN150', 2, 1_000)]),
            comp('Насосная группа', [
              row('Насос Vandjord VSL.150', 2, 10_000, { category: 'Насосы, АТМ', ...(over.pumpK ? { markupK: over.pumpK } : {}) }),
              row('Автоматическая трубная муфта', 2, 500, { category: 'Насосы, АТМ' }),
              row('ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ КАБЕЛЬ 20 М', 4, 100, { category: 'Выключатели' }),
            ]),
            comp('Датчик уровня', [row('Погружной датчик уровня (гидростатического давления)', 1, 2_000)]),
            comp('Шкаф управления', [row('Шкаф управления насосами', 1, 5_000)]),
            comp('Оборудование для обслуживания', [
              row('Тренога перегрузочная ТП-1000', 1, 1_000),
              row('Таль ручная цепная ТРШС 0,5т', 1, 1_000),
              row('Переносной газоанализатор', 1, 3_000),
            ]),
          ],
        },
      ],
    },
  }
}

const kit = [
  { name: 'Стеклокомпозитный корпус «НТТ» GRP, D=2 600 мм', qty: 1, unit: 'шт.' },
  { name: 'Лестница из нержавеющей стали', qty: 1, unit: 'шт.' },
  { name: 'Гильза из стеклокомпозита для напорного патрубка DN 150', qty: 2, unit: 'шт.' },
  { name: 'Система вентиляции с дефлектором ПВХ Ø110 мм', qty: 1, unit: 'шт.' },
  { name: 'Корзина сороулавливающая из нержавеющей стали с цепью', qty: 1, unit: 'компл.' },
  { name: 'Напорный трубопровод DN 150 из нержавеющей стали', qty: 1, unit: 'компл.' },
  { name: 'Насос погружной Vandjord VSL.150', qty: 2, unit: 'шт.' },
  { name: 'Автоматическая трубная муфта DN 150', qty: 2, unit: 'шт.' },
  { name: 'Поплавковый выключатель', qty: 4, unit: 'шт.' },
  { name: 'Погружной датчик уровня (гидростатического давления)', qty: 1, unit: 'шт.' },
  { name: 'Шкаф управления уличного исполнения', qty: 1, unit: 'компл.' },
  { name: 'Грузоподъемное устройство (тренога + таль ручная цепная)', qty: 1, unit: 'компл.' },
  { name: 'Переносной газоанализатор', qty: 1, unit: 'шт.' },
  { name: 'Комплект крепления к бетонному основанию', qty: 1, unit: 'компл.' },
]

const TOTAL = 300_000

describe('группы строк расчёта', () => {
  it('насосная группа делится по строкам, обслуживание — на подъёмник и газоанализатор', () => {
    const g = groupSales(dns())!
    expect(g.get('pumps')).toBeCloseTo(2 * 10_000 * 1.5)
    expect(g.get('coupling')).toBeCloseTo(2 * 500 * 1.5)
    expect(g.get('floats')).toBeCloseTo(4 * 100 * 1.5)
    expect(g.get('lift')).toBeCloseTo(2_000 * 1.5)
    expect(g.get('gas')).toBeCloseTo(3_000 * 1.5)
    // Корпус: обечайка + патрубок + лестница.
    expect(g.get('shell')).toBeCloseTo((100_000 + 1_000 + 1_000) * 1.5)
  })

  it('патрубок «напорный» — корпус, датчик уровня «гидростатического давления» — уровень', () => {
    expect(groupOfRow({ name: 'x' }, 'Патрубок напорный DN150 ×2', 'Корпус')).toBe('shell')
    expect(groupOfRow({ name: 'x' }, 'Датчик уровня', '')).toBe('level')
    expect(groupOfKitItem('Погружной датчик уровня (гидростатического давления)')).toBe('level')
    expect(groupOfKitItem('Датчик давления')).toBe('pressure')
  })

  it('«сталь» и «деталь» не принимаются за таль', () => {
    expect(groupOfKitItem('Лестница из нерж. сталь')).toBe('shell')
    expect(groupOfRow({ name: 'Деталь крепления' }, 'Обечайка', 'Корпус')).toBe('shell')
    expect(groupOfKitItem('Таль ручная цепная')).toBe('lift')
  })

  it('коэффициент наценки строки (markupK) переходит в цену подпозиции', () => {
    expect(groupSales(dns({ pumpK: 1.05 }))!.get('pumps')).toBeCloseTo(2 * 10_000 * 1.05)
  })

  it('без дерева или с неопределённым количеством раскладки нет', () => {
    expect(groupSales({})).toBeNull()
    const bad = dns()
    ;(bad.tree.sections[0]!.components[0]!.rows[0] as Row).qtyResolved = undefined
    ;(bad.tree.sections[0]!.components[0]!.rows[0] as Row).qtyManual = '2*3'
    expect(groupSales(bad)).toBeNull()
    expect(buildParts('1.1', bad, kit, TOTAL, 1)).toBeNull()
  })
})

describe('подпозиции', () => {
  const parts = buildParts('1.4', dns(), kit, TOTAL, 1)!

  it('сумма подпозиций = цена изделия, корпус первым и с остатком', () => {
    expect(parts.reduce((s, p) => s + p.totalRub, 0)).toBeCloseTo(TOTAL, 2)
    expect(parts[0]!.key).toBe('shell')
    expect(parts[0]!.number).toBe('1.4.1')
    expect(parts.map((p) => p.number).at(-1)).toBe(`1.4.${parts.length}`)
    for (const p of parts.slice(1)) expect(p.totalRub).toBe(p.priceRub * p.qty)
  })

  it('порядок как в образце ДНС: корпус, корзина, вентиляция, трубопровод, подъёмник, муфты, насосы, поплавки, датчик, шкаф', () => {
    expect(parts.map((p) => p.key)).toEqual(['shell', 'basket', 'vent', 'pipeline', 'lift', 'coupling', 'pumps', 'floats', 'level', 'cabinet', 'gas'])
  })

  it('корпус — «- 1 шт.;» и комплект списком; узлы без своей группы — в нём', () => {
    const shell = parts[0]!.description.split('\n')
    expect(shell[0]).toBe('Стеклокомпозитный корпус «НТТ» GRP, D=2 600 мм - 1 шт.;')
    expect(shell).toContain('- Лестница из нержавеющей стали - 1 шт.;')
    expect(shell).toContain('- Комплект крепления к бетонному основанию - 1 компл.;')
    expect(parts[0]!.unit).toBe('компл.')
  })

  it('количество и единица подпозиции — из комплектации, цена — за единицу', () => {
    const pumps = parts.find((p) => p.key === 'pumps')!
    expect(pumps.qty).toBe(2)
    expect(pumps.unit).toBe('шт.')
    expect(pumps.priceRub).toBe(15_000)
  })

  it('узел убран из комплектации — его стоимость уходит в корпус, цена изделия та же', () => {
    const noGas = kit.filter((i) => !i.name.includes('газоанализатор'))
    const p = buildParts('1.1', dns(), noGas, TOTAL, 1)!
    expect(p.some((x) => x.key === 'gas')).toBe(false)
    expect(p.reduce((s, x) => s + x.totalRub, 0)).toBeCloseTo(TOTAL, 2)
    expect(p[0]!.totalRub).toBeCloseTo(parts[0]!.totalRub + 4_500, 2)
  })

  it('узел в комплектации без стоимости в расчёте — строкой в комплект корпуса', () => {
    const extra = [...kit, { name: 'Расходомер', qty: 1, unit: 'шт.' }]
    const p = buildParts('1.1', dns(), extra, TOTAL, 1)!
    expect(p.some((x) => x.key === 'flow')).toBe(false)
    expect(p[0]!.description).toContain('- Расходомер - 1 шт.;')
  })

  it('остатка на корпус нет — цена делится пропорционально и всё равно сходится', () => {
    const p = buildParts('1.1', dns(), kit, 100_000, 1)!
    expect(p.reduce((s, x) => s + x.totalRub, 0)).toBeCloseTo(100_000, 2)
    expect(p[0]!.totalRub).toBeGreaterThan(0)
  })

  it('тираж: корпус — по одному на изделие', () => {
    const p = buildParts('1.1', dns({ tirage: 2 }), kit, 2 * TOTAL, 2)!
    expect(p[0]!.qty).toBe(2)
    expect(p.reduce((s, x) => s + x.totalRub, 0)).toBeCloseTo(2 * TOTAL, 2)
  })
})

describe('КП с составным изделием', () => {
  const doc = buildKpDocument({
    estimateId: 'e1',
    estimateTitle: 'ДНС',
    deviceType: 'KNS',
    kp: { kit },
    project: { title: 'Объект', customer: 'ООО Заказчик', address: null },
    snapshot: { version: 1, priceListVersion: 1, totalRub: TOTAL, createdAt: new Date('2026-11-23T10:00:00Z'), bundlesJson: dns() },
  })

  it('шапка изделия без «В комплекте», под ней подпозиции 1.1.M', () => {
    const lines = tableLines(doc)
    expect(lines[0]!.number).toBe('1.1')
    expect(lines[0]!.composite).toBe(true)
    expect(lines[0]!.description).not.toContain('В комплекте')
    expect(lines[1]!.number).toBe('1.1.1')
    expect(lines.slice(1).every((l) => l.part)).toBe(true)
  })

  it('общая сумма — по изделию, подпозиции второй раз не входят', () => {
    expect(doc.totalRub).toBe(TOTAL)
  })

  it('xlsx: сумма шапки — СУММ подпозиций, общая — по шапкам', () => {
    const ws = renderKpXlsxWorkbook(doc).getWorksheet('КП')!
    let head: ExcelJS.Row | null = null
    let total: ExcelJS.CellFormulaValue | null = null
    ws.eachRow((r) => {
      if (r.getCell(2).value === '1.1') head = r
      if (r.getCell(2).value === 'Общая сумма:') total = r.getCell(7).value as ExcelJS.CellFormulaValue
    })
    const headSum = head!.getCell(7).value as ExcelJS.CellFormulaValue
    expect(headSum.formula).toMatch(/^SUM\(G\d+:G\d+\)$/)
    expect(headSum.result).toBe(TOTAL)
    expect(total!.formula).toBe(`SUM(G${head!.number})`)
    expect(total!.result).toBe(TOTAL)
  })
})
