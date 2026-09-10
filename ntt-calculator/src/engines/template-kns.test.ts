import { beforeEach, describe, expect, it } from 'vitest'
import { aggregateRows, computeEconomics, type Rates } from './economics'
import { recalcFotSatellites } from './fot'
import { computeRow } from './row'
import type { NozzleNorm } from './formulas'
import { computeDepth, PN_SURVEY_DEFAULT, snByDepth } from './survey-kns'
import { PRESSURE_PIPE_EXTRAS, PRESSURE_PIPE_KITS } from './pressure-pipe-kit'
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
  'Запорная арматура|Задвижка чугунная клиновая металл/металл DN150 PN10/16 клин бронза|шт': 55000,
  'Запорная арматура|Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN150 PN10/16|шт': 70000,
  'Выключатели|ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ КАБЕЛЬ 10 М|шт': 6000,

  // Разделы 2–6
  'Собственное производство|Изготовление Лестницы|чел. ч': 1207.8,
  'Собственное производство|Монтаж Лестницы|чел. ч': 1207.8,
  'Собственное производство|Механическая формовка верхнего перекрытия|кг': 214.4,
  'Собственное производство|Ламинирование верхнего перекрытия|кг': 310.2,
  'Собственное производство|Прорезка люков (горловин) в стеклокомпозитном перекрытии|чел. ч': 1207.8,
  'Собственное производство|Монтаж анкерных болтов к плите перекрытия|чел. ч': 1207.8,
  'Метизы|Анкерный болт распорный 20х200|шт': 200,
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
  // DN1300 глубже 5 м: раньше ключ искался по PN 0,4 и не находился.
  '1300|0.6|5000': 166.6,
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

/** Мс при PN 4 — так справочник читают оба калькулятора эталона. */
const JOINT_LAYER_MASS: Record<number, number> = { 3000: 112, 2000: 35 }

const ctx: MaterializeContext = {
  priceOf: (c, n, u) => PRICES[`${c}|${n}|${u}`] ?? null,
  pipeWeightOf: (dn, pn, sn) => WEIGHTS[`${dn}|${pn}|${sn}`] ?? null,
  nozzleNormOf: (dn) => NOZZLE_NORMS.find((n) => n.dn === dn) ?? null,
  jointLayerMassOf: (d) => JOINT_LAYER_MASS[d] ?? null,
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
  // ОЛ3487 идёт по ТТ МВК: расчётная жёсткость 10000, в марке трубы — 12000.
  sn: snByDepth(depth.npodzMm!),
  mvk: true,
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
    const a = byName('Анкерный болт распорный 20х200').qtyCalc!
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

  // Комплект нитки берётся из эталона по DN напорного (ОЛ3487 — DN150).
  // Соотношения внутри него от заказа не зависят, поэтому считаются; якорные
  // величины — метраж, фланцы, отводы, тройники — снимаются с компоновки.
  it('нитка DN150 приходит комплектом из десяти позиций', () => {
    const kit = PRESSURE_PIPE_KITS[150]!
    for (const item of Object.values(kit)) {
      expect(rows.find((r) => r.name === item.name), item.name).toBeDefined()
    }
  })

  it('втулка, сварка и приварной фланец — по одному на нитку, труба ПЭ — 0,5 м', () => {
    const kit = PRESSURE_PIPE_KITS[150]!
    const by = (name: string) => rows.find((r) => r.name === name)!
    expect(by(kit.peSleeve.name).qtyCalc).toBe(2) // ОЛ3487: две нитки
    expect(by(kit.peWeld.name).qtyCalc).toBe(2)
    expect(by(kit.weldFlange.name).qtyCalc).toBe(2)
    expect(by(kit.pePipe.name).qtyCalc).toBe(1) // 0,5 м × 2
  })

  // Метраж, отводы и тройники лист не выводит и завод правила не дал —
  // остаются пустыми: выдуманное число хуже пустой строки.
  it('метраж, отводы и тройники — пустые: их снимают с компоновки', () => {
    const kit = PRESSURE_PIPE_KITS[150]!
    for (const item of [kit.steelPipe, kit.elbow, kit.tee]) {
      expect(rows.find((r) => r.name === item.name)!.qtyCalc, item.name).toBeNull()
    }
  })

  // Правило завода (2026-09-09): по патрубку у насоса, задвижки и обратного
  // клапана на каждый насос, два на расходомер, один на отводящий патрубок.
  // ОЛ3487: насосов 2+1, расходомера нет, отводящих 2 → 3·3 + 0 + 2 = 11.
  it('свободные фланцы считаются, а не вводятся руками', () => {
    const kit = PRESSURE_PIPE_KITS[150]!
    expect(rows.find((r) => r.name === kit.freeFlange.name)!.qtyCalc).toBe(11)
  })

  it('прокладки = фланцев + 2, борт-шайбы = фланцам', () => {
    const kit = PRESSURE_PIPE_KITS[150]!
    expect(rows.find((r) => r.name === kit.gasket.name)!.qtyCalc).toBe(13)
    expect(rows.find((r) => r.name === kit.backingRing.name)!.qtyCalc).toBe(11)
  })

  it('расходомер добавляет по два фланца на каждый отводящий', () => {
    const withMeter = materializeKns(ctx, { ...OL3487, hasFlowMeter: true })
      .sections.find((s) => s.code === '5')!
      .components.flatMap((c) => c.rows)
    // 3·3 + 2·2 + 2 = 15.
    expect(withMeter.find((r) => r.name === PRESSURE_PIPE_KITS[150]!.freeFlange.name)!.qtyCalc).toBe(15)
  })

  it('обвязка датчика давления — по комплекту на нитку', () => {
    const { threeWayValve, ballValve, unionPipe } = PRESSURE_PIPE_EXTRAS
    for (const item of [threeWayValve, ballValve, unionPipe]) {
      expect(rows.find((r) => r.name === item.name)!.qtyCalc, item.name).toBe(2)
    }
  })

  it('трудоёмкость нитки — норматив эталона 28 и 24 чел.ч', () => {
    expect(rows.find((r) => r.name === 'Изготовление напорного трубопровода')!.qtyCalc).toBe(28)
    expect(rows.find((r) => r.name === 'Монтаж напорного трубопровода')!.qtyCalc).toBe(24)
  })

  // Аварийный трубопровод — флаг ОЛ; в ОЛ3487 он выключен.
  it('аварийный трубопровод выключен флагом ОЛ, а не отсутствует', () => {
    const emergency = materializeKns(ctx, OL3487)
      .sections.find((s) => s.code === '5')!
      .components.find((c) => c.title === 'Аварийный трубопровод')!
    expect(emergency.enabled).toBe(false)

    const on = materializeKns(ctx, { ...OL3487, emergencyPipeline: true })
      .sections.find((s) => s.code === '5')!
      .components.find((c) => c.title === 'Аварийный трубопровод')!
    expect(on.enabled).toBe(true)
    expect(on.rows.find((r) => r.name === 'Гайка пожарная ГМ150')!.qtyCalc).toBe(1)
  })

  // Состав аварийной линии шире, чем в листе: завод назвал обратный клапан,
  // задвижку и два фланца сверх муфты с резьбовым патрубком.
  it('аварийная линия несёт клапан, задвижку и два фланца', () => {
    const rows2 = materializeKns(ctx, { ...OL3487, emergencyPipeline: true })
      .sections.find((s) => s.code === '5')!
      .components.find((c) => c.title === 'Аварийный трубопровод')!.rows
    expect(rows2.find((r) => r.name.startsWith('Клапан обратный'))!.qtyCalc).toBe(1)
    expect(rows2.find((r) => r.name.startsWith('Задвижка чугунная'))!.qtyCalc).toBe(1)
    expect(rows2.find((r) => r.name === PRESSURE_PIPE_KITS[150]!.freeFlange.name)!.qtyCalc).toBe(2)
  })

  // Труба аварийной линии идёт по DN напорного, а муфта — нет: её размер
  // отдельное поле ОЛ, и в прайсе он стоит от 250 до 2000 ₽.
  it('размер быстросъёмной муфты берётся из ОЛ, а не из DN напорного', () => {
    const rows80 = materializeKns(ctx, { ...OL3487, emergencyPipeline: true, emergencyCouplingGm: 80 })
      .sections.find((s) => s.code === '5')!
      .components.find((c) => c.title === 'Аварийный трубопровод')!.rows
    expect(rows80.find((r) => r.name === 'Гайка пожарная ГМ80')).toBeDefined()
    // Резьбовой патрубок под ГМ80 в прайсе не назван — не выдумываем позицию,
    // а объясняем, чему он должен удовлетворять: резьба под муфту и сварка с
    // трубой аварийной линии (её DN — напорный).
    const nozzle = rows80.find((r) => r.name.startsWith('Патрубок резьбовой'))!
    expect(nozzle.qtyCalc).toBe(1)
    expect(nozzle.note).toContain('подберите патрубок из каталога')
    expect(nozzle.note).toContain('приваривается к трубе аварийной линии DN150')
  })

  // Умолчание ГМ150 держится в обе стороны: и для новых опросных листов, и для
  // расчётов, созданных до появления поля, — там параметр приходит пустым.
  it('без указанного размера ставится ГМ150 с известным патрубком', () => {
    const rows150 = materializeKns(ctx, { ...OL3487, emergencyPipeline: true })
      .sections.find((s) => s.code === '5')!
      .components.find((c) => c.title === 'Аварийный трубопровод')!.rows
    expect(OL3487.emergencyCouplingGm).toBeUndefined()
    expect(rows150.find((r) => r.name === 'Гайка пожарная ГМ150')).toBeDefined()
    expect(rows150.find((r) => r.name.startsWith('Патрубок резьбовой М150х6'))).toBeDefined()
  })

  // DN, которого в эталоне нет, не должен молча давать пустой раздел.
  it('для диаметра без комплекта остаётся подсказка собрать нитку вручную', () => {
    const rows200 = materializeKns(ctx, { ...OL3487, outletDn: 200 })
      .sections.find((s) => s.code === '5')!
      .components.flatMap((c) => c.rows)
    const hint = rows200.find((r) => r.name.startsWith('Комплект нитки'))!
    expect(hint.qtyCalc).toBeNull()
    expect(hint.note).toContain('50, 65, 80, 150')
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

  // ОЛ3487 идёт по ТТ МВК, поэтому в МАРКЕ стоит обозначение 12000, тогда как
  // вес и трудоёмкость считаются по расчётной жёсткости 10000 — это одна труба.
  const PIPE_NAME = 'Труба СК/НПС-К 3000-0,1-12000'

  it('труба корпуса названа по PN_ОЛ, а вес найден по PN_ТРУБЫ', () => {
    const pipe = byName(PIPE_NAME)
    expect(pipe).toBeDefined()
    expect(pipe.qtyCalc).toBe(11.6)
    // В примечании зафиксирован автоподбор: PN_ОЛ 0,1 → PN_трубы 0,6.
    expect(pipe.note).toContain('970.2 кг/пм')
    expect(pipe.note).toContain('PN трубы 0.6')
  })

  it('труба корпуса рождается «красной»: цена договорная (Механика §5.2)', () => {
    const pipe = byName(PIPE_NAME)
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

  // Исполнение «целая труба» — умолчание: блок сегментов и стыков в эталоне
  // обнулён (`IF($E$14=Списки!$AI$2;0;…)`), у нас он просто не создаётся.
  // A6: фланцевый патрубок под задвижку. Масса — «Мф фланца» из норм по DN
  // ПОДВОДЯЩЕГО (номинал диктует он), а не по диаметру гильзы.
  // ОЛ3487: подводящий DN250 → Мф фланца 2,3 кг × 1 патрубок.
  it('фланец под задвижку: Мф фланца(DN подводящего) × число патрубков', () => {
    const flange = byName('Ручная формовка фланца для задвижки на подводящем трубопроводе')
    expect(flange.qtyCalc).toBeCloseTo(2.3, 6)
    // Ламинирование к корпусу — 3/10 от массы фланца.
    const lam = rows.filter((r) => r.name === 'Ламинирование патрубка к корпусу')
    expect(lam[lam.length - 1]!.qtyCalc).toBeCloseTo(0.69, 6)
  })

  it('без арматуры на подводящем узел выключен, а не отсутствует', () => {
    const off = materializeKns(ctx, { ...OL3487, valveOnInlet: false })
      .sections.find((s) => s.code === '1')!
      .components.find((c) => c.nodeCode === 'A6')!
    expect(off.enabled).toBe(false)
  })

  // Исполнение «целая труба» — умолчание: блок сегментов и стыков в эталоне
  // обнулён (`IF($E$14=Списки!$AI$2;0;…)`), у нас он просто не создаётся.
  it('целая труба: сегментов и ламинирования стыков нет', () => {
    expect(rows.find((r) => r.name === 'Ламинирование частей корпуса')).toBeUndefined()
    expect(rows.filter((r) => r.name === PIPE_NAME)).toHaveLength(1)
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

describe('раздел 1: исполнение «труба частями»', () => {
  const rows = materializeKns(ctx, { ...OL3487, pipeExecution: 'частями' })
    .sections.find((s) => s.code === '1')!
    .components.flatMap((c) => c.rows)

  // Длины сегментов эталон не выводит: раскрой зависит от того, какой отрезок
  // нашёлся на складе (строки 16 и 18 листа ждут ручного ввода).
  it('добавляются два сегмента трубы с пустым количеством', () => {
    const pipes = rows.filter((r) => r.name === 'Труба СК/НПС-К 3000-0,1-12000')
    expect(pipes).toHaveLength(3) // основная + два сегмента
    expect(pipes[1]!.qtyCalc).toBeNull()
    expect(pipes[2]!.qtyCalc).toBeNull()
    expect(pipes[1]!.note).toContain('Сегмент 2')
  })

  // Мс не выводится ни из каких габаритов — это табличная величина.
  it('ламинирование частей корпуса = Мс(Dу) из справочника', () => {
    const lam = rows.find((r) => r.name === 'Ламинирование частей корпуса')!
    expect(lam.qtyCalc).toBe(112)
    expect(lam.unit).toBe('кг')
  })

  // В эталоне у этой строки k = 1 (строка 21), а не 0,56, как у прочего
  // ламинирования, — коэффициент задан явно, не по подстроке имени.
  it('ФОТ-спутник ламинирования стыков идёт с коэффициентом 1', () => {
    const lam = rows.find((r) => r.name === 'Ламинирование частей корпуса')!
    const fot = rows.find((r) => r.kind === 'ФОТ' && r.parentId === lam.id)!
    expect(fot.fotK).toBe(1)
    // После пересчёта спутник даёт k × масса = 112 чел.ч.
    const done = recalcFotSatellites(rows)
    expect(done.find((r) => r.id === fot.id)!.qtyCalc).toBeCloseTo(112, 6)
  })

  it('промах справочника не выдумывает массу, а просит ввести вручную', () => {
    const lam = materializeKns(ctx, { ...OL3487, dn: 1234, pipeExecution: 'частями' })
      .sections.find((s) => s.code === '1')!
      .components.flatMap((c) => c.rows)
      .find((r) => r.name === 'Ламинирование частей корпуса')!
    expect(lam.qtyCalc).toBeNull()
    expect(lam.note).toContain('введите вручную')
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
  // Строго раздел 7: те же наименования задвижки и обратного клапана есть и в
  // аварийной линии (раздел 5), и поиск по всему дереву нашёл бы её первой.
  const rows = materializeKns(ctx, OL3487)
    .sections.find((s) => s.code === '7')!
    .components.flatMap((c) => c.rows)
  const byName = (n: string) => rows.find((r) => r.name === n)!

  it('задвижки = кол-во подводящих × флаг', () => {
    expect(byName('Задвижка чугунная клиновая металл/металл DN250 PN10/16 клин бронза').qtyCalc).toBe(1)
  })

  // Схема завода: задвижка на стояке каждого установленного насоса плюс по
  // задвижке на отводящий патрубок. ОЛ3487: 3 насоса + 2 отводящих = 5.
  it('задвижки напорной стороны: 3 насоса + 2 отводящих = 5', () => {
    expect(byName('Задвижка чугунная клиновая металл/металл DN150 PN10/16 клин бронза').qtyCalc).toBe(5)
  })

  it('обратные клапаны — по одному на установленный насос = 3', () => {
    const name = 'Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN150 PN10/16'
    expect(byName(name).qtyCalc).toBe(3)
  })

  // Итог по всей станции сходится с полем ОЛ «Количество задвижек» = 7:
  // 5 напорных + 1 на подводящем + 1 на аварийной линии.
  it('всего задвижек с подводящей и аварийной — 7, как в опросном листе', () => {
    const all = flattenRows(materializeKns(ctx, { ...OL3487, emergencyPipeline: true }))
      .filter((r) => r.name.startsWith('Задвижка чугунная'))
      .reduce((n, r) => n + (r.qtyCalc ?? 0), 0)
    expect(all).toBe(7)
  })

  // Дефект: ОЛ показывал ручную цифру в итоге блока арматуры, а материализация
  // её не читала и пересчитывала заново — расчёт расходился с ОЛ.
  it('ручные количества арматуры из ОЛ становятся расчётными количествами строк', () => {
    const rows7 = materializeKns(ctx, { ...OL3487, gatesInletManual: 2, gatesPressureManual: 7, checkValvesManual: 4 })
      .sections.find((s) => s.code === '7')!
      .components.flatMap((c) => c.rows)
    const by = (n: string) => rows7.find((r) => r.name === n)!

    const inlet = by('Задвижка чугунная клиновая металл/металл DN250 PN10/16 клин бронза')
    expect(inlet.qtyCalc).toBe(2)
    // Расчётное не теряется: оно в примечании, рядом с пометкой о ручном вводе.
    expect(inlet.note).toContain('задано в ОЛ вручную: 2')
    expect(inlet.note).toContain('расчётное 1')

    expect(by('Задвижка чугунная клиновая металл/металл DN150 PN10/16 клин бронза').qtyCalc).toBe(7)
    expect(by('Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN150 PN10/16').qtyCalc).toBe(4)
    // Канал ручного override самого расчёта остаётся свободным.
    expect(inlet.qtyManual).toBeNull()
  })

  it('пустые ручные количества — расчётные, как раньше', () => {
    const rows7 = materializeKns(ctx, { ...OL3487, gatesInletManual: null, checkValvesManual: undefined })
      .sections.find((s) => s.code === '7')!
      .components.flatMap((c) => c.rows)
    expect(rows7.find((r) => r.name.startsWith('Клапан обратный'))!.qtyCalc).toBe(3)
    expect(rows7.find((r) => r.name.includes('DN250'))!.note).not.toContain('вручную')
  })

  it('поплавки = раб + рез + 2 = 5', () => {
    expect(byName('ПОПЛАВКОВЫЙ ВЫКЛЮЧАТЕЛЬ КАБЕЛЬ 10 М').qtyCalc).toBe(5)
  })

  it('насосы = раб + рез = 3', () => {
    expect(byName('Насос (марка по подбору)').qtyCalc).toBe(3)
  })

  // Цены нет ни в прайсе, ни в ОЛ — строка «красная», как у трубы корпуса без
  // цены: выпустить КП с заниженным итогом гейт не даст.
  it('насос без цены в прайсе и в ОЛ — «красный»', () => {
    expect(computeRow(byName('Насос (марка по подбору)')).missingPrice).toBe(true)
  })

  // Цена марки — позиция прайса «Насосы, АТМ | Насос <марка> | шт»: её вносит
  // закупка, и строка подхватывает её так же, как любую другую цену.
  it('цена насоса берётся из прайса по марке', () => {
    const model = 'Vandjord VSL.80.37.4.5.0D'
    const priced = { ...ctx, priceOf: (c: string, n: string, u: string) =>
      c === 'Насосы, АТМ' && n === `Насос ${model}` && u === 'шт' ? 310_000 : ctx.priceOf(c, n, u) }
    const pump = flattenRows(materializeKns(priced, { ...OL3487, pumpModel: model }))
      .find((r) => r.name === `Насос ${model}`)!
    expect(pump.priceCatalog).toBe(310_000)
    expect(computeRow(pump).missingPrice).toBe(false)
  })

  // Поле ОЛ «Цена насоса» перекрывает прайс и связано со строкой: правка
  // цены в расчёте вернётся в ОЛ (stores/calcTree.ts, boundPricesPatch).
  it('цена насоса из ОЛ становится ручной ценой связанной строки', () => {
    const pump = flattenRows(materializeKns(ctx, { ...OL3487, pumpPriceRub: 285_000 }))
      .find((r) => r.name === 'Насос (марка по подбору)')!
    expect(pump.priceManual).toBe(285_000)
    expect(pump.priceBinding).toBe('pumpPrice')
    expect(computeRow(pump).priceOverridden).toBe(true)
  })

  // Марка приходит из подбора по притоку и напору (/api/pump-station/select-pump)
  // либо вводится вручную. Без неё в КП уходила бы строка «Насос (марка по
  // подбору)», по которой заказчику нечего согласовывать.
  it('подобранная марка попадает в наименование строки насоса', () => {
    const tree = materializeKns(ctx, { ...OL3487, pumpModel: 'Vandjord VSL.80.37.4.5.0D' })
    const rows = flattenRows(tree)
    const pump = rows.find((r) => r.category === 'Насосы, АТМ')!

    expect(pump.name).toBe('Насос Vandjord VSL.80.37.4.5.0D')
    expect(pump.qtyCalc).toBe(3)
    // Цена всё равно договорная: позиций насосов в прайсе нет.
    expect(computeRow(pump).missingPrice).toBe(true)
    expect(pump.note).not.toContain('марка не подобрана')
  })

  it('без марки строка называется обобщённо и сама просит уточнения', () => {
    const pump = flattenRows(materializeKns(ctx, OL3487)).find((r) => r.category === 'Насосы, АТМ')!

    expect(pump.name).toBe('Насос (марка по подбору)')
    expect(pump.note).toContain('марка не подобрана')
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
  // Регрессия на закрытый дефект эталона: ветка «DN1300 + SN 5000 → PN 0,4»
  // вела в несуществующий ключ таблицы весов на ОБЫЧНОМ изделии. Завод
  // подтвердил (2026-09-09), что у труб классы 0,1 и 0,4 идентичны 0,6, —
  // теперь ключ ищется по 0,6 и находится.
  it('DN1300 глубже 5 м находит вес: ключ 0,6, а не несуществующий 0,4', () => {
    const tree = materializeKns(ctx, { ...OL3487, dn: 1300, sn: 5000 })
    const pipe = flattenRows(tree).find((r) => r.name.startsWith('Труба СК/НПС-К 1300'))!
    expect(pipe.note).toContain('166.6 кг/пм')
    expect(pipe.note).toContain('PN трубы 0.6')
  })

  // Сам механизм «промах не даёт тихого нуля» проверяем на диаметре, которого
  // в заглушке справочника нет вовсе.
  it('чего нет в справочнике — то «красная» строка с явным примечанием', () => {
    const tree = materializeKns(ctx, { ...OL3487, dn: 1234 })
    const pipe = flattenRows(tree).find((r) => r.name.startsWith('Труба СК/НПС-К 1234'))!
    expect(pipe.note).toContain('Вес трубы не найден')
    expect(pipe.qtyCalc).not.toBeNull() // количество известно, неизвестен вес
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

describe('раздел 1: корзина и дробилка (D3, D4)', () => {
  const korpus = (p: Partial<KnsSurveyParams>) =>
    materializeKns(ctx, { ...OL3487, ...p }).sections.find((s) => s.code === '1')!.components
  const byTitle = (list: ReturnType<typeof korpus>, t: string) => list.find((c) => c.title.startsWith(t))

  // Раньше у КНС корзины не было вовсе: тумблер ОЛ ни на что не влиял.
  it('оба узла живут в «Корпусе» и включаются полем ОЛ', () => {
    const list = korpus({ hasBasket: true, hasGrinder: false, inletTrayDepthMm: 9910 })
    expect(byTitle(list, 'Корзина сороудерживающая')?.enabled).toBe(true)
    // Невыбранный узел — «призрак»: строки есть, в итог не входят.
    const grinder = byTitle(list, 'Дробилка')!
    expect(grinder.enabled).toBe(false)
    expect(grinder.rows.length).toBeGreaterThan(0)
  })

  it('цепь корзины — от глубины лотка подводящего', () => {
    const basket = byTitle(korpus({ hasBasket: true, inletTrayDepthMm: 9910 }), 'Корзина')!
    expect(basket.rows.find((r) => r.name.startsWith('Цепь'))?.qtyCalc).toBe(11)
  })

  it('расчёты без полей корзины собираются с выключенными узлами', () => {
    const list = korpus({})
    expect(byTitle(list, 'Корзина')?.enabled).toBe(false)
    expect(byTitle(list, 'Дробилка')?.enabled).toBe(false)
  })

  it('узлы, включаемые из ОЛ, помнят его ответ', () => {
    const list = korpus({ hasBasket: true, valveOnInlet: false, insulationEnabled: true })
    expect(byTitle(list, 'Корзина')?.enabledCalc).toBe(true)
    expect(byTitle(list, 'Фланцевый патрубок')?.enabledCalc).toBe(false)
    expect(byTitle(list, 'Теплоизоляция')?.enabledCalc).toBe(true)
    // Обечайка от ОЛ не включается — пометки у неё нет.
    expect(byTitle(list, 'Обечайка')?.enabledCalc).toBeUndefined()
  })
})
