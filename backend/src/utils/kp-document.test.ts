/**
 * Модель печатной формы КП: что попадает в документ заказчику, а что нет.
 *
 * Главное, что держат эти тесты, — два решения из шапки `kp-document.ts`:
 * цены строк (они же себестоимость) в документ не попадают, а НДС выделяется
 * из цены, а не начисляется сверху.
 */
import { describe, expect, it } from 'vitest'
import { extractSpecification, isFotRow, isRowWithoutPrice, isWorkRow, resolveRowQty, tirageOf } from './estimate-tree'
import {
  buildKpDocument,
  buildProjectKpDocument,
  formatMoney,
  formatQty,
  KpSpecificationIncomplete,
  NBSP,
  vatIncludedIn,
  VAT_RATE_PCT,
} from './kp-document'

/** Дерево расчёта в форме, в которой его снимает снапшот. */
function tree() {
  return {
    tree: {
      deviceType: 'KNS',
      priceListVersion: 3,
      survey: {},
      sections: [
        {
          id: 's1',
          code: '1',
          title: 'Корпус',
          enabled: true,
          components: [
            {
              id: 'c1',
              title: 'Обечайка',
              enabled: true,
              rows: [
                { id: 'r1', name: 'Труба СК/НПС-К 3000-0,1-10000', unit: 'м', qtyCalc: 12.5, priceCatalog: 48000 },
                { id: 'r2', name: 'Выключённая строка', unit: 'шт', qtyCalc: 3, enabled: false },
                { id: 'r3', name: 'Нулевое количество', unit: 'шт', qtyCalc: 0 },
                // Спутник операции: в документ заказчику не идёт.
                { id: 'r7', kind: 'ФОТ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', qtyCalc: 112, priceCatalog: 1207.8 },
              ],
            },
            {
              id: 'c2',
              title: 'Выключённый компонент',
              enabled: false,
              rows: [{ id: 'r4', name: 'Не должно попасть', unit: 'шт', qtyCalc: 5 }],
            },
          ],
        },
        {
          id: 's2',
          code: '2',
          title: 'Выключённый раздел',
          enabled: false,
          components: [
            { id: 'c3', title: 'X', enabled: true, rows: [{ id: 'r5', name: 'Тоже не должно', unit: 'шт', qtyCalc: 1 }] },
          ],
        },
        {
          id: 's3',
          code: '7',
          title: 'Оборудование',
          enabled: true,
          components: [
            {
              id: 'c4',
              title: 'Насосная группа',
              enabled: true,
              rows: [
                // Ручное количество перебивает расчётное.
                { id: 'r6', name: 'Насос', unit: 'шт', qtyCalc: 2, qtyManual: '3' },
              ],
            },
          ],
        },
      ],
    },
  }
}

function input(over: Record<string, unknown> = {}) {
  return {
    estimateId: '1a2b3c4d-0000-0000-0000-000000000000',
    estimateTitle: 'КНС DN3000',
    deviceType: 'KNS',
    project: { title: 'Объект «Северный»', customer: 'ООО «Заказчик»', address: 'г. Москва' },
    snapshot: {
      version: 2,
      priceListVersion: 3,
      totalRub: 1_200_000,
      createdAt: new Date('2026-09-08T10:00:00Z'),
      bundlesJson: tree(),
    },
    ...over,
  }
}

describe('extractSpecification', () => {
  it('берёт только включённые разделы, компоненты и строки с ненулевым количеством', () => {
    const spec = extractSpecification(tree())

    expect(spec.sections.map((s) => s.code)).toEqual(['1', '7'])
    expect(spec.sections[0]?.rows.map((r) => r.name)).toEqual(['Труба СК/НПС-К 3000-0,1-10000'])
  })

  it('предпочитает ручное количество расчётному', () => {
    const spec = extractSpecification(tree())

    expect(spec.sections[1]?.rows[0]).toMatchObject({ name: 'Насос', unit: 'шт', qty: 3 })
  })

  it('не печатает ФОТ — это спутник операции, а не позиция изделия', () => {
    const spec = extractSpecification(tree())

    const names = spec.sections.flatMap((s) => s.rows.map((r) => r.name))
    expect(names).not.toContain('ФОТ')
    // Сама операция при этом остаётся: убран спутник, а не работа.
    expect(names).toContain('Труба СК/НПС-К 3000-0,1-10000')
  })

  it('не печатает работы: заказчик покупает изделие, а не трудозатраты', () => {
    const t = {
      tree: {
        sections: [
          {
            code: '1', title: 'Корпус', enabled: true,
            components: [{
              title: 'c', enabled: true,
              rows: [
                { kind: 'МАТЕРИАЛ', name: 'Труба СК/НПС-К 3000-0,1-12000', unit: 'м', qtyCalc: 11.6 },
                { kind: 'ОПЕРАЦИЯ', name: 'Ламинирование частей корпуса', unit: 'кг', qtyCalc: 112 },
                { kind: 'ОПЕРАЦИЯ', name: 'Прорезка отверстия под гильзу', unit: 'чел. ч', qtyCalc: 0.7 },
                { kind: 'ФОТ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', qtyCalc: 112 },
              ],
            }],
          },
        ],
      },
    }

    const names = extractSpecification(t).sections.flatMap((s) => s.rows.map((r) => r.name))
    expect(names).toEqual(['Труба СК/НПС-К 3000-0,1-12000'])
  })

  it('работа опознаётся по kind, а без него — по ЕИ «чел. ч»', () => {
    expect(isWorkRow({ kind: 'ОПЕРАЦИЯ', name: 'Монтаж Лестницы', unit: 'чел. ч' })).toBe(true)
    expect(isWorkRow({ kind: 'ОПЕРАЦИЯ', name: 'Механическое формованное дно', unit: 'кг' })).toBe(true)
    expect(isWorkRow({ kind: 'ФОТ', name: 'ФОТ', unit: 'чел. ч' })).toBe(true)
    expect(isWorkRow({ kind: 'МАТЕРИАЛ', name: 'Насос', unit: 'шт' })).toBe(false)
    // Без kind: часы — труд, всё остальное считаем закупкой, чтобы не выкинуть
    // из документа материал, у которого ЕИ совпала с формовочной.
    expect(isWorkRow({ name: 'Прорезка отверстия', unit: 'чел. ч' })).toBe(true)
    expect(isWorkRow({ name: 'Труба ПЭ 100 SDR17', unit: 'м' })).toBe(false)
  })

  it('ФОТ узнаётся и по kind, и по категории — у старых снапшотов kind нет', () => {
    expect(isFotRow({ kind: 'ФОТ', name: 'ФОТ' })).toBe(true)
    expect(isFotRow({ category: 'ФОТ', name: 'ФОТ' })).toBe(true)
    expect(isFotRow({ kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Монтаж Лестницы' })).toBe(false)
  })

  it('неразобранное количество у ФОТ печать не блокирует', () => {
    const t = {
      tree: {
        sections: [
          {
            code: '1', title: 'Корпус', enabled: true,
            components: [{
              title: 'c', enabled: true,
              rows: [
                { name: 'Труба', unit: 'м', qtyCalc: 2 },
                { kind: 'ФОТ', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', qtyManual: '2*3' },
              ],
            }],
          },
        ],
      },
    }

    // Строки в документе нет — значит и выдумывать в ней нечего.
    expect(extractSpecification(t).unresolved).toEqual([])
  })

  it('на мусоре не падает, а отдаёт пустую спецификацию', () => {
    expect(extractSpecification(null).sections).toEqual([])
    expect(extractSpecification({}).sections).toEqual([])
    expect(extractSpecification({ tree: { sections: 'не массив' } }).sections).toEqual([])
  })
})

describe('количество строки: выражение вместо числа', () => {
  // Дефект: qtyManual хранит ВЫРАЖЕНИЕ («1,55*2+2,88*2»), его разбирает движок
  // фронта. Бэкенд читал это через Number(), получал NaN и делал вывод «нет
  // количества» — строка без цены переставала блокировать выпуск КП и молча
  // исчезала из спецификации.
  const expr = { name: 'Кран шаровой DN150', unit: 'шт', qtyCalc: 4, qtyManual: '1,55*2+2,88*2' }

  it('простое число в qtyManual читается как раньше', () => {
    expect(resolveRowQty({ qtyManual: '3', qtyCalc: 9 })).toEqual({ qty: 3, unresolved: false })
    expect(resolveRowQty({ qtyManual: '2,5', qtyCalc: 9 })).toEqual({ qty: 2.5, unresolved: false })
  })

  it('выражение без сохранённого результата помечается неопределённым, а не нулевым', () => {
    expect(resolveRowQty(expr)).toEqual({ qty: null, unresolved: true })
  })

  it('qtyResolved от фронта закрывает вопрос', () => {
    expect(resolveRowQty({ ...expr, qtyResolved: 8.86 })).toEqual({ qty: 8.86, unresolved: false })
  })

  it('пустой qtyManual не мешает расчётному значению', () => {
    expect(resolveRowQty({ qtyManual: '', qtyCalc: 7 })).toEqual({ qty: 7, unresolved: false })
    expect(resolveRowQty({ qtyManual: null, qtyCalc: 7 })).toEqual({ qty: 7, unresolved: false })
  })

  it('строка с выражением и БЕЗ цены блокирует выпуск КП', () => {
    // Ровно то, ради чего гейт и сделан: раньше здесь возвращалось false.
    expect(isRowWithoutPrice({ ...expr, priceCatalog: null, priceManual: null })).toBe(true)
  })

  it('строка с выражением и с ценой выпуск не блокирует', () => {
    expect(isRowWithoutPrice({ ...expr, priceCatalog: 6000 })).toBe(false)
  })

  it('спецификация не выбрасывает такую строку молча, а называет её', () => {
    const t = {
      tree: {
        sections: [
          {
            code: '7', title: 'Оборудование', enabled: true,
            components: [{ title: 'c', enabled: true, rows: [expr] }],
          },
        ],
      },
    }
    const spec = extractSpecification(t)

    expect(spec.sections).toEqual([])
    expect(spec.unresolved).toEqual([{ name: 'Кран шаровой DN150', unit: 'шт', section: 'Оборудование' }])
  })
})

describe('тираж', () => {
  // Дефект: количества печатались за одно изделие, а цена приходила из
  // снапшота за весь тираж — состав и сумма относились к разным вещам.
  const withTirage = (n: number) => ({ ...tree(), totals: { tirage: n, salePriceRub: 1 } })

  it('читается из сохранённых итогов, по умолчанию одно изделие', () => {
    expect(tirageOf(withTirage(4))).toBe(4)
    expect(tirageOf(tree())).toBe(1)
    expect(tirageOf({ totals: { tirage: 0 } })).toBe(1)
    expect(tirageOf({ totals: { tirage: 2.5 } })).toBe(1)
  })

  it('умножает количества спецификации', () => {
    const one = extractSpecification(tree())
    const three = extractSpecification(withTirage(3))

    expect(one.sections[0]?.rows[0]?.qty).toBe(12.5)
    expect(three.sections[0]?.rows[0]?.qty).toBe(37.5)
    expect(three.tirage).toBe(3)
  })

  it('доходит до документа, чтобы состав и цена относились к одному заказу', () => {
    const doc = buildKpDocument(
      input({
        snapshot: {
          version: 1, priceListVersion: 1, totalRub: 3_600_000,
          createdAt: new Date('2026-09-09T00:00:00Z'), bundlesJson: withTirage(3),
        },
      }),
    )

    expect(doc.positions[0]?.tirage).toBe(3)
    expect(doc.positions[0]?.sections[0]?.rows[0]?.qty).toBe(37.5)
    expect(doc.totalRub).toBe(3_600_000)
  })
})

describe('buildKpDocument', () => {
  it('не выносит цены строк в документ — они же себестоимость', () => {
    const doc = buildKpDocument(input())

    const serialized = JSON.stringify(doc.positions.map((p) => p.sections))
    expect(serialized).not.toContain('48000')
    expect(serialized).not.toContain('priceCatalog')
    for (const section of doc.positions.flatMap((p) => p.sections)) {
      for (const row of section.rows) {
        expect(Object.keys(row).sort()).toEqual(['name', 'qty', 'unit'])
      }
    }
  })

  it('выделяет НДС из цены, а не начисляет сверху', () => {
    const doc = buildKpDocument(input())

    // 1 200 000 с НДС 22% внутри: налог = 216 393,44, а не 264 000 сверху.
    expect(doc.totalRub).toBe(1_200_000)
    expect(doc.vatRub).toBe(216_393.44)
    expect(doc.vatRatePct).toBe(VAT_RATE_PCT)
    expect(doc.vatRub).toBeLessThan(doc.totalRub)
  })

  it('берёт цифру из снапшота и нумерует документ его редакцией', () => {
    const doc = buildKpDocument(input())

    expect(doc.number).toBe('КП-1A2B3C4D-v2')
    expect(doc.scope).toBe('unit')
    expect(doc.positions).toHaveLength(1)
    expect(doc.positions[0]?.snapshotVersion).toBe(2)
    expect(doc.positions[0]?.priceListVersion).toBe(3)
    expect(doc.issuedAt.toISOString()).toBe('2026-09-08T10:00:00.000Z')
  })

  it('переносит реквизиты проекта и считает позиции', () => {
    const doc = buildKpDocument(input())

    expect(doc.customer).toBe('ООО «Заказчик»')
    expect(doc.project).toBe('Объект «Северный»')
    expect(doc.address).toBe('г. Москва')
    expect(doc.positionsCount).toBe(2)
  })

  it('отказывается печатать, если количество хотя бы одной строки не определено', () => {
    const t = {
      tree: {
        sections: [
          {
            code: '1', title: 'Корпус', enabled: true,
            components: [{ title: 'c', enabled: true, rows: [{ name: 'Труба', unit: 'м', qtyManual: '2*3' }] }],
          },
        ],
      },
    }

    // Выдуманное число в документе заказчику хуже отказа: и «пропустить»,
    // и «подставить расчётное» разошлись бы с расчётом.
    expect(() =>
      buildKpDocument(
        input({
          snapshot: {
            version: 1, priceListVersion: 1, totalRub: 100,
            createdAt: new Date('2026-09-09T00:00:00Z'), bundlesJson: t,
          },
        }),
      ),
    ).toThrow(KpSpecificationIncomplete)
  })

  it('переживает расчёт без проекта и с пустым снапшотом', () => {
    const doc = buildKpDocument(
      input({
        project: null,
        snapshot: { version: 1, priceListVersion: 1, totalRub: 0, createdAt: new Date(0), bundlesJson: {} },
      }),
    )

    expect(doc.customer).toBeNull()
    expect(doc.positions[0]?.sections).toEqual([])
    expect(doc.positionsCount).toBe(0)
    expect(doc.vatRub).toBe(0)
  })
})

describe('buildProjectKpDocument', () => {
  const unit = (over: Record<string, unknown> = {}) => ({
    estimateId: 'aaaaaaaa-0000-0000-0000-000000000000',
    estimateTitle: 'КНС DN3000',
    deviceType: 'KNS',
    snapshot: {
      version: 2,
      priceListVersion: 3,
      totalRub: 1_200_000,
      createdAt: new Date('2026-09-08T10:00:00Z'),
      bundlesJson: tree(),
    },
    ...over,
  })

  const project = {
    projectId: '9f8e7d6c-0000-0000-0000-000000000000',
    project: { title: 'Объект «Северный»', customer: 'ООО «Заказчик»', address: 'г. Москва' },
    units: [
      unit(),
      unit({
        estimateId: 'bbbbbbbb-0000-0000-0000-000000000000',
        estimateTitle: 'ЕМК 50 м³',
        deviceType: 'EMK',
        snapshot: {
          version: 1,
          priceListVersion: 3,
          totalRub: 800_000,
          createdAt: new Date('2026-09-09T12:00:00Z'),
          bundlesJson: tree(),
        },
      }),
    ],
  }

  it('нумерует позиции по порядку единиц и складывает их цены', () => {
    const doc = buildProjectKpDocument(project)

    expect(doc.scope).toBe('project')
    expect(doc.positions.map((p) => [p.number, p.title])).toEqual([
      [1, 'КНС DN3000'],
      [2, 'ЕМК 50 м³'],
    ])
    // Цена проекта — сумма согласованных цен, а не новый расчёт.
    expect(doc.totalRub).toBe(2_000_000)
  })

  it('редакция и версия прайса живут в позиции: у каждой единицы свои', () => {
    const doc = buildProjectKpDocument(project)

    expect(doc.positions.map((p) => p.snapshotVersion)).toEqual([2, 1])
    // Номер документа — по проекту: общей редакции у него нет.
    expect(doc.number).toBe('КП-9F8E7D6C')
  })

  it('дата документа — самый поздний снапшот, чтобы печать была воспроизводимой', () => {
    const doc = buildProjectKpDocument(project)

    expect(doc.issuedAt.toISOString()).toBe('2026-09-09T12:00:00.000Z')
  })

  it('НДС выделяется из общей суммы, а не начисляется сверху', () => {
    const doc = buildProjectKpDocument(project)

    expect(doc.vatRub).toBe(vatIncludedIn(2_000_000))
    expect(doc.vatRub).toBeLessThan(doc.totalRub)
  })

  it('цены строк и здесь не попадают в документ', () => {
    const doc = buildProjectKpDocument(project)

    expect(JSON.stringify(doc.positions)).not.toContain('48000')
  })

  it('называет единицу, на которой спецификацию собрать не удалось', () => {
    const broken = {
      tree: {
        sections: [
          {
            code: '1', title: 'Корпус', enabled: true,
            components: [{ title: 'c', enabled: true, rows: [{ name: 'Труба', unit: 'м', qtyManual: '2*3' }] }],
          },
        ],
      },
    }

    try {
      buildProjectKpDocument({
        ...project,
        units: [
          project.units[0]!,
          unit({
            estimateTitle: 'КОЛ 1500',
            snapshot: {
              version: 1, priceListVersion: 3, totalRub: 10, createdAt: new Date(0), bundlesJson: broken,
            },
          }),
        ],
      })
      expect.unreachable('должно было выбросить KpSpecificationIncomplete')
    } catch (e) {
      expect(e).toBeInstanceOf(KpSpecificationIncomplete)
      // Без имени единицы инженер не поймёт, какой из расчётов чинить.
      expect((e as KpSpecificationIncomplete).estimateTitle).toBe('КОЛ 1500')
    }
  })

  it('проект из одной единицы даёт документ из одной позиции', () => {
    const doc = buildProjectKpDocument({ ...project, units: [project.units[0]!] })

    expect(doc.positions).toHaveLength(1)
    expect(doc.totalRub).toBe(1_200_000)
  })
})

describe('форматирование', () => {
  it('деньги — с разрядами неразрывным пробелом и рублём', () => {
    expect(formatMoney(1234567.89)).toBe(`1${NBSP}234${NBSP}567,89${NBSP}₽`)
    expect(formatMoney(0)).toBe(`0,00${NBSP}₽`)
    // Разряды не должны разъезжаться по переносу строки — обычного пробела быть не должно.
    expect(formatMoney(1234567.89)).not.toContain(' ')
  })

  it('количество — целые без хвоста, дробные до трёх знаков', () => {
    expect(formatQty(3)).toBe('3')
    expect(formatQty(12.5)).toBe('12,5')
    expect(formatQty(1.23456)).toBe('1,235')
  })

  it('НДС из нулевой и отрицательной суммы — ноль', () => {
    expect(vatIncludedIn(0)).toBe(0)
    expect(vatIncludedIn(-100)).toBe(0)
  })
})
