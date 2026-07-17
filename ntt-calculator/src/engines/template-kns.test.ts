import { beforeEach, describe, expect, it } from 'vitest'
import { aggregateRows, computeEconomics, type Rates } from './economics'
import { recalcFotSatellites } from './fot'
import { computeRow } from './row'
import type { NozzleNorm } from './formulas'
import { computeDepth, PN_SURVEY_DEFAULT, snByDepth } from './survey-kns'
import {
  __resetIds,
  flattenRows,
  KNS_SECTIONS,
  materializeKns,
  sectionEnabledFor,
  type KnsSurveyParams,
  type MaterializeContext,
} from './template-kns'

// ─── Заглушка справочников (движок чист от БД) ──────────────────────────────

/**
 * Заглушка прайса — наименования и категории ДОСЛОВНО из настоящего НН
 * (`prisma/seed-data/prices.json`). Выдуманные имена дали бы зелёный тест при
 * красных строках в реальном приложении: ключ прайса — тройка (категория,
 * наименование, ЕИ), и любое расхождение = промах.
 *
 * Категории «Насосы, АТМ» и «Шкафы» в НН пусты (0 позиций) — насосы и ШУ
 * подбираются под проект, их строки «красные» намеренно.
 */
const PRICES: Record<string, number> = {
  'ФОТ|ФОТ|чел. ч': 1207.8,
  'Собственное производство|Придание изделию товарного вида|чел. ч': 1207.8,
  'Собственное производство|Прорезка отверстия под гильзу входящего патрубка|чел. ч': 1207.8,
  'Собственное производство|Прорезка отверстия под гильзу напорного патрубка (ов)|чел. ч': 1207.8,
  'Собственное производство|Монтаж теплоизоляции|чел. ч': 1207.8,
  'Собственное производство|Монтаж Поплавковых выключателей|чел. ч': 1207.8,
  'Собственное производство|Механическое формованное дно|кг': 214.4,
  'Собственное производство|Ламинирование дна к фальшполу|кг': 310.2,
  'Собственное производство|Защитный слой ламинации 5 мм на теплоизоляцию|кг': 310.2,
  'Собственное производство|Формовка гильз|кг': 310.2,
  'Прочие материалы|Теплоизоляция - Изофом ППЭ ОР 15 1,5х40|м²': 750,
  'Запорная арматура|Задвижка чугунная клиновая металл/металл DN250 PN10/16 клин бронза|шт': 25000,
  'Прочее оборудование|Кран шаровой DN150|шт': 12000,
  'Выключатели|ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ  КАБЕЛЬ 10 М|шт': 6000,

  // Разделы 2–6
  'Собственное производство|Изготовление Лестницы|чел. ч': 1207.8,
  'Собственное производство|Монтаж Лестницы|чел. ч': 1207.8,
  'Собственное производство|Механическая формовка верхнего перекрытия|кг': 214.4,
  'Собственное производство|Ламинирование верхнего перекрытия|кг': 310.2,
  'Собственное производство|Прорезка люков (горловин) в стеклокомпозитном перекрытии|чел. ч': 1207.8,
  'Собственное производство|Монтаж анкерных болтов к плите перекрытия|чел. ч': 1207.8,
  'Метизы|Анкерный болт распорный 16х100|шт': 150,
  'Детали труб_да ПЭ ПВХ PPR|Дефлектор ПВХ Ду110|шт': 600,
  'Собственное производство|Прорезка отверстия вентиляции в перекрытии|чел. ч': 1207.8,
  'Собственное производство|Монтаж вентиляционного стояка|чел. ч': 1207.8,
  'Собственное производство|Изготовление направляющих насосов|чел. ч': 1207.8,
  'Собственное производство|Монтаж направляющих насосов|чел. ч': 1207.8,
  'Метизы|Болт М20-6gх90.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)|шт': 270,
}

/** Реальный фрагмент справочника весов (сид из мастер-шаблона). */
const WEIGHTS: Record<string, number> = {
  '3000|0.6|10000': 970.2,
  '3000|1|10000': 947.6,
  '3000|0.6|5000': 876.7,
}

/**
 * Реальный фрагмент норм патрубков (лист «Для расчетов», строки 36–62).
 * Значения сверены с листом: DN250 -> 0,6 кг; DN400 -> 1,1 кг / фланец 4,6.
 */
const NOZZLE_NORMS: NozzleNorm[] = [
  { dn: 150, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 1.4, bolt: 'М20х90', boltCount: 8 },
  { dn: 250, odMm: null, minLengthMm: null, moldingMassKg: 0.6, h1Mm: null, s1Mm: null, flangeMassKg: 2.3, bolt: 'М24х100', boltCount: 12 },
  { dn: 400, odMm: 413.1, minLengthMm: 406, moldingMassKg: 1.1, h1Mm: 101, s1Mm: 6.8, flangeMassKg: 4.6, bolt: 'М24х100', boltCount: 16 },
]

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICES[`${c}|${n}|${u}`] ?? null,
  pipeWeightOf: (dn, pn, sn) => WEIGHTS[`${dn}|${pn}|${sn}`] ?? null,
  nozzleNormOf: (dn) => NOZZLE_NORMS.find((n) => n.dn === dn) ?? null,
  priceListVersion: 1,
}

const RATES: Rates = { fotRub: 1207.8, overheadRub: 1584.73, acetoneRub: 109.4, ppeRub: 122 }

// ─── ОЛ3487: реальные данные из сценария приёмки №2 ─────────────────────────

const depth = computeDepth({
  flow: 25.13,
  flowUnit: 'l/s',
  dn: 3000,
  pumpsWorking: 2,
  inletInvertMm: 9910,
})

const OL3487: KnsSurveyParams = {
  dn: 3000,
  depthMm: depth.npodzMm!,
  pnSurvey: PN_SURVEY_DEFAULT,
  sn: snByDepth(depth.npodzMm!, { mvk: true }),
  inletDn: 250,
  inletCount: 1,
  outletDn: 150,
  outletCount: 2,
  pumpsWorking: 2,
  pumpsReserve: 1,
  valveOnInlet: true,
  emergencyPipeline: false,
  insulationEnabled: true,
  insulationDepthMm: 2000,
}

beforeEach(() => __resetIds())

describe('материализация ОЛ3487 (сценарий приёмки №2)', () => {
  it('исходные параметры ОЛ дают Нподз 11 600 и SN 10000', () => {
    expect(OL3487.depthMm).toBe(11600)
    expect(OL3487.sn).toBe(10000)
  })

  it('создаются все 7 разделов в фиксированном порядке (§9.1)', () => {
    const tree = materializeKns(ctx, OL3487)
    expect(tree.sections).toHaveLength(7)
    expect(tree.sections.map((s) => s.code)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(tree.sections.map((s) => s.title)).toEqual(KNS_SECTIONS.map((s) => s.title))
  })

  it('расчёт самодостаточен: параметры ОЛ и версия прайса зафиксированы', () => {
    const tree = materializeKns(ctx, OL3487)
    expect(tree.survey).toEqual(OL3487)
    expect(tree.priceListVersion).toBe(1)
  })

  it('все 7 разделов материализованы — пустых нет', () => {
    const tree = materializeKns(ctx, OL3487)
    for (const s of tree.sections) {
      expect(s.components.length, `раздел ${s.code} «${s.title}» пуст`).toBeGreaterThan(0)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Разделы 2–6: материализуется то, что ВЫВОДИТСЯ из ОЛ.
// ─────────────────────────────────────────────────────────────────────────────

describe('раздел 2 «Лестница» (Библиотека B1)', () => {
  const rows = materializeKns(ctx, OL3487).sections.find((s) => s.code === '2')!.components.flatMap((c) => c.rows)
  const byName = (n: string) => rows.find((r) => r.name === n)!

  it('изготовление = 1,25 × H (11,6 м) = 14,5 чел.ч', () => {
    expect(byName('Изготовление Лестницы').qtyCalc).toBeCloseTo(14.5, 6)
  })

  it('монтаж = изготовление / 2 = 7,25 чел.ч', () => {
    expect(byName('Монтаж Лестницы').qtyCalc).toBeCloseTo(7.25, 6)
  })
})

describe('раздел 3 «Перекрытие» (B2, B6)', () => {
  const rows = materializeKns(ctx, OL3487).sections.find((s) => s.code === '3')!.components.flatMap((c) => c.rows)
  const byName = (n: string) => rows.find((r) => r.name === n)!

  it('формовка перекрытия по геометрии DN3000', () => {
    const expected = Math.PI * ((3000 + 300) / 2000) ** 2 * 0.006 * 1850
    expect(byName('Механическая формовка верхнего перекрытия').qtyCalc).toBeCloseTo(expected, 6)
  })

  it('ламинирование = масса перекрытия × 3/10', () => {
    const slab = byName('Механическая формовка верхнего перекрытия').qtyCalc!
    expect(byName('Ламинирование верхнего перекрытия').qtyCalc).toBeCloseTo(slab * 0.3, 6)
  })

  it('анкеры округляются ВВЕРХ до целого: пол-анкера не бывает', () => {
    const a = byName('Анкерный болт распорный 16х100').qtyCalc!
    expect(Number.isInteger(a)).toBe(true)
    expect(a).toBeGreaterThan(0)
  })
})

describe('раздел 4 «Вентстояк» (C1)', () => {
  const rows = materializeKns(ctx, OL3487).sections.find((s) => s.code === '4')!.components.flatMap((c) => c.rows)

  it('монтаж — норматив 3 чел.ч', () => {
    expect(rows.find((r) => r.name === 'Монтаж вентиляционного стояка')!.qtyCalc).toBe(3)
  })

  it('дефлектор берёт цену из прайса', () => {
    expect(rows.find((r) => r.name === 'Дефлектор ПВХ Ду110')!.priceCatalog).toBe(600)
  })
})

describe('раздел 5 «Напорный трубопровод» (C2)', () => {
  const rows = materializeKns(ctx, OL3487).sections.find((s) => s.code === '5')!.components.flatMap((c) => c.rows)

  it('направляющие насосов — труд из «Собственного производства», не метраж', () => {
    // L × (раб + рез) × 2 = 69,6 м; норматив 0,25 чел.ч/м -> 17,4 чел.ч.
    const izg = rows.find((r) => r.name === 'Изготовление направляющих насосов')!
    expect(izg.category).toBe('Собственное производство')
    expect(izg.unit).toBe('чел. ч')
    expect(izg.qtyCalc).toBeCloseTo(17.4, 6)
  })

  // Состав ниток — 55–109 строк в реальных файлах (Реверс §4.2) и из ОЛ не
  // выводится: схема отводов и тройников там не задаётся.
  it('отводы и тройники НЕ выдумываются — их добавляет инженер', () => {
    expect(rows.some((r) => /отвод|тройник/i.test(r.name))).toBe(false)
  })
})

describe('раздел 6 «Крепёж» (C3)', () => {
  it('болты = отверстий(DN напорного) × кол-во соединений, марка из норм', () => {
    const rows = materializeKns(ctx, OL3487).sections.find((s) => s.code === '6')!.components.flatMap((c) => c.rows)
    // DN150 -> 8 отверстий, М20х90 (лист «Для расчетов»); напорных 2.
    const bolt = rows.find((r) => r.category === 'Метизы')!
    expect(bolt.qtyCalc).toBe(16)
    // Полное наименование по шаблону НН, а не краткая марка норм.
    expect(bolt.name).toBe('Болт М20-6gх90.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)')
  })

  it('без норм для DN количество не выдумывается', () => {
    // DN 175 в матрице нет.
    const rows = materializeKns(ctx, { ...OL3487, outletDn: 175 })
      .sections.find((s) => s.code === '6')!.components.flatMap((c) => c.rows)
    const bolt = rows[0]!
    expect(bolt.qtyCalc).toBeNull()
    expect(bolt.note).toContain('не найдена')
  })
})

describe('раздел 1 «Корпус»', () => {
  const tree = materializeKns(ctx, OL3487)
  const korpus = tree.sections.find((s) => s.code === '1')!
  const rows = korpus.components.flatMap((c) => c.rows)
  const byName = (n: string) => rows.find((r) => r.name === n)!

  it('труба корпуса названа по PN_ОЛ, а вес найден по PN_ТРУБЫ', () => {
    const pipe = byName('Труба СК/НПС-К 3000-0,1-10000')
    expect(pipe).toBeDefined()
    expect(pipe.qtyCalc).toBe(11.6)
    // В примечании зафиксирован автоподбор: PN_ОЛ 0,1 → PN_трубы 0,6.
    expect(pipe.note).toContain('970.2 кг/пм')
    expect(pipe.note).toContain('PN трубы 0.6')
  })

  it('труба корпуса рождается «красной»: цена договорная (Механика §5.2)', () => {
    const pipe = byName('Труба СК/НПС-К 3000-0,1-10000')
    const r = computeRow(pipe)
    expect(r.missingPrice).toBe(true)
    expect(r.sum).toBe(0)
    expect(r.qty).toBe(11.6) // количество при этом известно
  })

  it('придание товарного вида → 26,8 чел.ч', () => {
    expect(Number(byName('Придание изделию товарного вида').qtyCalc!.toFixed(1))).toBe(26.8)
  })

  it('масса формованного дна → 262,8 кг, ламинирование → 78,9 кг', () => {
    expect(Number(byName('Механическое формованное дно').qtyCalc!.toFixed(1))).toBe(262.8)
    expect(Number(byName('Ламинирование дна к фальшполу').qtyCalc!.toFixed(1))).toBe(78.9)
  })

  // Гильза в прайсе — «Формовка гильз» в КГ, а не штучная позиция.
  // Диаметр уходит в примечание, масса — ручной ввод: матрица «Для расчетов»
  // ещё не извлечена, а выдуманная масса была бы хуже пустой строки.
  it('гильзы: диаметры Ø400 (DN250) и Ø250 (DN150) — в примечаниях', () => {
    const sleeves = rows.filter((r) => r.name === 'Формовка гильз')
    expect(sleeves).toHaveLength(2)
    expect(sleeves[0]!.note).toContain('Ø400')
    expect(sleeves[1]!.note).toContain('Ø250')
  })

  // Масса гильз теперь СЧИТАЕТСЯ из норм листа «Для расчетов» (раньше была
  // ручным вводом: матрица не была извлечена).
  it('масса гильз считается из норм: Мф(Ø гильзы) × кол-во', () => {
    const sleeves = rows.filter((r) => r.name === 'Формовка гильз')
    // Подводящий DN250 -> гильза Ø400 -> Мф 1,1 кг × 1 шт.
    expect(sleeves[0]!.qtyCalc).toBeCloseTo(1.1, 6)
    // Напорный DN150 -> гильза Ø250 -> Мф 0,6 кг × 2 шт.
    expect(sleeves[1]!.qtyCalc).toBeCloseTo(1.2, 6)
  })

  it('масса гильзы берётся по диаметру ГИЛЬЗЫ, а не патрубка', () => {
    // Если бы брали по DN патрубка (250 -> 0,6), вышло бы 0,6, а не 1,1.
    const sleeve = rows.find((r) => r.name === 'Формовка гильз')!
    expect(sleeve.qtyCalc).not.toBeCloseTo(0.6, 6)
    expect(sleeve.note).toContain('Ø400')
  })

  it('ФОТ-спутник гильзы пересчитывается от её массы', () => {
    const all = recalcFotSatellites(flattenRows(tree))
    const sleeve = all.find((r) => r.name === 'Формовка гильз')!
    const fot = all.find((r) => r.kind === 'ФОТ' && r.parentId === sleeve.id)!
    // k = 1,0 (ручная формовка): ROUNDUP(1,1 × 1,0; 0,1) = 1,1
    expect(fot.qtyCalc).toBeCloseTo(1.1, 6)
  })

  // Гильза крупного патрубка выходит за сетку норм — молча не выдумываем.
  it('нет нормы для Ø гильзы → количество null и явное примечание', () => {
    // DN1000 -> гильза Ø1100, которой в матрице нет.
    const big = materializeKns(ctx, { ...OL3487, inletDn: 1000 })
    const sleeve = flattenRows(big).find((r) => r.name === 'Формовка гильз')!
    expect(sleeve.qtyCalc).toBeNull()
    expect(sleeve.note).toContain('нормы формовки для Ø1100')
  })

  it('прорезка отверстий — с наименованиями из НН', () => {
    expect(byName('Прорезка отверстия под гильзу входящего патрубка').qtyCalc).toBeGreaterThan(0)
    expect(byName('Прорезка отверстия под гильзу напорного патрубка (ов)').qtyCalc).toBeGreaterThan(0)
  })

  // Регрессия: категория «Работы» в НН ПУСТА (0 позиций из 1040) — весь труд
  // лежит в «Собственном производстве». Строка с «Работы» всегда красная.
  it('ни одна строка не использует пустую категорию «Работы»', () => {
    expect(flattenRows(tree).filter((r) => r.category === 'Работы')).toHaveLength(0)
  })

  it('теплоизоляция включена флагом ОЛ', () => {
    const ins = korpus.components.find((c) => c.nodeCode === 'A9')!
    expect(ins.enabled).toBe(true)
  })
})

describe('ФОТ-спутники материализованного дерева', () => {
  it('к каждой операции с ЕИ «кг» прикреплён спутник', () => {
    const tree = materializeKns(ctx, OL3487)
    const rows = flattenRows(tree)
    const massOps = rows.filter((r) => r.kind === 'ОПЕРАЦИЯ' && r.unit === 'кг')
    expect(massOps.length).toBeGreaterThan(0)
    for (const op of massOps) {
      expect(rows.some((r) => r.kind === 'ФОТ' && r.parentId === op.id)).toBe(true)
    }
  })

  it('после пересчёта спутники дна дают 73,6 и 44,2 чел.ч (README)', () => {
    const tree = materializeKns(ctx, OL3487)
    const rows = recalcFotSatellites(flattenRows(tree))
    const byId = new Map(rows.map((r) => [r.id, r]))

    const bottom = rows.find((r) => r.name === 'Механическое формованное дно')!
    const lamin = rows.find((r) => r.name === 'Ламинирование дна к фальшполу')!

    const fotOf = (parentId: string) => rows.find((r) => r.kind === 'ФОТ' && r.parentId === parentId)!
    expect(fotOf(bottom.id).qtyCalc).toBe(73.6)
    expect(fotOf(lamin.id).qtyCalc).toBe(44.2)
    expect(byId.size).toBe(rows.length)
  })

  it('спутники берут ставку ФОТ из прайса', () => {
    const rows = flattenRows(materializeKns(ctx, OL3487))
    for (const f of rows.filter((r) => r.kind === 'ФОТ')) {
      expect(f.priceCatalog).toBe(1207.8)
    }
  })
})

describe('раздел 7 «Оборудование» — авторасчёт арматуры', () => {
  const rows = flattenRows(materializeKns(ctx, OL3487))
  const byName = (n: string) => rows.find((r) => r.name === n)!

  it('задвижки = кол-во подводящих × флаг', () => {
    expect(byName('Задвижка чугунная клиновая металл/металл DN250 PN10/16 клин бронза').qtyCalc).toBe(1)
  })

  it('шаровые краны: 2 раб + 1 рез + 1 коллектор = 4', () => {
    expect(byName('Кран шаровой DN150').qtyCalc).toBe(4)
  })

  it('поплавки = раб + рез + 2 = 5', () => {
    expect(byName('ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ  КАБЕЛЬ 10 М').qtyCalc).toBe(5)
  })

  it('насосы = раб + рез = 3', () => {
    expect(byName('Насос (марка по подбору)').qtyCalc).toBe(3)
  })

  // В НН категория «Насосы, АТМ» пуста: насос подбирается под проект, цена
  // договорная. Красная строка — правильное поведение, как у трубы корпуса.
  it('насос рождается «красным»: в прайсе насосов нет', () => {
    expect(computeRow(byName('Насос (марка по подбору)')).missingPrice).toBe(true)
    expect(byName('Насос (марка по подбору)').note).toContain('в прайсе насосов нет')
  })
})

describe('флаги ОЛ управляют включением сборок (§9.1, Механика §7.2)', () => {
  it('выключенная теплоизоляция обнуляет строки блока, но не удаляет их', () => {
    const off = materializeKns(ctx, { ...OL3487, insulationEnabled: false })
    const ins = off.sections.find((s) => s.code === '1')!.components.find((c) => c.nodeCode === 'A9')!

    expect(ins.enabled).toBe(false)
    expect(ins.rows.length).toBeGreaterThan(0) // строки на месте — «призраки»

    const enabledFor = sectionEnabledFor(off)
    for (const r of ins.rows) {
      expect(computeRow(r, { sectionEnabled: enabledFor(r) }).qty).toBe(0)
    }
  })

  it('теплоизоляция влияет на итог', () => {
    const on = materializeKns(ctx, OL3487)
    const off = materializeKns(ctx, { ...OL3487, insulationEnabled: false })

    const costOf = (t: ReturnType<typeof materializeKns>) =>
      computeEconomics(
        aggregateRows(recalcFotSatellites(flattenRows(t)), { sectionEnabled: sectionEnabledFor(t) }),
        RATES,
      ).costRub

    expect(costOf(on)).toBeGreaterThan(costOf(off))
  })

  it('выключенный раздел целиком обнуляет свои строки', () => {
    const tree = materializeKns(ctx, OL3487)
    tree.sections.find((s) => s.code === '7')!.enabled = false

    const enabledFor = sectionEnabledFor(tree)
    const equip = tree.sections.find((s) => s.code === '7')!.components.flatMap((c) => c.rows)
    for (const r of equip) {
      expect(computeRow(r, { sectionEnabled: enabledFor(r) }).qty).toBe(0)
    }
  })
})

describe('промах справочника весов не превращается в тихий ноль', () => {
  it('DN1300 глубже 5 м: F7 → 0,4, ключа нет → вес не найден (дефект эталона)', () => {
    // План §4.1-bis B: воспроизведённый дефект первоисточника.
    const tree = materializeKns(ctx, { ...OL3487, dn: 1300, sn: 5000 })
    const pipe = flattenRows(tree).find((r) => r.name.startsWith('Труба СК/НПС-К 1300'))!

    expect(pipe.note).toContain('Вес трубы не найден')
    expect(pipe.note).toContain('PN 0.4')
  })
})

describe('экономика материализованного дерева', () => {
  it('считается сквозняком и даёт положительную цену', () => {
    const tree = materializeKns(ctx, OL3487)
    const rows = recalcFotSatellites(flattenRows(tree))
    const e = computeEconomics(aggregateRows(rows, { sectionEnabled: sectionEnabledFor(tree) }), RATES)

    expect(e.costRub).toBeGreaterThan(0)
    expect(e.salePriceRub).toBeGreaterThanOrEqual(e.costRub)
    expect(e.salePriceRub % 100).toBe(0) // округление до 100 ₽
    expect(e.hoursFittings).toBeGreaterThan(0)
    expect(e.moldingMassKg).toBeGreaterThan(0)
  })

  it('труба корпуса без цены не вносит вклад, но и не ломает итог', () => {
    const tree = materializeKns(ctx, OL3487)
    const rows = recalcFotSatellites(flattenRows(tree))
    const e = computeEconomics(aggregateRows(rows, { sectionEnabled: sectionEnabledFor(tree) }), RATES)

    expect(e.buckets['Труба, муфта']).toBe(0)
    expect(Number.isFinite(e.costRub)).toBe(true)
  })

  it('ввод цены трубы вручную поднимает корзину «Труба, муфта»', () => {
    const tree = materializeKns(ctx, OL3487)
    const rows = recalcFotSatellites(flattenRows(tree))
    const pipe = rows.find((r) => r.name.startsWith('Труба СК/НПС-К'))!
    pipe.priceManual = 50000

    const e = computeEconomics(aggregateRows(rows, { sectionEnabled: sectionEnabledFor(tree) }), RATES)
    expect(e.buckets['Труба, муфта']).toBeCloseTo(11.6 * 50000, 6)
  })
})
