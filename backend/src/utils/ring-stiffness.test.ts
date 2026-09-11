import { describe, expect, it } from 'vitest'
import vectors from './sn-rule.vectors.json'
import { ringStiffnessDesignation, ringStiffnessPa } from './ring-stiffness'

// Те же примеры прогоняет фронтенд (engines/survey-kns.test.ts): правило
// задано в двух местах и обязано давать одно и то же.
describe('правило SN — общие примеры с опросным листом', () => {
  it.each(vectors.cases)('%j', ({ depthMm, underRoadway, mvk, sn, designation }) => {
    const pa = ringStiffnessPa(depthMm, { underRoadway })
    expect(pa).toBe(sn)
    expect(ringStiffnessDesignation(pa, { mvk })).toBe(designation)
  })
})

describe('ringStiffnessPa — две реальные ступени', () => {
  it('порог 7000 мм: ровно на нём — нижняя ступень, выше — 10000', () => {
    expect(ringStiffnessPa(7000)).toBe(5000)
    expect(ringStiffnessPa(7000.5)).toBe(10000)
  })

  // Прежнее правило бэкенда сравнивало «глубину патрубка + 2 м» с 7 м и
  // давало здесь 10000, тогда как опросный лист — 5000.
  it('лоток 5,2 м (Нподз 6900) — SN 5000, как в опросном листе', () => {
    expect(ringStiffnessPa(6900)).toBe(5000)
  })

  it('ТТ МВК жёсткость не меняет — меняется только обозначение', () => {
    expect(ringStiffnessPa(11600)).toBe(10000)
    expect(ringStiffnessDesignation(10000, { mvk: true })).toBe(12000)
  })

  it('незнакомое значение под ТТ МВК возвращается как есть', () => {
    expect(ringStiffnessDesignation(2500, { mvk: true })).toBe(2500)
  })

  it('отрицательная или нечисловая глубина — ошибка', () => {
    expect(() => ringStiffnessPa(-1)).toThrow(/depthMm/)
    expect(() => ringStiffnessPa(Number.NaN)).toThrow(/depthMm/)
  })
})
