/**
 * Наименование и комплектация изделия для КП — сборка из опросного листа.
 *
 * Тесты держат три вещи: строка изделия собрана по шаблону эталона
 * (`doc/Эталон_КП_разбор.md` §5), количества узлов берутся из ответов листа, а
 * неполный лист даёт короткое описание, а не «не менее null мм».
 */
import { describe, expect, it } from 'vitest'
import { buildProductDraft } from './kp-kit'
import { conformityText, productDescription, productHeadline, TU_BY_DEVICE } from './kp-product'

/** Опросный лист КНС в том виде, в каком его сохраняет экран ОЛ. */
function knsSurvey(over: Record<string, unknown> = {}, derivedOver: Record<string, unknown> = {}) {
  return {
    form: {
      tipNs: 'Канализационная',
      dn: '3000',
      vozv: '300',
      mvk: false,
      insulation: true,
      tiGlubina: '2000',
      podvMat: 'ПЭ',
      podvDn: '250',
      podvKol: '1',
      napMat: 'ПЭ',
      napDn: '150',
      napKol: '2',
      emergency: false,
      muftaGm: '150',
      rashod: '25,13',
      rashodUnit: 'l/s',
      napor: '12,9',
      nRab: '2',
      nRez: '1',
      nZap: '0',
      marka: '',
      vzryv: false,
      drobilka: 'корзина',
      shu: true,
      shuTip: 'уличный',
      shuPusk: 'плавный',
      datchikiDavl: true,
      datchikiUrov: true,
      rashodomer: true,
      ...over,
    },
    derived: {
      npodzMm: 11600,
      fullHeightMm: 11900,
      sn: 10000,
      pn: 0.1,
      gates: 1,
      balls: 3,
      checkValves: 2,
      pumpModel: 'VSL.100.55.4.5.0D',
      ...derivedOver,
    },
  }
}

const names = (kit: Array<{ name: string }>) => kit.map((i) => i.name)
const find = (kit: Array<{ name: string; qty: number; unit: string }>, part: string) =>
  kit.find((i) => i.name.includes(part))

describe('КНС: строка изделия', () => {
  it('собирает заголовок по шаблону эталона', () => {
    const { spec } = buildProductDraft('KNS', knsSurvey(), { wallMm: 55.1 })
    const head = productHeadline(spec)

    expect(head).toContain('Стеклокомпозитная канализационная насосная станция')
    expect(head).toContain('GRP')
    expect(head).toContain(TU_BY_DEVICE.KNS)
    expect(head).toContain('производительностью 25,13 л/с')
    expect(head).toContain('диаметром DN 3 000 мм')
    expect(head).toContain('высотой Hполная=11 900 мм')
    expect(head).toContain('Hподзем=11 600 мм')
    expect(head).toContain('жесткость корпуса не менее SN10000')
    expect(head).toContain('с толщиной стенки не менее 55,1 мм')
    expect(head.endsWith('.')).toBe(true)
  })

  it('по ТТ МВК печатает обозначение жёсткости, а не саму жёсткость', () => {
    const { spec } = buildProductDraft('KNS', knsSurvey({ mvk: true }), {})
    expect(productHeadline(spec)).toContain('SN12000')
  })

  it('не печатает характеристики, которых нет в листе', () => {
    const head = productHeadline(buildProductDraft('KNS', {}, {}).spec)

    expect(head).not.toMatch(/null|undefined|NaN/)
    expect(head).not.toContain('толщиной стенки')
    expect(head).not.toContain(',,')
  })
})

describe('КНС: комплектация', () => {
  const { kit } = buildProductDraft('KNS', knsSurvey(), { wallMm: 55.1 })

  it('первым узлом — корпус с характеристиками и утеплением', () => {
    expect(kit[0]?.name).toContain('Стеклокомпозитный корпус')
    expect(kit[0]?.name).toContain('D=3 000 мм')
    expect(kit[0]?.name).toContain('жесткость не менее SN 10000')
    expect(kit[0]?.name).toContain('толщина стенки не менее 55,1 мм')
    expect(kit[0]?.name).toContain('с утеплением на глубину 2 000 мм')
    expect(kit[0]?.qty).toBe(1)
  })

  it('гильзы — по числу патрубков каждой стороны', () => {
    expect(find(kit, 'подводящего патрубка DN 250')?.qty).toBe(1)
    expect(find(kit, 'напорного патрубка DN 150')?.qty).toBe(2)
  })

  it('насосы, направляющие, муфты и цепи — по числу насосов', () => {
    const pump = find(kit, 'Насос погружной')
    expect(pump?.name).toContain('VSL.100.55.4.5.0D')
    expect(pump?.name).toContain('Q=25,13 л/с')
    expect(pump?.name).toContain('H=12,9 м')
    expect(pump?.name).toContain('2 раб., 1 рез.')
    expect(pump?.qty).toBe(3)
    expect(find(kit, 'Направляющие для насосов')?.qty).toBe(3)
    expect(find(kit, 'Автоматическая трубная муфта DN 150')?.qty).toBe(3)
    expect(find(kit, 'Цепь из нержавеющей стали')?.qty).toBe(3)
  })

  it('напорный трубопровод несёт количества арматуры из листа', () => {
    const pipe = find(kit, 'Напорный трубопровод')
    expect(pipe?.name).toContain('DN 150')
    expect(pipe?.name).toContain('задвижками 3 шт.')
    expect(pipe?.name).toContain('обратными клапанами 2 шт.')
    expect(find(kit, 'Задвижка на подводящем')?.qty).toBe(1)
  })

  it('включает вентиляцию, люк, лестницу, корзину, датчики, шкаф и крепление', () => {
    const all = names(kit).join('\n')
    expect(all).toContain('Люк стеклокомпозитный')
    expect(all).toContain('Лестница из нержавеющей стали')
    expect(all).toContain('Система вентиляции с дефлектором ПВХ Ø110 мм')
    expect(all).toContain('Корзина сороулавливающая')
    expect(all).toContain('Погружной датчик уровня')
    expect(all).toContain('Расходомер')
    expect(find(kit, 'Шкаф управления')?.name).toBe(
      'Шкаф управления уличного исполнения, с плавным пуском',
    )
    expect(all).toContain('Комплект крепления к бетонному основанию')
  })

  it('датчик давления — на каждый насос', () => {
    expect(find(kit, 'Датчик давления')?.qty).toBe(3)
  })

  it('не включает того, что в листе выключено', () => {
    const off = buildProductDraft(
      'KNS',
      knsSurvey({
        drobilka: 'нет',
        shu: false,
        datchikiDavl: false,
        datchikiUrov: false,
        rashodomer: false,
        insulation: false,
      }),
      {},
    ).kit
    const all = names(off).join('\n')

    expect(all).not.toContain('Корзина')
    expect(all).not.toContain('Шкаф управления')
    expect(all).not.toContain('Датчик давления')
    expect(all).not.toContain('Расходомер')
    expect(all).not.toContain('утеплением')
  })

  it('аварийный трубопровод — только по флагу листа, с размером муфты', () => {
    const { kit: withEmergency } = buildProductDraft('KNS', knsSurvey({ emergency: true }), {})
    expect(find(withEmergency, 'Аварийный трубопровод')?.name).toContain('ГМ-150')
    expect(find(kit, 'Аварийный')).toBeUndefined()
  })

  it('количества узлов — целые и положительные', () => {
    for (const item of kit) {
      expect(Number.isInteger(item.qty)).toBe(true)
      expect(item.qty).toBeGreaterThan(0)
      expect(item.unit).not.toBe('')
    }
  })
})

describe('Ёмкость', () => {
  const survey = {
    form: {
      tankType: 'Аккумулирующая',
      dn: '3000',
      volumeM3: '385',
      placement: 'горизонтальное',
      installation: 'подземная',
      bottomType: 'эллиптические',
      lengthManual: '55000',
      hasShaft: true,
      shaftCount: '2',
      shaftD: '1000',
      shaftH: '2300',
      hasLadder: true,
      podvDn: '400',
      podvKol: '1',
      otvDn: '400',
      otvKol: '1',
      ventilation: true,
      hasValves: false,
      grinder: 'нет',
      hasPumps: false,
      datchikiUrov: false,
      shu: false,
      insulation: false,
    },
    derived: { sn: 10000 },
  }

  it('печатает объём, длину и тип ёмкости', () => {
    const { spec } = buildProductDraft('EMK', survey, { wallMm: 55.1 })
    const head = productHeadline(spec)

    expect(head).toContain('Стеклокомпозитная аккумулирующая ёмкость')
    expect(head).toContain('объемом V=385 м³')
    expect(head).toContain('длиной L=55 000 мм')
    expect(head).toContain(TU_BY_DEVICE.EMK)
  })

  it('у горизонтальной — два днища и крепление ремнями', () => {
    const { kit } = buildProductDraft('EMK', survey, {})
    expect(find(kit, 'Днище стеклокомпозитное')?.qty).toBe(2)
    expect(find(kit, 'Комплект крепления')?.name).toContain('ремень стяжной')
  })

  it('у вертикальной днищ нет, крепление обычное', () => {
    const vertical = { ...survey, form: { ...survey.form, placement: 'вертикальное' } }
    const { kit, spec } = buildProductDraft('EMK', vertical, {})

    expect(find(kit, 'Днище')).toBeUndefined()
    expect(find(kit, 'Комплект крепления')?.name).not.toContain('ремень')
    expect(productHeadline(spec)).toContain('высотой H=55 000 мм')
  })

  it('шахты — по количеству из листа, с лестницей и люком', () => {
    const { kit } = buildProductDraft('EMK', survey, {})
    const shaft = find(kit, 'Шахта обслуживания')

    expect(shaft?.qty).toBe(2)
    expect(shaft?.name).toContain('DN 1 000 мм')
    expect(shaft?.name).toContain('с лестницей')
    expect(shaft?.name).toContain('с люком')
  })
})

describe('Колодец', () => {
  const survey = {
    form: {
      wellType: 'Смотровой',
      dn: '1800',
      depthMm: '8110',
      elevationMm: '200',
      hasNeck: true,
      neckD: '1200',
      neckH: '600',
      hasLadder: true,
      resin: 'Стандарт',
      podvDn: '300',
      podvKol: '1',
      otvDn: '300',
      otvKol: '1',
      hasValves: true,
      grinder: 'нет',
      datchiki: false,
      shu: false,
      insulation: false,
    },
    derived: { sn: 2500 },
  }

  it('считает полную и подземную высоту с горловиной', () => {
    const head = productHeadline(buildProductDraft('KOL', survey, { wallMm: 21.1 }).spec)

    expect(head).toContain('Стеклокомпозитный колодец смотровой')
    expect(head).toContain('Hполная=8 910 мм')
    expect(head).toContain('Hподзем=8 710 мм')
    expect(head).toContain('SN2500')
  })

  it('горловину и лестницу включает по флагам листа', () => {
    const { kit } = buildProductDraft('KOL', survey, {})
    expect(find(kit, 'Горловина')?.name).toContain('DN 1 200 мм')

    const bare = { ...survey, form: { ...survey.form, hasNeck: false, hasLadder: false } }
    const plain = buildProductDraft('KOL', bare, {}).kit
    expect(find(plain, 'Горловина')).toBeUndefined()
    expect(find(plain, 'Лестница')).toBeUndefined()
  })
})

describe('Описание целиком', () => {
  it('идёт абзацами: обозначение, заголовок, соответствие, комплектация', () => {
    const { spec, kit } = buildProductDraft('KNS', knsSurvey(), { wallMm: 55.1, tag: 'НС1' })
    const lines = productDescription(spec, kit).split('\n')

    expect(lines[0]).toBe('НС1')
    expect(lines[1]).toContain('Стеклокомпозитная канализационная насосная станция')
    expect(lines[2]).toBe(conformityText(TU_BY_DEVICE.KNS))
    expect(lines[3]).toBe('В комплекте:')
    expect(lines[4]?.startsWith('- ')).toBe(true)
    expect(lines[4]?.endsWith(';')).toBe(true)
  })

  it('абзац соответствия называет ТУ, оба ГОСТ, СП и срок службы', () => {
    const text = conformityText(TU_BY_DEVICE.EMK)

    expect(text).toContain(TU_BY_DEVICE.EMK)
    expect(text).toContain('ГОСТ Р 54560-2015')
    expect(text).toContain('ГОСТ Р ИСО 10467-2013')
    expect(text).toContain('32.13330.2018')
    expect(text).toContain('срок службы стеклокомпозитного корпуса 50 лет')
    expect(text).toContain('методом непрерывной намотки')
  })

  it('без комплектации печатает только два абзаца', () => {
    const { spec } = buildProductDraft('KOL', {}, {})
    expect(productDescription(spec, []).split('\n')).toHaveLength(2)
  })

  it('неизвестный тип изделия даёт пустой состав, а не выдуманный', () => {
    const draft = buildProductDraft('PUMP_STATION_X', {}, {})
    expect(draft.kit).toEqual([])
    expect(draft.spec.kind).toBe('Изделие из стеклокомпозита')
  })
})
