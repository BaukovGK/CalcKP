import { describe, expect, it } from 'vitest'
import { flowAtHead, interpolateCurve, type CurvePoint } from './pump-curve'

/** Три точки прямой H = 20 − 0,1·Q — считать в уме легко. */
const LINE: CurvePoint[] = [
  { q: 0, h: 20, p2: 1, p1: 1.3, eff: 0 },
  { q: 50, h: 15, p2: 2, p1: 2.6, eff: 50 },
  { q: 100, h: 10, p2: 3, p1: 3.9, eff: 40 },
]

describe('interpolateCurve', () => {
  it('возвращает точку кривой как есть', () => {
    expect(interpolateCurve(LINE, 50)).toEqual({ q: 50, h: 15, p2: 2, p1: 2.6, eff: 50 })
  })

  it('интерполирует между точками все величины сразу', () => {
    const d = interpolateCurve(LINE, 25)!
    expect(d.h).toBeCloseTo(17.5, 10)
    expect(d.p2).toBeCloseTo(1.5, 10)
    expect(d.p1).toBeCloseTo(1.95, 10)
    expect(d.eff).toBeCloseTo(25, 10)
  })

  it('работает на границах диапазона', () => {
    expect(interpolateCurve(LINE, 0)?.h).toBe(20)
    expect(interpolateCurve(LINE, 100)?.h).toBe(10)
  })

  it('НЕ экстраполирует за пределы кривой', () => {
    // Продолжение прямой ушло бы в напор ниже нуля — паспорт этого не обещает.
    expect(interpolateCurve(LINE, 100.1)).toBeNull()
    expect(interpolateCurve(LINE, -1)).toBeNull()
  })

  it('не падает на вырожденных входах', () => {
    expect(interpolateCurve([], 10)).toBeNull()
    expect(interpolateCurve([LINE[0]!], 0)).toBeNull()
    expect(interpolateCurve(LINE, Number.NaN)).toBeNull()
  })

  it('не зависит от порядка точек на входе', () => {
    const shuffled = [LINE[2]!, LINE[0]!, LINE[1]!]
    expect(interpolateCurve(shuffled, 25)?.h).toBeCloseTo(17.5, 10)
  })
})

describe('flowAtHead', () => {
  it('находит расход, при котором кривая даёт заданный напор', () => {
    expect(flowAtHead(LINE, 17.5)).toBeCloseTo(25, 10)
    expect(flowAtHead(LINE, 15)).toBeCloseTo(50, 10)
  })

  it('вне диапазона напоров кривой возвращает null', () => {
    expect(flowAtHead(LINE, 21)).toBeNull()
    expect(flowAtHead(LINE, 9)).toBeNull()
  })

  it('на горизонтальном участке берёт наименьший расход', () => {
    const flat: CurvePoint[] = [
      { q: 0, h: 10, p2: 1, p1: 1, eff: 0 },
      { q: 10, h: 10, p2: 1, p1: 1, eff: 10 },
      { q: 20, h: 5, p2: 1, p1: 1, eff: 20 },
    ]
    expect(flowAtHead(flat, 10)).toBe(0)
  })
})
