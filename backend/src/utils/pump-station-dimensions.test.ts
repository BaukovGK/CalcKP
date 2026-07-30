import { describe, expect, it } from 'vitest'
import {
  calcPumpStationDimensions,
  resolveDiameterMm,
  roundUpTo,
  CORPUS_DN_MIN_MM,
  MVK_DN_MIN_MM,
  type PumpStationInput,
  type PumpStationWarning,
} from './pump-station-dimensions'

/**
 * Тесты на данных 7 реальных опросных листов из «Работа/Примеры» (прочитаны
 * exceljs напрямую из листа `ОЛ_НАСОСНАЯ_СТАНЦИЯ`, формулы и значения сверены
 * поячеечно). `capacityM3h` — приток на ОДИН насос (E51/E55), т.к. функция не
 * принимает количество насосов (см. заголовок `pump-station-dimensions.ts`).
 *
 * ⚠️ Находки при сверке (важно для доверия к функции):
 *
 * 1) Формула hраб (N44) НЕ везде `4·Vраб/(π·D²)`. В 3 из 7 листов (ДНС Пехотная
 *    «8-ка», Ол№3429, ОЛ3460) вместо DN подставлена вручную введённая площадь
 *    сечения (`N42/12.9`, `N42/23`) — корпус нестандартной формы (не круглый
 *    DN). Для этих листов функция (рассчитана только на круглый корпус, ТЗ)
 *    ожидаемо не воспроизводит hраб/Нподз — это не баг, а граница охвата.
 *
 * 2) Запас над рабочей зоной (+0,3 в hР) тоже не универсален: в 2 листах
 *    (ОЛ3462 КНС/ЛНС 2500) он равен +0,15. Высота рамы насосов (N50) в разных
 *    листах от 0,14 до 0,28 м. Оба параметра в функции — фиксированные
 *    дефолты (не входят в заданный набор входных параметров), поэтому полный
 *    Нподз точно совпадает только там, где в листе реально стоят те же
 *    значения, что и дефолты функции (0,16 и 0,3) — 2 из 7 листов.
 *
 * 3) В 2 листах (ОЛ3462 КНС/ЛНС 2500) стоит «По ТТ МВК: Да» при DN 2500 мм —
 *    формально это противоречит условию «МВК ⇒ DN ≥ 2600», заданному в ТЗ.
 *    Функция реализует правило ТЗ буквально (поднимает DN до 2600 мм с
 *    предупреждением); реальные листы этому правилу не следовали. Тесты ниже
 *    фиксируют ТЕКУЩЕЕ поведение функции, а расхождение с историческими
 *    листами вынесено в отдельный блок как явная находка, а не тихо скрыто.
 *
 * 4) Формула Vэф (N40) в 6 из 7 листов ссылается на P40 (=5, «поминутная
 *    работа»), а не на Q40 (=10, «пусков в час») — то есть Vэф там СЛУЧАЙНО
 *    равен Vмин/2 вместо `Q/(4·10·n)`. Единственный лист, где N40 правильно
 *    ссылается на Q40, — ОЛ3487 (контрольный кейс ТЗ); та же формула (Q40=10)
 *    уже используется в проверенном движке `ntt-calculator/src/engines/
 *    survey-kns.ts` (`STARTS_PER_HOUR = 10`). Похоже на устаревшую опечатку
 *    формулы в 6 листах, а не на альтернативное правило — поэтому ожидаемые
 *    значения Vэф ниже посчитаны по Q40=10 (как в функции), а НЕ списаны
 *    напрямую из ячейки N40 этих 6 листов. Стоит показать технологу: если
 *    опечатка реальна, эти 6 листов в прошлом считали Vэф вдвое заниженным.
 */

// ─── Данные примеров (E20/E22/E27/E41/E51/E55/N47/N50 листа ОЛ_НАСОСНАЯ_СТАНЦИЯ) ──

const OL_DNS_PEHOTNAYA_8KA = {
  file: '4. ДНС Пехотная типа 8-ка H=12100 мм (подземная часть 11800 мм) с Гроссен.xlsx',
  input: {
    inletPipeHeightM: 5.970, mvkRequired: true, capacityM3h: 601.56,
    diameterMm: 3000, minPumpLevelM: 1.01, ringStiffnessPa: 10000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 15.038999999999998, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 30,078
  workingZoneVolumeM3: 50.129999999999995,
  realNpodzMm: 11500, // N44=N42/12.9 (не круглая формула) — hраб не воспроизводим
}

const KNS_BIRULEVSKAYA = {
  file: 'КНС Бирюлевская актуальная 3000х11300 мм (1)1.xlsx',
  input: {
    inletPipeHeightM: 9.490, mvkRequired: true, capacityM3h: 15.012,
    diameterMm: 3000, minPumpLevelM: 0.627, ringStiffnessPa: 10000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 0.3753, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 0,7506
  workingZoneVolumeM3: 1.2510000000000001,
  workingZoneHeightM: 0.17698029671818763,
  realNpodzMm: 10800, // круглая формула + дефолтные рама(0,16)/запас(0,3) — точное совпадение
}

const OL3462_KNS_2500 = {
  file: 'Копия ОЛ3462 КНС 2500х4400 мм (подземная часть 4100 мм) 653 лс Сер. Тушино (с ценами).xlsx',
  input: {
    inletPipeHeightM: 2.880, mvkRequired: true, capacityM3h: 23.508,
    diameterMm: 2500, minPumpLevelM: 0.495, ringStiffnessPa: 5000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 0.5877, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 1,1754
  workingZoneVolumeM3: 1.9590000000000003,
  workingZoneHeightM: 0.3990842029017895, // круглая формула, DN=2500 (в листе МВК не поднял DN)
  realNpodzMm: 4100,
}

const OL3462_LNS_2500 = {
  file: 'Копия ОЛ3462 ЛНС 2500х5000 мм (подземная часть 4700 мм) (расход 1088 лс) Сер. Тушино (с ценами).xlsx',
  input: {
    inletPipeHeightM: 3.180, mvkRequired: true, capacityM3h: 39.168,
    diameterMm: 2500, minPumpLevelM: 0.555, ringStiffnessPa: 5000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 0.9792, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 1,9584
  workingZoneVolumeM3: 3.2640000000000007,
  workingZoneHeightM: 0.6649366198424915,
  realNpodzMm: 4700,
}

const OL3487_PEHOTNAYA = {
  file: 'Копия ОЛ3487 КНС Пехотная 3000х11900 мм (2513 лс) 20 от 26.05.2026.xlsx',
  input: {
    inletPipeHeightM: 9.910, mvkRequired: true, capacityM3h: 45.234,
    diameterMm: 3000, minPumpLevelM: 0.627, ringStiffnessPa: 10000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 1.1308500000000001,
  workingZoneVolumeM3: 3.7695000000000003,
  workingZoneHeightM: 0.533275162653244,
  realNpodzMm: 11600, // контрольное число ТЗ
}

const OL3429_KNS_750 = {
  file: 'Копия Ол_№3429_КНС_3000х8900_мм_750_м3_ч_от_22_04_2026 от 27.04.26.xlsx',
  input: {
    inletPipeHeightM: 5.690, mvkRequired: false, capacityM3h: 375,
    diameterMm: 3000, minPumpLevelM: 1.07, ringStiffnessPa: 5000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 9.375, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 18,75
  workingZoneVolumeM3: 31.25,
  realNpodzMm: 8700, // N44=N42/23 (не круглая формула) — hраб не воспроизводим
}

const OL3460_SIMONOVSKAYA = {
  file: 'ОЛ3460 ЛНС Симоновская наб  АКТ.xlsx',
  input: {
    inletPipeHeightM: 6.360, mvkRequired: true, capacityM3h: 612,
    diameterMm: 3000, minPumpLevelM: 1.01, ringStiffnessPa: 10000,
  } satisfies PumpStationInput,
  effectiveVolumeM3: 15.3, // Q40=10; в листе N40 по ошибке ссылается на P40=5 → там 30,6
  workingZoneVolumeM3: 51,
  realNpodzMm: 12000, // N44=N42/12.9 (не круглая формула) + доп. надбавка +0,1 в Нподз, тоже не в модели
}

const ALL_EXAMPLES = [
  OL_DNS_PEHOTNAYA_8KA, KNS_BIRULEVSKAYA, OL3462_KNS_2500, OL3462_LNS_2500,
  OL3487_PEHOTNAYA, OL3429_KNS_750, OL3460_SIMONOVSKAYA,
]

// ─── 1. Рабочий объём (Vэф/Vраб) — из притока, не зависит от диаметра/формы корпуса ──

describe('рабочий объём (Vэф, Vраб) — все 7 примеров из «Примеры»', () => {
  for (const ex of ALL_EXAMPLES) {
    it(`${ex.file}`, () => {
      const r = calcPumpStationDimensions(ex.input)
      expect(r.effectiveVolumeM3).toBeCloseTo(ex.effectiveVolumeM3, 9)
      expect(r.workingZoneVolumeM3).toBeCloseTo(ex.workingZoneVolumeM3, 9)
    })
  }
})

// ─── 2. Высота рабочей зоны (hраб) — только 4 листа с круглой формулой 4V/(πD²) ──

describe('высота рабочей зоны (hраб) — круглый корпус, формула 4·Vраб/(π·D²)', () => {
  it(`${KNS_BIRULEVSKAYA.file}`, () => {
    const r = calcPumpStationDimensions(KNS_BIRULEVSKAYA.input)
    expect(r.workingZoneHeightM).toBeCloseTo(KNS_BIRULEVSKAYA.workingZoneHeightM, 9)
  })

  it(`${OL3487_PEHOTNAYA.file}`, () => {
    const r = calcPumpStationDimensions(OL3487_PEHOTNAYA.input)
    expect(r.workingZoneHeightM).toBeCloseTo(OL3487_PEHOTNAYA.workingZoneHeightM, 9)
  })

  it(`${OL3462_KNS_2500.file} (изолированно, mvkRequired=false — чтобы не поднимался DN)`, () => {
    // В реальном листе DN так и остался 2500 мм несмотря на МВК=Да (см. блок 5) —
    // здесь проверяем именно формулу площади круга, не завязываясь на подбор DN.
    const r = calcPumpStationDimensions({ ...OL3462_KNS_2500.input, mvkRequired: false })
    expect(r.diameterMm).toBe(2500)
    expect(r.workingZoneHeightM).toBeCloseTo(OL3462_KNS_2500.workingZoneHeightM, 9)
  })

  it(`${OL3462_LNS_2500.file} (изолированно, mvkRequired=false)`, () => {
    const r = calcPumpStationDimensions({ ...OL3462_LNS_2500.input, mvkRequired: false })
    expect(r.diameterMm).toBe(2500)
    expect(r.workingZoneHeightM).toBeCloseTo(OL3462_LNS_2500.workingZoneHeightM, 9)
  })
})

// ─── 3. Полный габарит по высоте (Нподз) — точное совпадение ──

describe('Нподз — точное совпадение с листом (рама 0,16 м и запас 0,3 м = дефолтам функции)', () => {
  it(`${KNS_BIRULEVSKAYA.file} → 10 800 мм`, () => {
    const r = calcPumpStationDimensions(KNS_BIRULEVSKAYA.input)
    expect(r.heightMm).toBe(KNS_BIRULEVSKAYA.realNpodzMm)
  })

  it(`${OL3487_PEHOTNAYA.file} → 11 600 мм (контрольное число ТЗ)`, () => {
    const r = calcPumpStationDimensions(OL3487_PEHOTNAYA.input)
    expect(r.heightMm).toBe(OL3487_PEHOTNAYA.realNpodzMm)
  })
})

// ─── 4. Расхождения по Нподз — задокументированы (не баг, см. заголовок файла) ──

describe('Нподз — известные расхождения с листом (другая рама/запас/форма корпуса)', () => {
  it(`${OL_DNS_PEHOTNAYA_8KA.file}: корпус «8-ка» (не круглый) + рама 0,28 vs дефолт 0,16`, () => {
    const r = calcPumpStationDimensions(OL_DNS_PEHOTNAYA_8KA.input)
    // Реальный Нподз листа — 11 500 мм; функция даёт другое число по двум
    // причинам разом (не круглый корпус + другая рама), поэтому здесь
    // фиксируем текущее поведение функции, а не подгоняем совпадение.
    expect(r.heightMm).toBe(14600)
    expect(r.heightMm).not.toBe(OL_DNS_PEHOTNAYA_8KA.realNpodzMm)
  })

  it(`${OL3462_KNS_2500.file}: DN поднят МВК до 2600 (в листе остался 2500) + рама 0,14 и запас 0,15 vs дефолты`, () => {
    const r = calcPumpStationDimensions(OL3462_KNS_2500.input)
    expect(r.diameterMm).toBe(2600)
    expect(r.heightMm).toBe(4300)
    expect(r.heightMm).not.toBe(OL3462_KNS_2500.realNpodzMm)
  })

  it(`${OL3462_LNS_2500.file}: тот же набор причин, что и КНС 2500`, () => {
    const r = calcPumpStationDimensions(OL3462_LNS_2500.input)
    expect(r.diameterMm).toBe(2600)
    expect(r.heightMm).toBe(4900)
    expect(r.heightMm).not.toBe(OL3462_LNS_2500.realNpodzMm)
  })

  it(`${OL3429_KNS_750.file}: корпус нестандартной формы (N44=N42/23)`, () => {
    const r = calcPumpStationDimensions(OL3429_KNS_750.input)
    expect(r.heightMm).toBe(11700)
    expect(r.heightMm).not.toBe(OL3429_KNS_750.realNpodzMm)
  })

  it(`${OL3460_SIMONOVSKAYA.file}: корпус нестандартной формы + доп. надбавка +0,1 м в листе`, () => {
    const r = calcPumpStationDimensions(OL3460_SIMONOVSKAYA.input)
    expect(r.heightMm).toBe(15100)
    expect(r.heightMm).not.toBe(OL3460_SIMONOVSKAYA.realNpodzMm)
  })
})

// ─── 5. Диаметр и МВК — включая реальное противоречие ТЗ/листов ──

describe('диаметр корпуса', () => {
  it('МВК=Да, DN не задан → подбирается 2600 мм (минимум по МВК)', () => {
    const r = calcPumpStationDimensions({ inletPipeHeightM: 5, mvkRequired: true, capacityM3h: 30 })
    expect(r.diameterMm).toBe(2600)
    expect(r.diameterAssumed).toBe(true)
    expect(r.warnings.map((w) => w.code)).toContain('DN_ASSUMED')
  })

  it('МВК=Нет, DN не задан → подбирается 1800 мм (минимум производства)', () => {
    const r = calcPumpStationDimensions({ inletPipeHeightM: 5, mvkRequired: false, capacityM3h: 30 })
    expect(r.diameterMm).toBe(1800)
    expect(r.diameterAssumed).toBe(true)
  })

  it('DN ниже диапазона производства (1500 мм) → поднимается до 1800 мм', () => {
    const r = calcPumpStationDimensions({ inletPipeHeightM: 3, mvkRequired: false, capacityM3h: 10, diameterMm: 1500 })
    expect(r.diameterMm).toBe(CORPUS_DN_MIN_MM)
    expect(r.warnings.map((w) => w.code)).toContain('DN_BELOW_RANGE')
  })

  it('DN выше диапазона производства (3500 мм) → предупреждение, значение не меняется', () => {
    const r = calcPumpStationDimensions({ inletPipeHeightM: 3, mvkRequired: false, capacityM3h: 10, diameterMm: 3500 })
    expect(r.diameterMm).toBe(3500)
    expect(r.warnings.map((w) => w.code)).toContain('DN_ABOVE_RANGE')
  })

  it(`реальное противоречие: ${OL3462_KNS_2500.file} — лист «По ТТ МВК: Да» при DN 2500 мм (< ${MVK_DN_MIN_MM})`, () => {
    // Правило ТЗ («МВК ⇒ DN ≥ 2600») в этом реальном (согласованном, с ценами)
    // листе не соблюдено. Функция следует правилу ТЗ буквально и поднимает DN;
    // это разошлось с историческим листом — стоит уточнить у заказчика, не
    // единичный ли это допуск/устаревшее правило.
    const r = calcPumpStationDimensions(OL3462_KNS_2500.input) // mvkRequired: true, diameterMm: 2500
    expect(r.diameterMm).toBe(MVK_DN_MIN_MM)
    expect(r.warnings.map((w) => w.code)).toContain('DN_BELOW_MVK')
  })

  it('resolveDiameterMm напрямую: диаметр в допустимом диапазоне остаётся без изменений', () => {
    const warnings: PumpStationWarning[] = []
    const { diameterMm, assumed } = resolveDiameterMm(false, 2200, warnings)
    expect(diameterMm).toBe(2200)
    expect(assumed).toBe(false)
    expect(warnings).toEqual([])
  })
})

// ─── 6. Кольцевая жёсткость — сквозной параметр (см. E22 «*Жёсткость SN, Па» листов) ──

describe('ringStiffnessPa — сквозной параметр, не проверяется и не влияет на расчёт', () => {
  it('не задан → возвращается null', () => {
    const r = calcPumpStationDimensions({ inletPipeHeightM: 5, mvkRequired: false, capacityM3h: 10 })
    expect(r.ringStiffnessPa).toBeNull()
  })

  it(`${OL3487_PEHOTNAYA.file}: реальное значение листа (E22=10000) возвращается как есть`, () => {
    const r = calcPumpStationDimensions(OL3487_PEHOTNAYA.input)
    expect(r.ringStiffnessPa).toBe(10000)
  })

  it(`${OL3462_KNS_2500.file}: реальное значение листа (E22=5000) возвращается как есть`, () => {
    const r = calcPumpStationDimensions(OL3462_KNS_2500.input)
    expect(r.ringStiffnessPa).toBe(5000)
  })

  it('нестандартное значение (не 1250/2500/5000/10000) проходит без предупреждений', () => {
    const r = calcPumpStationDimensions({
      inletPipeHeightM: 5, mvkRequired: false, capacityM3h: 10, diameterMm: 1800, ringStiffnessPa: 4321,
    })
    expect(r.ringStiffnessPa).toBe(4321)
    expect(r.warnings).toEqual([])
  })
})

// ─── 7. Необязательные параметры — переопределение дефолтов (на базе ОЛ3487) ──

describe('переопределение пусков/поминутной работы (база — ОЛ3487)', () => {
  it('startsPerHour вдвое больше дефолта → Vэф вдвое меньше', () => {
    const base = calcPumpStationDimensions(OL3487_PEHOTNAYA.input)
    const r = calcPumpStationDimensions({ ...OL3487_PEHOTNAYA.input, startsPerHour: 20 })
    expect(r.effectiveVolumeM3).toBeCloseTo(base.effectiveVolumeM3 / 2, 9)
    expect(r.workingZoneVolumeM3).toBe(base.workingZoneVolumeM3) // на Vраб пусков/час не влияет
  })

  it('perMinuteRunMin вдвое больше дефолта → Vраб и hраб вдвое больше', () => {
    const base = calcPumpStationDimensions(OL3487_PEHOTNAYA.input)
    const r = calcPumpStationDimensions({ ...OL3487_PEHOTNAYA.input, perMinuteRunMin: 10 })
    expect(r.workingZoneVolumeM3).toBeCloseTo(base.workingZoneVolumeM3 * 2, 9)
    expect(r.workingZoneHeightM).toBeCloseTo(base.workingZoneHeightM * 2, 9)
  })

  it('minPumpLevelM не задан → используется дефолт 0,627 м (как в ОЛ3487/Бирюлевской)', () => {
    const { minPumpLevelM: _omit, ...rest } = OL3487_PEHOTNAYA.input
    const r = calcPumpStationDimensions(rest)
    expect(r.heightMm).toBe(OL3487_PEHOTNAYA.realNpodzMm) // дефолт совпал со значением в этом листе
  })
})

// ─── 8. Валидация обязательных параметров ──

describe('валидация обязательных параметров', () => {
  it('inletPipeHeightM < 0 → бросает ошибку', () => {
    expect(() =>
      calcPumpStationDimensions({ inletPipeHeightM: -1, mvkRequired: false, capacityM3h: 10 }),
    ).toThrow(/inletPipeHeightM/)
  })

  it('capacityM3h = 0 → бросает ошибку', () => {
    expect(() =>
      calcPumpStationDimensions({ inletPipeHeightM: 5, mvkRequired: false, capacityM3h: 0 }),
    ).toThrow(/capacityM3h/)
  })

  it('capacityM3h < 0 → бросает ошибку', () => {
    expect(() =>
      calcPumpStationDimensions({ inletPipeHeightM: 5, mvkRequired: false, capacityM3h: -5 }),
    ).toThrow(/capacityM3h/)
  })
})

// ─── 9. roundUpTo — округление вверх (аналог Excel ROUNDUP(x, -2)) ──

describe('roundUpTo', () => {
  it('11530,275 → 11600 (контрольное значение ОЛ3487)', () => {
    expect(roundUpTo(11530.275162653243, 100)).toBe(11600)
  })

  it('значение ровно на границе шага остаётся без изменений', () => {
    expect(roundUpTo(11600, 100)).toBe(11600)
  })

  it('значение чуть выше границы округляется до следующего шага', () => {
    expect(roundUpTo(11600.001, 100)).toBe(11700)
  })
})
