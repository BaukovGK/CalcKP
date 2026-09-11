/**
 * Отпечаток встроенных узлов и шаблона изделия — страж редакций
 * (engines/builtin-revisions.ts).
 *
 * Встроенный шаблон собирается на наборе ОЛ, покрывающем ветки узлов:
 * исполнение целое и частями, корзина и дробилка, арматура и автоматика,
 * горизонтальная ёмкость с обоими типами днищ, насосы, шахта и горловина,
 * ёмкость с двумя шахтами и оборудованием из ОЛ,
 * DN вне сеток справочников. Справочники — заглушки: отпечаток не должен
 * зависеть от базы. Из результата берётся всё, что задаёт состав и
 * количество: разделы, узлы с их состоянием, строки — вид, категория,
 * наименование, ЕИ, расчётное количество, k ФОТ, корзина итогов, связь цены
 * с ОЛ. Дальше — узел каталога-образец: через него в отпечаток входит и то,
 * как код исполняет узлы технолога (формулы, наименования, условия, ФОТ).
 *
 * Не входят: цены прайса (цена — не состав), пояснения в примечаниях (текст
 * ничего не считает) и id узлов и строк.
 *
 * Изменился отпечаток — изменилось то, что код строит из ОЛ. Это новая
 * редакция встроенного шаблона, и тест builtin-revisions.test.ts требует её
 * завести.
 */

import type { DeviceType } from '@/types/device'
import { materializeNode, type NodeDefBody, type NodeParamValues } from './node-def'
import { builtinTemplate, materializeTemplate, type DeviceEnv } from './template-def'
import type { CalcComponent, CalcRowNode, CalcTree, KnsSurveyParams, MaterializeContext } from './template-kns'
import type { EmkSurveyParams, KolSurveyParams } from './template-emk-kol'

/**
 * Справочники-заглушки. Промахи расставлены намеренно: DN1300 без веса трубы,
 * гильза Ø350 без нормы, Dу1500 без Мс, DN2500 вне матрицы днищ — у узлов
 * есть ветки «нет в справочнике», и они тоже часть редакции.
 */
const CTX: MaterializeContext = {
  priceOf: () => 1,
  pipeWeightOf: (dn, pn, sn) => (dn === 1300 ? null : dn / 10 + pn + sn / 1000),
  nozzleNormOf: (dn) =>
    dn === 350
      ? null
      : { dn, odMm: null, minLengthMm: null, moldingMassKg: dn / 100, h1Mm: null, s1Mm: null, flangeMassKg: dn === 150 ? null : dn / 50, bolt: dn > 200 ? 'М24х100' : 'М20х90', boltCount: 8 },
  jointLayerMassOf: (d) => (d === 1500 ? null : d / 20),
  ellipticBottomOf: (dn, l) => (dn === 2500 ? null : { massKg: dn / 5 + l / 1000, thicknessMm: 10 }),
  priceListVersion: 1,
}

const KNS: KnsSurveyParams = {
  dn: 3000, depthMm: 11600, pnSurvey: 0.1, sn: 10000, mvk: true,
  inletDn: 250, inletCount: 1, outletDn: 150, outletCount: 2,
  pumpsWorking: 2, pumpsReserve: 1, valveOnInlet: true, emergencyPipeline: false,
  insulationEnabled: true, insulationDepthMm: 2000,
}

const EMK: EmkSurveyParams = {
  dn: 2000, volumeM3: 50, placement: 'вертикальное', installation: 'подземная', tankType: 'Накопительная',
  pnSurvey: 0.1, hasShaft: true, inletDn: 150, inletCount: 1, outletDn: 150, outletCount: 1,
  hasPumps: false, pumpsWorking: 0, pumpsReserve: 0, hasBasket: true, insulationEnabled: true, insulationDepthMm: 2000,
}

const KOL: KolSurveyParams = {
  dn: 1500, workingDepthMm: 2500, elevationMm: 200, pnSurvey: 0.1, hasNeck: true, neckHeightMm: 800, neckDiameterMm: 1000,
  inletDn: 150, inletCount: 1, outletDn: 150, outletCount: 1, hasBasket: false, underRoadway: false,
  insulationEnabled: false, insulationDepthMm: 0,
}

/** Опросные листы отпечатка: образец изделия и отличия от него по вариантам. */
const SURVEYS: { readonly [D in DeviceType]: ReadonlyArray<DeviceEnv['survey']> } = {
  KNS: [
    {},
    { pipeExecution: 'частями', pipePriceRub: 12500 },
    { hasBasket: true, inletTrayDepthMm: 4200 },
    { hasGrinder: true, inletTrayDepthMm: 4200 },
    { hasBasket: true, hasGrinder: true, inletTrayDepthMm: 5100 },
    { valveOnInlet: false, insulationEnabled: false },
    { emergencyPipeline: true, emergencyCouplingGm: 80 },
    { hasFlowMeter: true, hasControlCabinet: true, controlCabinetType: 'уличный', controlCabinetStart: 'плавный', hasPressureSensors: true, hasLevelSensor: true },
    { pumpModel: 'VSL 123', pumpPriceRub: 99000, pumpsSpare: 1, elevationMm: 500 },
    { gatesInletManual: 3, gatesPressureManual: 7, checkValvesManual: 2 },
    { dn: 1300, depthMm: 5000, sn: 5000, mvk: false, inletDn: 350, outletDn: 100, outletCount: 1, pumpsWorking: 1, pumpsReserve: 1 },
    { dn: 2000, depthMm: 7400, inletCount: 0, outletCount: 3, pumpsWorking: 3, pumpsReserve: 0 },
    { dn: 2500, depthMm: 9000, pipeExecution: 'частями' },
  ].map((v) => ({ ...KNS, ...v }) as KnsSurveyParams),
  EMK: [
    {},
    { placement: 'горизонтальное' },
    { placement: 'горизонтальное', bottomType: 'цилиндрические' },
    { placement: 'горизонтальное', dn: 2500, volumeM3: 30 },
    { hasPumps: true, pumpsWorking: 1, pumpsReserve: 1, outletCount: 2 },
    { hasShaft: false, hasBasket: false, hasLadder: false, ventilation: false, insulationEnabled: false },
    { pipeLengthMm: 6400, sn: 10000, tankType: 'Химстойкая', servicePipePriceRub: 7000, pipePriceRub: 9000, inletTrayDepthMm: 3100 },
    { placement: 'горизонтальное', installation: 'наземная', shaftDiameterMm: 1000, shaftHeightMm: 1500, hasPumps: true, pumpsWorking: 2, pumpsReserve: 1 },
    { dn: 1500, volumeM3: 10, inletCount: 0 },
    // Образец листа «Калькулятор ЕМК»: две шахты, оборудование из ОЛ.
    {
      placement: 'горизонтальное', bottomType: 'цилиндрические', dn: 3000, volumeM3: 100, shaftCount: 2, shaftHeightMm: 2000,
      inletDn: 400, inletTrayDepthMm: 2400, outletDn: 300, outletCount: 2, valveOnInlet: true,
      hasPumps: true, pumpsWorking: 1, pumpsReserve: 1, pumpModel: 'VSL 100', hasControlCabinet: true, hasLevelSensor: true,
    },
    { valveOnInlet: true, hasControlCabinet: true, shaftCount: 3 },
  ].map((v) => ({ ...EMK, ...v }) as EmkSurveyParams),
  KOL: [
    {},
    { hasNeck: false },
    { hasBasket: true, inletTrayDepthMm: 2100 },
    { hasGrinder: true, inletTrayDepthMm: 2100 },
    { insulationEnabled: true, insulationDepthMm: 1500, underRoadway: true, sn: 10000 },
    { hasLadder: false, dn: 2000, workingDepthMm: 6000, pipePriceRub: 8000, servicePipePriceRub: 5000 },
    { outletCount: 0, inletCount: 2 },
  ].map((v) => ({ ...KOL, ...v }) as KolSurveyParams),
}

/**
 * Узел каталога-образец: формулы с функциями реестра и ЕСЛИ, наименования со
 * вставками, условие строки, условие включения, операция в кг с ФОТ, пустое
 * количество, параметр по умолчанию.
 */
const SAMPLE_NODE: NodeDefBody = {
  code: 'X1',
  name: 'Образец Ø{d}',
  tag: 'конструкции обслуживания',
  params: [
    { key: 'd', label: 'DN', type: 'number', default: 2000 },
    { key: 'h', label: 'Высота', type: 'number', default: 11.6 },
    { key: 'on', label: 'Включён', type: 'bool', default: true },
    { key: 'mark', label: 'Марка', type: 'text', default: 'М-1' },
  ],
  enabledBy: 'on',
  rows: [
    { kind: 'МАТЕРИАЛ', category: 'Металлопрокат', name: 'Уголок {d / 100}х{mark}', unit: 'м', qty: 'ОКРВВЕРХ(ПИ() * d / 1000 + ladderRungPipeM(h); 1)' },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Формовка {mark}', unit: 'кг', qty: 'ЕСЛИ(d >= 2000; bottomMassKg(d); laminationMassKg(bottomMassKg(d)))', fotK: 0.56 },
    { kind: 'ОПЕРАЦИЯ', category: 'Собственное производство', name: 'Монтаж', unit: 'чел. ч', qty: 'pipePrepHours(d; h) + cutoutHours(sleeveDiameter(250); 2)', when: 'd > 1000' },
    { kind: 'МАТЕРИАЛ', category: 'Метизы', name: 'Анкер', unit: 'шт', qty: '' },
  ],
}

/** Число без двоичного хвоста: 12 значащих цифр одинаковы на любой платформе. */
const num = (n: number | null | undefined) => (n == null ? '∅' : String(Number(n.toPrecision(12))))
/** Пробелы — обычные: разрядный пробел ICU разных версий не должен менять отпечаток. */
const txt = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

function canonComponent(c: CalcComponent, out: string[]) {
  out.push(`C|${c.nodeCode ?? ''}|${txt(c.title)}|${c.enabled ? 1 : 0}|${c.enabledCalc === undefined ? '-' : c.enabledCalc ? 1 : 0}`)
  const index = new Map(c.rows.map((r, i) => [r.id, i]))
  for (const r of c.rows as CalcRowNode[]) {
    out.push(
      [
        'R', r.kind, r.category, txt(r.name), r.unit, num(r.qtyCalc), r.fotK ?? '', r.bucket ?? '',
        r.priceBinding ?? '', num(r.priceManual), r.enabled === false ? 0 : 1,
        r.parentId ? (index.get(r.parentId) ?? '?') : '',
      ].join('|'),
    )
  }
}

function canonTree(tree: CalcTree, out: string[]) {
  for (const s of tree.sections) {
    out.push(`S|${s.code}|${txt(s.title)}|${s.enabled ? 1 : 0}`)
    for (const c of s.components) canonComponent(c, out)
  }
}

/** FNV-1a, 64 бита — короткий и воспроизводимый хеш без криптографии. */
function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of new TextEncoder().encode(text)) {
    h ^= BigInt(byte)
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, '0')
}

/** Канонический текст сборки изделия — то, от чего берётся отпечаток. */
export function builtinCanon(device: DeviceType): string {
  const out: string[] = []
  const template = builtinTemplate(device)
  SURVEYS[device].forEach((survey, i) => {
    out.push(`V|${device}|${i}`)
    canonTree(materializeTemplate(CTX, { device, survey } as DeviceEnv, template), out)
  })
  const samples: NodeParamValues[] = [{}, { d: 1500, on: false, mark: 'Б' }, { d: 900, h: null }]
  for (const values of samples) {
    out.push('N')
    canonComponent(materializeNode(CTX, { body: SAMPLE_NODE }, values), out)
  }
  return out.join('\n')
}

/** Отпечаток встроенного шаблона изделия и узлов, из которых он собран. */
export function builtinFingerprint(device: DeviceType): string {
  return fnv1a64(builtinCanon(device))
}
