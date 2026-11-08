import { describe, expect, it } from 'vitest'
import {
  calcDelivery,
  findRate,
  itemsPerTruck,
  knsDelivery,
  loadingLengthM,
  permitRequired,
  planTrucks,
  type DeliveryRate,
} from './delivery'

// Строки «Книги 8, 3 кв. 2026г.»
const MOSCOW: DeliveryRate = {
  id: 'msk', city: 'Москва', gabaritRub: 65450, permitRub: 150000, escortRub: 157000,
  note: 'негабарит 3,5*4,5 (всё что шире и выше - по согласованию)!!!',
}
const SPB: DeliveryRate = { id: 'spb', city: 'Санкт-Петербург', gabaritRub: 175500, permitRub: 295000, escortRub: null, note: 'только с Разрешением' }
const RYAZAN: DeliveryRate = { id: 'rzn', city: 'Рязань', gabaritRub: 105500, permitRub: 175000, escortRub: 185000, note: 'только с Разрешением' }

describe('таблица ограничений по погрузке', () => {
  it('столбец длины — наименьший, куда изделие ложится', () => {
    expect(loadingLengthM(1.5)).toBe(2)
    expect(loadingLengthM(3)).toBe(3)
    expect(loadingLengthM(5.2)).toBe(6)
    expect(loadingLengthM(11.9)).toBe(12)
    expect(loadingLengthM(14)).toBe(12)
  })

  it('изделий в машине — как в таблице', () => {
    expect(itemsPerTruck(300, 12)).toBe(42)
    expect(itemsPerTruck(300, 6)).toBe(84) // D5 = B5*2
    expect(itemsPerTruck(1000, 3)).toBe(16) // H14 = B14*4
    expect(itemsPerTruck(1200, 2)).toBe(18) // J16 = B16*6
    expect(itemsPerTruck(2000, 12)).toBe(1)
  })

  it('Ду не из ряда — по ближайшему большему, больше 3000 — одно', () => {
    expect(itemsPerTruck(550, 12)).toBe(9) // как 600
    expect(itemsPerTruck(200, 12)).toBe(42) // как 300
    expect(itemsPerTruck(3200, 4)).toBe(3) // 1 × 3
  })

  it('число машин под партию — с округлением вверх', () => {
    expect(planTrucks({ diameterMm: 1000, lengthMm: 3000, quantity: 17 }).productTrucks).toBe(2)
    expect(planTrucks({ diameterMm: 1000, lengthMm: 3000, quantity: 16 }).productTrucks).toBe(1)
  })
})

describe('правила доставки', () => {
  it('габаритная КНС: корпус и комплектующие — по габаритной ставке', () => {
    const r = knsDelivery(2000, 8000, MOSCOW)
    expect(r.plan.total).toBe(2)
    expect(r.lines).toEqual([
      { column: 'gabaritRub', label: 'Габаритный груз', trucks: 2, rateRub: 65450, sumRub: 130900 },
    ])
    expect(r.totalRub).toBe(130900)
  })

  it('Ду 2400 — ещё габарит (правило «больше 2,4 м»)', () => {
    expect(knsDelivery(2400, 8000, MOSCOW).plan.oversize).toBe(false)
    expect(knsDelivery(2500, 8000, MOSCOW).plan.oversize).toBe(true)
  })

  it('негабарит без разрешения: корпус — сопровождение, комплектующие — габарит', () => {
    const r = knsDelivery(3000, 11900, MOSCOW)
    expect(r.permitRequired).toBe(false)
    expect(r.lines.map((l) => [l.column, l.trucks])).toEqual([['gabaritRub', 1], ['escortRub', 1]])
    expect(r.totalRub).toBe(65450 + 157000)
  })

  it('«только с Разрешением» добавляет ставку разрешения к негабариту', () => {
    const r = knsDelivery(3000, 11900, RYAZAN)
    expect(r.permitRequired).toBe(true)
    expect(r.lines.map((l) => [l.column, l.trucks])).toEqual([['gabaritRub', 1], ['escortRub', 1], ['permitRub', 1]])
    expect(r.totalRub).toBe(105500 + 185000 + 175000)
  })

  it('КНС длиннее 12 м — ещё одна машина того же класса', () => {
    const big = knsDelivery(3000, 13500, RYAZAN)
    expect(big.plan).toMatchObject({ productTrucks: 1, extraLengthTrucks: 1, componentsTrucks: 1, total: 3 })
    expect(big.totalRub).toBe(105500 + 2 * 185000 + 2 * 175000)

    const small = knsDelivery(2000, 12500, MOSCOW)
    expect(small.lines).toEqual([
      { column: 'gabaritRub', label: 'Габаритный груз', trucks: 3, rateRub: 65450, sumRub: 196350 },
    ])
  })

  it('ровно 12 м — без лишней машины', () => {
    expect(knsDelivery(2000, 12000, MOSCOW).plan.extraLengthTrucks).toBe(0)
  })

  it('нет нужной ставки — итога нет, ставка названа', () => {
    const r = knsDelivery(3000, 9000, SPB)
    expect(r.totalRub).toBeNull()
    expect(r.missing).toEqual(['Негабаритный груз, сопровождение'])
  })

  it('без машины комплектующих — только изделие', () => {
    const r = calcDelivery({ diameterMm: 1000, lengthMm: 3000, quantity: 20 }, MOSCOW)
    expect(r.plan.total).toBe(2)
    expect(r.totalRub).toBe(2 * 65450)
  })
})

describe('вспомогательное', () => {
  it('примечание о разрешении — без учёта регистра', () => {
    expect(permitRequired({ note: 'только с Разрешением' })).toBe(true)
    expect(permitRequired({ note: 'ТОЛЬКО С РАЗРЕШЕНИЕМ' })).toBe(true)
    expect(permitRequired({ note: 'октябрь' })).toBe(false)
    expect(permitRequired(null)).toBe(false)
  })

  it('маршрут — по id, после импорта — по городу', () => {
    const rates = [MOSCOW, SPB]
    expect(findRate(rates, 'spb', 'Москва')?.city).toBe('Санкт-Петербург')
    expect(findRate(rates, 'old-id', 'Москва')?.id).toBe('msk')
    expect(findRate(rates, '', '')).toBeNull()
  })
})
