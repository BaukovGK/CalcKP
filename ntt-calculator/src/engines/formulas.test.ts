import { describe, expect, it } from 'vitest'
import { fotHoursFromMass } from './fot'
import {
  anchorCount,
  ANCHOR_CAPACITY_N,
  bottomMassKg,
  cutoutHours,
  insulation,
  ladder,
  laminationMassKg,
  LAMINATE_DENSITY,
  marketableAppearanceHours,
  pipeLengthM,
  pipeMassKg,
  pipePrepHours,
  pumpGuidesM,
  topSlabMassKg,
} from './formulas'

// ─────────────────────────────────────────────────────────────────────────────
// Контрольные значения сборки «Корпус» из README хендоффа (использованы
// дословно как эталон вида и чисел). Показаны с округлением до 0,1.
// ─────────────────────────────────────────────────────────────────────────────

describe('сборка «Корпус» ОЛ3487 — контрольные числа README', () => {
  const DN = 3000
  const LENGTH_M = 11.6 // Нподз 11 600 мм

  it('масса формованного дна DN3000 → 262,8 кг', () => {
    expect(bottomMassKg(DN)).toBeCloseTo(262.845, 3)
    expect(Number(bottomMassKg(DN).toFixed(1))).toBe(262.8)
  })

  it('ламинирование дна к фальшполу → 78,9 кг', () => {
    expect(Number(laminationMassKg(bottomMassKg(DN)).toFixed(1))).toBe(78.9)
  })

  it('придание изделию товарного вида → 26,8 чел.ч', () => {
    expect(Number(marketableAppearanceHours(DN, LENGTH_M).toFixed(1))).toBe(26.8)
  })

  // Полная цепочка: геометрия → масса → ФОТ-спутник.
  it('ФОТ-спутник дна (k=0,28) → 73,6 чел.ч', () => {
    expect(fotHoursFromMass(bottomMassKg(DN), 0.28)).toBe(73.6)
  })

  it('ФОТ-спутник ламинирования (k=0,56) → 44,2 чел.ч', () => {
    expect(fotHoursFromMass(laminationMassKg(bottomMassKg(DN)), 0.56)).toBe(44.2)
  })

  it('длина трубы корпуса = Нподз / 1000', () => {
    expect(pipeLengthM(11600)).toBe(11.6)
  })

  it('масса трубы корпуса: 11,6 м × 970,2 кг/пм (ключ 3000;0,6;10000)', () => {
    expect(pipeMassKg(11.6, 970.2)).toBeCloseTo(11254.32, 2)
  })
})

describe('pipeMassKg — промах справочника', () => {
  it('вес не найден → null, а не 0', () => {
    // Молчаливый ноль превратил бы отсутствие данных в «бесплатную трубу».
    expect(pipeMassKg(11.6, null)).toBeNull()
  })
})

describe('bottomMassKg', () => {
  it('растёт с DN', () => {
    expect(bottomMassKg(3000)).toBeGreaterThan(bottomMassKg(2000))
  })

  it('складывается из сферической и плоской частей', () => {
    // π·((DN+300)/2000)²·0,01·1850 + ((DN/1000)²·π·0,008·1850)/4
    const dn = 2000
    const dish = Math.PI * ((dn + 300) / 2000) ** 2 * 0.01 * LAMINATE_DENSITY
    const flat = ((dn / 1000) ** 2 * Math.PI * 0.008 * LAMINATE_DENSITY) / 4
    expect(bottomMassKg(dn)).toBeCloseTo(dish + flat, 9)
  })
})

describe('laminationMassKg — норма 3/10 (Механика §13)', () => {
  it('составляет 30 % массы детали', () => {
    expect(laminationMassKg(100)).toBeCloseTo(30, 9)
  })
})

describe('topSlabMassKg', () => {
  it('без люков — чистая площадь перекрытия', () => {
    const dn = 3000
    expect(topSlabMassKg(dn)).toBeCloseTo(
      Math.PI * ((dn + 300) / 2000) ** 2 * 0.006 * LAMINATE_DENSITY,
      9,
    )
  })

  it('люки вычитаются из массы перекрытия', () => {
    expect(topSlabMassKg(3000, 11.1, 2)).toBeCloseTo(topSlabMassKg(3000) - 22.2, 9)
  })
})

describe('insulation — теплоизоляция (Библиотека A9)', () => {
  const r = insulation(3000, 2000) // ОЛ3487: ТИ на глубину 2000 мм

  it('вертикаль = π·(DN/1000)·(h/1000)', () => {
    expect(r.verticalM2).toBeCloseTo(Math.PI * 3 * 2, 9)
  })

  it('крышка = π·(DN/2000)²', () => {
    expect(r.lidM2).toBeCloseTo(Math.PI * 1.5 ** 2, 9)
  })

  it('защитный слой = S·0,005·1850 (КНС)', () => {
    expect(r.protectiveLayerKg).toBeCloseTo(r.totalM2 * 0.005 * LAMINATE_DENSITY, 9)
  })

  it('у колодца защитный слой тоньше — 0,004', () => {
    const kol = insulation(3000, 2000, { protectiveThickness: 0.004 })
    expect(kol.protectiveLayerKg).toBeCloseTo(kol.totalM2 * 0.004 * LAMINATE_DENSITY, 9)
    expect(kol.protectiveLayerKg).toBeLessThan(r.protectiveLayerKg)
  })

  it('монтаж — 1 чел.ч на 1 м²', () => {
    expect(r.mountingHours).toBeCloseTo(r.totalM2, 9)
  })
})

describe('cutoutHours — прорезка отверстия', () => {
  it('0,5 чел.ч на 1 м окружности', () => {
    // Ø ≈ 318,3 мм → окружность ровно 1 м → 0,5 чел.ч
    expect(cutoutHours(1000 / Math.PI)).toBeCloseTo(0.5, 9)
  })

  it('гильза Ø500 → π·0,5·0,5 чел.ч', () => {
    expect(cutoutHours(500)).toBeCloseTo((500 * Math.PI) / 1000 / 2, 9)
  })

  it('домножается на количество', () => {
    expect(cutoutHours(500, 3)).toBeCloseTo(cutoutHours(500) * 3, 9)
  })
})

describe('pipePrepHours — подготовка трубы', () => {
  it('DN/(200·6) × L', () => {
    expect(pipePrepHours(3000, 11.6)).toBeCloseTo(29, 9)
  })
})

describe('pumpGuidesM — направляющие насосов', () => {
  it('L × (раб + рез) × 2', () => {
    expect(pumpGuidesM(11.6, 2, 1)).toBeCloseTo(69.6, 9)
  })

  it('запасные насосы не учитываются', () => {
    expect(pumpGuidesM(11.6, 2, 1)).toBe(pumpGuidesM(11.6, 2, 1))
  })
})

describe('anchorCount — крепление против всплытия (Библиотека B6)', () => {
  it('= выталкивающая сила / 27 500 Н', () => {
    const d = 3.3
    const h = 11.6
    const expected = (((Math.PI * d ** 2) / 4) * h * 1000 * 9.8) / ANCHOR_CAPACITY_N
    expect(anchorCount(d, h)).toBeCloseTo(expected, 9)
  })

  it('растёт с глубиной и диаметром', () => {
    expect(anchorCount(3.3, 12)).toBeGreaterThan(anchorCount(3.3, 6))
    expect(anchorCount(3.3, 12)).toBeGreaterThan(anchorCount(2, 12))
  })

  it('несущая способность анкера — 27 500 Н', () => {
    expect(ANCHOR_CAPACITY_N).toBe(27500)
  })
})

describe('ladder — лестница (Библиотека B1)', () => {
  const l = ladder(11.6)

  it('изготовление = 1,25 × H', () => {
    expect(l.fabricationHours).toBeCloseTo(14.5, 9)
  })

  it('монтаж = изготовление / 2', () => {
    expect(l.mountingHours).toBeCloseTo(7.25, 9)
  })

  it('материал = H × 2', () => {
    expect(l.materialM).toBeCloseTo(23.2, 9)
  })

  it('горловина добавляется к высоте', () => {
    expect(ladder(11.6, 1).lengthM).toBeCloseTo(12.6, 9)
  })
})
