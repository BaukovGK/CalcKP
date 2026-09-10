import { beforeEach, describe, expect, it } from 'vitest'
// Прямой импорт прайса из бэкенда — как в pressure-pipe-kit.test.ts: имя
// позиции — часть ключа цены, и сверять его надо с настоящим прайсом.
import prices from '../../../backend/prisma/seed-data/prices.json'
import {
  BASKET_GRINDER_ITEMS,
  BASKET_GRINDER_WORKS,
  buildBasket,
  buildGrinder,
  chainLengthM,
  GRINDER_CHANNEL_MASS_KG,
  guideLengthM,
  roundBarLengthM,
} from './basket-grinder'
import { __resetIds, type CalcComponent, type MaterializeContext } from './template-kns'

const KEYS = new Set(prices.map((p) => `${p.category}|${p.name}|${p.unit}`))
const PRICE = new Map(prices.map((p) => [`${p.category}|${p.name}|${p.unit}`, p.priceRub]))

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICE.get(`${c}|${n}|${u}`) ?? null,
  pipeWeightOf: () => null,
  priceListVersion: 1,
}

beforeEach(() => __resetIds())

/** Строки узла без ФОТ-спутников: наименование → количество. */
const qtys = (c: CalcComponent) => c.rows.filter((r) => r.kind !== 'ФОТ').map((r) => [r.name, r.qtyCalc])

describe('корзина и дробилка против прайса', () => {
  it('все позиции узлов находятся в прайсе дословно', () => {
    for (const item of Object.values(BASKET_GRINDER_ITEMS)) {
      const key = `${item.category}|${item.name}|${item.unit}`
      expect(KEYS.has(key), `нет в прайсе: ${key}`).toBe(true)
    }
  })

  it('работы узлов находятся в прайсе', () => {
    const W = BASKET_GRINDER_WORKS
    for (const name of [W.basketMake, W.basketMount, W.guidesMake, W.guidesMount, W.grinderGuidesMount]) {
      expect(KEYS.has(`Собственное производство|${name}|чел. ч`), name).toBe(true)
    }
    for (const name of [W.grinderChannel, W.grinderLamination]) {
      expect(KEYS.has(`Собственное производство|${name}|кг`), name).toBe(true)
    }
  })

  // Лист КНС называет кольцо «5Х50», которого в прайсе нет: эталон считал
  // его за 0 ₽. Взято единственное 5-мм кольцо прайса.
  it('кольца «5Х50» из листа КНС в прайсе нет — берётся 5Х30', () => {
    expect(KEYS.has('Грузоподъем|Кольцо сварное полированное АРТ 8229 А4 5Х50|шт')).toBe(false)
    expect(BASKET_GRINDER_ITEMS.basketRing.name).toContain('5Х30')
  })

  it('ни одна строка узлов не рождается «красной»', () => {
    const nodes = [
      buildBasket(ctx, { device: 'KNS', dn: 3000, trayDepthMm: 9910, enabled: true }),
      buildBasket(ctx, { device: 'EMK', dn: 3000, trayDepthMm: 2400, enabled: true }),
      buildGrinder(ctx, { device: 'KNS', trayDepthMm: 9910, inletDn: 400, enabled: true }),
      buildGrinder(ctx, { device: 'KOL', trayDepthMm: 2000, enabled: true }),
    ]
    for (const r of nodes.flatMap((c) => c.rows)) {
      expect(r.priceCatalog, `без цены: ${r.name}`).not.toBeNull()
    }
  })
})

describe('цепь и направляющие от глубины лотка', () => {
  it('цепь = ROUNDUP(H/1000 + 1), направляющие = ROUNDUP(2·H/1000)', () => {
    expect(chainLengthM(9910)).toBe(11)
    expect(guideLengthM(9910)).toBe(20)
    expect(chainLengthM(2400)).toBe(4)
    expect(guideLengthM(2400)).toBe(5)
    // Ровные метры не округляются вверх лишний раз.
    expect(chainLengthM(2000)).toBe(3)
    expect(guideLengthM(2000)).toBe(4)
  })

  it('пруток «Круг 5 мм» — 3,14 × 0,05 м на метр цепи, без двоичного хвоста', () => {
    expect(roundBarLengthM(4)).toBe(0.628)
    expect(roundBarLengthM(3)).toBe(0.471)
  })
})

describe('корзина: состав и количества по эталону', () => {
  // Образец листа КНС: DN 3000, лоток на 9 910 мм (строки 103–113).
  it('КНС — как в образце листа', () => {
    const basket = buildBasket(ctx, { device: 'KNS', dn: 3000, trayDepthMm: 9910, enabled: true })
    expect(qtys(basket)).toEqual([
      ['Уголок 20х20х1,5мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', 10],
      ['Лист нержавеющий перфорированный 1х1000х2000мм Qg 10.0-12.0 марка 10х18н10', 2],
      [BASKET_GRINDER_ITEMS.basketGuidePipe.name, 20],
      ['Кольцо сварное полированное АРТ 8229 А4 5Х30', 11],
      ['Цепь короткозвенная сварная 3 мм DIN 766 А2/А4', 11],
      ['Скоба такелажная прямая М6', 11],
      ['Изготовление Сороудерживающей корзины', 7],
      ['Монтаж Сороудерживающей корзины', 6],
      ['Изготовление направляющих корзины', 2],
      ['Монтаж направляющих корзины', 2],
    ])
  })

  it('КНС: при корзине вместе с дробилкой трубы направляющих корзины нет', () => {
    const basket = buildBasket(ctx, { device: 'KNS', dn: 3000, trayDepthMm: 9910, enabled: true, withGrinder: true })
    const pipe = basket.rows.find((r) => r.name.startsWith('Труба 45х3,0'))!
    expect(pipe.qtyCalc).toBe(0)
    expect(pipe.note).toContain('строка 105')
  })

  // Образец листа колодца: DN 2000, лоток 2 000 мм (строки 95–105).
  it('КОЛ — такелаж прутком и карабинами, как в листе колодца', () => {
    const basket = buildBasket(ctx, { device: 'KOL', dn: 2000, trayDepthMm: 2000, enabled: true })
    expect(qtys(basket)).toEqual([
      ['Уголок 20х20х1,5мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', 10],
      ['Лист нержавеющий перфорированный 1х1000х2000мм Qg 10.0-12.0 марка 10х18н10', 2],
      [BASKET_GRINDER_ITEMS.basketGuidePipe.name, 4],
      ['Круг 5 мм 12Х18Н10Т ГОСТ 5949-75', 0.471],
      ['Цепь короткозвенная сварная 3 мм DIN 766 А2/А4', 3],
      ['Карабин винтовой 5 мм нерж. А4 ART 8253', 2],
      ['Изготовление Сороудерживающей корзины', 6],
      ['Монтаж Сороудерживающей корзины', 5],
      ['Изготовление направляющих корзины', 2],
      ['Монтаж направляющих корзины', 2],
    ])
  })

  // В листах ёмкости и колодца норма ссылается на пустую ячейку и даёт 6/5
  // при любом DN; замысел — ступень на DN 2500, как в листе КНС.
  it('ЕМК: нормы изготовления и монтажа — ступенью на DN 2500', () => {
    const small = buildBasket(ctx, { device: 'EMK', dn: 2000, trayDepthMm: 2400, enabled: true })
    const big = buildBasket(ctx, { device: 'EMK', dn: 3000, trayDepthMm: 2400, enabled: true })
    const hours = (c: CalcComponent) =>
      c.rows.filter((r) => r.name.includes('Сороудерживающей')).map((r) => r.qtyCalc)
    expect(hours(small)).toEqual([6, 5])
    expect(hours(big)).toEqual([7, 6])
    // Образец листа ёмкости: лоток 2 400 мм.
    expect(big.rows.find((r) => r.name.startsWith('Круг 5 мм'))?.qtyCalc).toBe(0.628)
    expect(big.rows.find((r) => r.name.startsWith('Карабин'))?.qtyCalc).toBe(2)
  })

  it('без глубины лотка цепь и направляющие не выдумываются', () => {
    const basket = buildBasket(ctx, { device: 'EMK', dn: 2000, trayDepthMm: null, enabled: true })
    const byName = (s: string) => basket.rows.find((r) => r.name.startsWith(s))!
    for (const name of ['Труба 45х3,0', 'Круг 5 мм', 'Цепь', 'Карабин']) {
      expect(byName(name).qtyCalc, name).toBeNull()
      expect(byName(name).note).toContain('глубину лотка')
    }
    // Нормативы от глубины не зависят и считаются всегда.
    expect(byName('Уголок 20х20').qtyCalc).toBe(10)
    expect(byName('Изготовление Сороудерживающей').qtyCalc).toBe(6)
  })

  it('выключенная корзина остаётся «призраком» и помнит ответ ОЛ', () => {
    const basket = buildBasket(ctx, { device: 'KOL', dn: 2000, trayDepthMm: 2000, enabled: false })
    expect(basket.enabled).toBe(false)
    expect(basket.enabledCalc).toBe(false)
    expect(basket.rows).toHaveLength(10)
  })
})

describe('дробилка: состав и количества по эталону', () => {
  // Образец листа КНС: лоток 9 910 мм, подводящий DN 400 (строки 75–83, 93).
  it('КНС — канал, направляющие, рама, подвес и монтаж', () => {
    const grinder = buildGrinder(ctx, { device: 'KNS', trayDepthMm: 9910, inletDn: 400, enabled: true })
    expect(qtys(grinder)).toEqual([
      ['Механическая формовка деталей канала под дробилку', GRINDER_CHANNEL_MASS_KG],
      ['Ламинирование деталей площадки под дробилку в сборке', GRINDER_CHANNEL_MASS_KG * 0.3],
      ['Уголок 50х50х5мм 12Х18Н10Т (AISI304) ГОСТ 8509-93', 20],
      ['Труба 60х30х2мм 12Х18Н10Т ГОСТ 8639-82', 1],
      ['Кольцо сварное полированное АРТ 8229 А4 10Х60', 11],
      ['Цепь короткозвенная сварная 5 мм DIN 766 А2/А4', 11],
      ['Карабин винтовой 5 мм нерж. А4 ART 8253', 11],
      ['Монтаж направляющих дробилки', 2],
    ])
  })

  it('масса канала — 4,7 м² × 7 мм × 1850 кг/м³', () => {
    expect(GRINDER_CHANNEL_MASS_KG).toBeCloseTo(60.865, 6)
  })

  it('ФОТ: 0,28 у формовки, 1 — у ламинирования площадки, как в эталоне', () => {
    const grinder = buildGrinder(ctx, { device: 'KNS', trayDepthMm: 9910, inletDn: 400, enabled: true })
    const fot = grinder.rows.filter((r) => r.kind === 'ФОТ').map((r) => r.fotK)
    expect(fot).toEqual([0.28, 1])
  })

  // Образец листа колодца: лоток 2 000 мм (строки 68–75).
  it('КОЛ — пруток и карабин через два метра, без рамы и монтажа направляющих', () => {
    const grinder = buildGrinder(ctx, { device: 'KOL', trayDepthMm: 2000, enabled: true })
    const names = grinder.rows.map((r) => r.name)
    expect(names).not.toContain('Труба 60х30х2мм 12Х18Н10Т ГОСТ 8639-82')
    expect(names).not.toContain('Монтаж направляющих дробилки')
    expect(qtys(grinder).slice(2)).toEqual([
      ['Уголок 50х50х5мм 12Х18Н10Т (AISI304) ГОСТ 8509-93', 4],
      ['Круг 5 мм 12Х18Н10Т ГОСТ 5949-75', 0.471],
      ['Цепь короткозвенная сварная 5 мм DIN 766 А2/А4', 3],
      ['Карабин винтовой 5 мм нерж. А4 ART 8253', 2],
    ])
  })
})
