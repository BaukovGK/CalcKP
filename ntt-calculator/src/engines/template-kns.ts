/**
 * Узлы изделия КНС и типы материализованного дерева
 * (§9.1 ТЗ, Механика §7.1, Библиотека §3).
 *
 * Реальный расчёт — не свободное дерево, а шаблонная спецификация: каркас
 * задан шаблоном, количества считаются формулами из ОЛ, цены тянутся из
 * прайса, инженер точечно переопределяет (§9.1).
 *
 * КНС/ЛНС/ДНС — ОДИН шаблон: изделия конструктивно идентичны, тип НС влияет
 * на подписи и входы, не на структуру (Реверс §1).
 *
 * Здесь — узлы (обечайка, днище, патрубки, лестница, перекрытие…): каждая
 * функция `build*` строит компоненты одного узла каталога. Какие узлы в каком
 * разделе и в каком порядке, решает шаблон изделия: встроенный
 * (engines/code-nodes.ts) либо опубликованный технологом в редакторе
 * шаблонов (engines/template-def.ts). Сборку ведёт engines/materialize.ts.
 *
 * Материализация (Библиотека §6.2): вставка копирует состав в расчёт с
 * ЗАФИКСИРОВАННЫМИ расчётными значениями, применёнными ценами и
 * коэффициентами. Расчёт самодостаточен — изменения каталога и прайса влияют
 * только на новые вставки.
 */

import {
  anchorCount,
  bottomMassKg,
  cutoutHours,
  frameHours,
  knsInsulation,
  KNS_NECK_INSULATION_M2,
  LAMINATE_DENSITY,
  ladder,
  laminationMassKg,
  marketableAppearanceHours,
  pipeLengthM,
  pipePrepHours,
  pressureFlangeCount,
  topSlabMassKg,
  type NozzleNorm,
} from './formulas'
import { FOT_K_LAMIN, FOT_K_MANUAL, FOT_K_MECH } from './fot'
import type { CostBucket, TreeRates } from './economics'
import {
  DEFAULT_COUPLING_GM,
  couplingItem,
  COUPLING_NOZZLES,
  PRESSURE_PIPE_EXTRAS,
  PRESSURE_PIPE_HOURS,
  PRESSURE_PIPE_KITS,
  type KitItem,
} from './pressure-pipe-kit'
import {
  checkValveCount,
  floatSwitchCount,
  gateValveCount,
  pipeGradeName,
  pnForWeightLookup,
  pressureGateValveCount,
  sleeveDiameter,
} from './survey-kns'
import type { Category, EngineRow, PriceBinding, RowKind } from './types'
import type { CatalogNode } from './node-def'
import type { ProductTemplate } from './template-def'
import type { BasketDevice } from './basket-grinder'
import {
  buildAutomation,
  buildServiceEquipment,
  floatSwitchRow,
  STATION_WORKS,
  work,
} from './station-equipment'

// ─── Параметры ОЛ, от которых материализуется шаблон ────────────────────────

export interface KnsSurveyParams {
  /** DN корпуса, мм. */
  dn: number
  /** Глубина подземной части (Нподз), мм. */
  depthMm: number
  /** PN опросного листа (для КНС — 0,1, безнапорный). Идёт в НАИМЕНОВАНИЕ. */
  pnSurvey: number
  /** Расчётная жёсткость (5000 или 10000) — от неё вес и трудоёмкость. */
  sn: number
  /**
   * Объект по ТТ МВК: в МАРКЕ трубы жёсткость обозначается как 8000/12000
   * (та же труба плюс две нитки ровинга). На массу и габариты не влияет.
   */
  mvk?: boolean

  /** Подводящие патрубки. */
  inletDn: number
  inletCount: number
  /** Напорные патрубки. */
  outletDn: number
  outletCount: number
  /**
   * Материал подходящих труб (ОЛ «Материал»). Стеклокомпозитная труба
   * заводится внутрь станции через муфту — она ставится вместо гильзы и
   * ламинируется к корпусу, прочие — через гильзу (уточнение завода
   * 11.09.2026, `grpNozzleOf`). Пусто — гильза.
   */
  inletMaterial?: PipeMaterial | null
  outletMaterial?: PipeMaterial | null

  pumpsWorking: number
  pumpsReserve: number
  /**
   * Запасные насосы на склад (ОЛ, «запасных на склад»): входят в
   * спецификацию насосов, но не в монтаж, обвязку и такелаж — в станции
   * их нет. Пусто — ноль.
   */
  pumpsSpare?: number
  /**
   * Возвышение корпуса над землёй, мм (ОЛ, E25). Вместе с подземной частью
   * даёт высоту станции (`H5` листа): от неё цепь подъёма насосов, высота
   * тали и длина кабеля поплавков и датчиков. Пусто — ноль.
   */
  elevationMm?: number
  /**
   * Марка насоса: подобрана сервером по притоку, напору и числу рабочих
   * (`/api/pump-station/select-pump`) либо введена инженером вручную.
   *
   * Пусто — подбор не дал результата или поля ОЛ не заполнены; тогда строка
   * называется обобщённо и требует ручного уточнения перед выпуском КП.
   */
  pumpModel?: string | null

  /**
   * Количества арматуры, заданные в ОЛ вручную («изменить вручную» у блока
   * арматуры). Пусто — расчётное. Раньше ОЛ показывал ручную цифру в итоге
   * блока, а материализация её не читала и пересчитывала заново: расчёт
   * расходился с тем, что инженер видел и вводил в ОЛ.
   */
  gatesInletManual?: number | null
  gatesPressureManual?: number | null
  checkValvesManual?: number | null
  /** Аварийный трубопровод. */
  emergencyPipeline: boolean
  /**
   * Размер быстросъёмной муфты аварийной линии, ГМ.
   *
   * Муфта приваривается к трубопроводу, наружу торчит только ответная часть
   * под подключение машины. Сам аварийный трубопровод идёт тем же DN, что
   * напорный, а муфта — нет: ею определяется, чем подключатся. В прайсе
   * ГМ50…ГМ150 с разбросом цены в восемь раз, поэтому размер задаётся в ОЛ.
   */
  emergencyCouplingGm?: number
  /**
   * Расходомер на напорной линии (флаг ОЛ, блок автоматики).
   *
   * Влияет не только на сам прибор: расходомер врезается в разрыв нитки и
   * требует двух фланцевых патрубков — см. `pressureFlangeCount`.
   */
  hasFlowMeter?: boolean
  /**
   * Блок «Автоматика» ОЛ: шкаф управления (исполнение и пуск идут в его
   * наименование), датчики давления — по одному на напорный патрубок,
   * погружной датчик уровня — один с защитным футляром. Пусто — узлы
   * собираются выключенными «призраками».
   */
  hasControlCabinet?: boolean
  controlCabinetType?: string | null
  controlCabinetStart?: string | null
  hasPressureSensors?: boolean
  hasLevelSensor?: boolean

  /** Теплоизоляция и её глубина, мм. */
  insulationEnabled: boolean
  insulationDepthMm: number

  /**
   * Корзина и дробилка — поле ОЛ «Наличие дробилки/корзины для мусора»
   * (лист, E46). Стор выводит оба признака из этого поля всегда; пустыми
   * они бывают только при прямом вызове движка — тогда узлы собираются
   * выключенными «призраками».
   */
  hasBasket?: boolean
  hasGrinder?: boolean
  /**
   * Глубина залегания подводящего трубопровода А, мм (ОЛ, E41) — от неё
   * длина цепи и направляющих корзины и дробилки.
   */
  inletTrayDepthMm?: number | null

  /**
   * Исполнение корпуса (лист КНС, ячейка E14 — «Списки»!AI2/AI3).
   *
   * `целая` — обечайка из одной трубы, так делается по умолчанию.
   * `частями` — труба режется на сегменты и сваривается на месте: добавляются
   * сегменты со своим приданием товарного вида и ламинирование стыков.
   * В эталоне весь этот блок обнуляется при «целой трубе»
   * (`IF($E$14=Списки!$AI$2;0;…)` в строках 18–21).
   */
  pipeExecution?: 'целая' | 'частями'

  /**
   * Цена трубы корпуса, ₽ за метр погонный — поле ОЛ.
   *
   * Цена трубы договорная, в прайсе её нет; раньше она вводилась только в
   * расчёте, строкой «красной» до ввода. Теперь её дают в ОЛ, и она
   * связана с ценой строки трубы в обе стороны (`priceBinding`).
   */
  pipePriceRub?: number | null
  /**
   * Цена насоса, ₽ за штуку — поле ОЛ. Пусто — берётся цена марки из прайса
   * (категория «Насосы, АТМ»), а если нет и её, строка «красная».
   */
  pumpPriceRub?: number | null

  /** Кол-во корпусов (тираж). */
  tirage?: number
}

/**
 * Цена из поля ОЛ для связанной строки (см. EngineRow.priceBinding).
 *
 * Значение поля становится ручной ценой. Пустое, нулевое или нечисловое
 * поле цену не задаёт: остаётся каталожная, а без неё строка «красная» —
 * так же, как до появления поля.
 */
export function boundPrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Категория прайса, в которой живут цены насосов. */
export const PUMP_PRICE_CATEGORY = 'Насосы, АТМ'

/**
 * Наименование строки насоса — оно же имя позиции прайса с его ценой.
 * Одна функция на оба места: разойдись они на символ — цена не нашлась бы.
 */
export function pumpRowName(model: string | null | undefined): string {
  return model ? `Насос ${model}` : 'Насос (марка по подбору)'
}

/** Связать цену строки с полем ОЛ: пометка связи и цена из поля. */
export function bindPrice(row: CalcRowNode, binding: PriceBinding, value: number | null | undefined): CalcRowNode {
  return { ...row, priceBinding: binding, priceManual: boundPrice(value) }
}

// ─── Материализованное дерево (Библиотека §6.3) ─────────────────────────────

export interface CalcRowNode extends EngineRow {
  /** Явная корзина итогов, если по ЕИ неотличима (труба/муфта). */
  bucket?: CostBucket
  /**
   * Строка добавлена инженером вручную. Строки шаблона удалять нельзя —
   * только выключать; удалять можно лишь добавленные (Механика §12.5).
   */
  isCustom?: boolean
}

/**
 * Ручная правка, которую пересборка не смогла перенести: узла или строки в
 * свежем дереве нет (План_устранения, 1.1). Прежде такие правки пропадали
 * молча; теперь они копятся в дереве и видны инженеру списком, пока он их не
 * вернёт строкой вручную или не уберёт.
 */
export interface LostEdit {
  /** Раздел и узел прежнего дерева — где была правка. */
  section: string
  component: string
  /** Строка с правками; нет — правка узла целиком. */
  row?: {
    kind: RowKind
    category: Category
    name: string
    unit: string
    qtyManual?: string | number | null
    priceManual?: number | null
    /** Строку выключили вручную. */
    disabled?: boolean
  }
  /** Узел был выключен вручную, а в свежем дереве его нет. */
  componentDisabled?: boolean
}

export interface CalcComponent {
  id: string
  /** Код узла каталога (A1…D5) — справочно, для аудита состава. */
  nodeCode?: string
  /**
   * Версия узла каталога, из которой собран компонент, — у узлов, заведённых
   * технологом в редакторе шаблонов (engines/node-def.ts). У встроенных узлов
   * версии нет: их формулы — код, и версию им задаёт релиз.
   */
  nodeVersion?: number
  title: string
  enabled: boolean
  /**
   * Что сказал ОЛ — только у узлов, включаемых его тумблером (теплоизоляция,
   * корзина, арматура на подводящем…). `enabled` — фактическое состояние:
   * инженер может переключить узел и в расчёте.
   *
   * Без этой пометки пересборка не отличала правку ОЛ от ручного
   * переключения и всегда оставляла прежнее состояние узла — выключенная
   * в ОЛ теплоизоляция продолжала считаться. Правило теперь такое:
   * сменился тумблер в ОЛ — узел берёт состояние из ОЛ; не менялся —
   * остаётся, как его оставил инженер (`stores/calcTree.ts`, reconcileTrees).
   */
  enabledCalc?: boolean
  /**
   * Ключ узла между сборками: `<узел шаблона>#<роль>`, у узла каталога —
   * `cat:<код>#<n>`. Ставит материализация (`engines/template-def.ts`,
   * materializeRef); строитель задаёт роль (`inlet`, `outlet`…), если набор
   * его компонентов зависит от ОЛ, иначе ключ — номер компонента.
   *
   * По ключу, а не по названию, пересборка переносит ручные правки
   * (`stores/calcTree.ts`, reconcileTrees): в названии — параметры ОЛ, и при
   * их смене правки узла прежде пропадали молча. Нет ключа — дерево собрано
   * до его появления, узел ищется по названию (`engines/component-key.ts`).
   */
  slot?: string
  rows: CalcRowNode[]
}

/** Состояние узла, включаемого тумблером ОЛ: фактическое и то, что сказал ОЛ. */
export function surveyToggled(on: boolean): Pick<CalcComponent, 'enabled' | 'enabledCalc'> {
  return { enabled: on, enabledCalc: on }
}

/**
 * Корзина у КНС. Корзина или дробилка есть всегда — одна из них или обе
 * (уточнение завода 11.09.2026): без того и другого — корзина, как и
 * предлагает ОЛ по умолчанию.
 */
export function knsBasketOn(s: Pick<KnsSurveyParams, 'hasBasket' | 'hasGrinder'>): boolean {
  return Boolean(s.hasBasket) || !s.hasGrinder
}

export interface CalcSection {
  id: string
  /** Номер раздела «1»…«7» — порядок фиксирован (Реверс §4.2). */
  code: string
  title: string
  enabled: boolean
  components: CalcComponent[]
}

/** Тип изделия (ТЗ §3) — определение в `types/device.ts`, здесь реэкспорт. */
export type { DeviceType } from '@/types/device'
import type { DeviceType } from '@/types/device'
import type { PipeMaterial } from '@/types/survey'

export interface CalcTree {
  deviceType: DeviceType
  /**
   * Параметры ОЛ на момент материализации — расчёт самодостаточен.
   * Тип зависит от изделия: KnsSurveyParams / EmkSurveyParams / KolSurveyParams.
   */
  survey: Record<string, unknown>
  /** Версия прайса, применённая при материализации (ТЗ §3). */
  priceListVersion: number
  /**
   * Ставки экономики того же прайса — ставятся при сборке и пересчёте по
   * прайсу (План_устранения, 1.3). Нет поля — дерево собрано до фиксации
   * ставок: оно считается по действующему прайсу до первого сохранения.
   */
  rates?: TreeRates
  /**
   * Значения справочников, прочитанные при сборке: вес трубы, нормы
   * патрубков, Мс, днища, версии узлов каталога (engines/refs-used.ts,
   * План_устранения 3.6). Нет поля — дерево собрано до 11.09.2026.
   */
  refsUsed?: Record<string, string>
  /**
   * Версия шаблона изделия, по которой собран состав: 0 — встроенный шаблон
   * из кода, N — опубликованная технологом версия. Нет поля — дерево собрано
   * до появления редактора шаблонов, то есть встроенным шаблоном своего
   * релиза.
   */
  templateVersion?: number
  /**
   * Редакция встроенного шаблона изделия — версия кода, которым собран
   * состав: формулы и состав встроенных узлов, исполнение узлов каталога
   * (engines/builtin-revisions.ts). Нет поля — дерево собрано до учёта
   * редакций.
   */
  builtinRevision?: number
  /**
   * Ручные правки, которые пересборка не смогла перенести (см. LostEdit).
   * Копятся от пересборки к пересборке, пока инженер их не разберёт.
   */
  lostEdits?: LostEdit[]
  sections: CalcSection[]
}

/**
 * Контекст материализации: справочники приходят снаружи, движок остаётся
 * чистым и тестируемым без БД.
 */
export interface MaterializeContext {
  /** Цена по тройке (категория, наименование, ЕИ). `null` — промах прайса. */
  priceOf(category: string, name: string, unit: string): number | null
  /** Вес трубы кг/пм по (DN; PN_ТРУБЫ; SN). `null` — промах справочника. */
  pipeWeightOf(dn: number, pn: number, sn: number): number | null
  /**
   * Нормы простого патрубка по DN (лист «Для расчетов»). `null` — нормы нет:
   * сетка дискретна, интерполировать нормы формовки недопустимо.
   */
  nozzleNormOf?(dn: number): NozzleNorm | null
  /**
   * Мс — масса формованных слоёв на стыке, кг, по Dу (лист «Для расчетов»,
   * J36:S143). `null` — строки нет: сетка дискретна, 1000…3000 через 100.
   *
   * Давление в ключ не входит намеренно: оба калькулятора эталона берут
   * значение при PN = 4 независимо от давления изделия. Завод подтвердил
   * (09.09.2026, Вопросы_заводу §6б): изделия безнапорные, ламинация —
   * минимально возможная, то есть нижний класс таблицы (4 атм). Минимум по
   * давлению выбирает `jointLayerIndex` (`utils/materialize-context.ts`),
   * остальные классы в БД хранятся справочно.
   */
  jointLayerMassOf?(d: number): number | null
  /**
   * Одно эллиптическое днище: масса, кг, и толщина, мм — матрица «Формовка
   * эллиптических днищ» листа «Для расчетов» по DN и длине рабочей части
   * (строки «До 3 м» … «До 12», см. matrixLengthBucketMm). `null` — ячейки
   * нет: сетка дискретна, интерполировать массу формовки нельзя.
   */
  ellipticBottomOf?(dn: number, lengthMm: number): { massKg: number; thicknessMm: number | null } | null
  /**
   * Действующий шаблон изделия — опубликованный в редакторе шаблонов.
   * `null` (или нет функции) — встроенный шаблон из кода, версия 0.
   */
  templateOf?(device: DeviceType): ProductTemplate | null
  /** Опубликованный узел каталога по коду; `null` — такого нет или он в архиве. */
  catalogNodeOf?(code: string): CatalogNode | null
  priceListVersion: number
}

/**
 * Толщина защитного слоя ламинации теплоизоляции, мм.
 *
 * У КНС — 5 мм, у ёмкости и колодца — 4 мм (листы ЕМК и колодца: 0,004·1850;
 * у КНС в листе строка названа «4 мм», а считается 0,005). В прайсе это две разные
 * позиции, и толщина входит в наименование, поэтому константа задаётся здесь,
 * а не в формуле: она нужна и для массы, и для ключа поиска цены.
 */
const INSULATION_LAYER_MM = 5

/** Высота станции, м: подземная часть плюс возвышение над землёй (`H5` листа). */
export function stationHeightM(s: Pick<KnsSurveyParams, 'depthMm' | 'elevationMm'>): number {
  return (s.depthMm + (s.elevationMm ?? 0)) / 1000
}

const fmtNum = (n: number, digits = 2) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits })

/**
 * Каркас 7 разделов КНС (§9.1 ТЗ) — разделы встроенного шаблона
 * (engines/code-nodes.ts) и заготовка дерева до первой материализации.
 */
export const KNS_SECTIONS: ReadonlyArray<{ code: string; title: string }> = [
  { code: '1', title: 'Корпус' },
  { code: '2', title: 'Лестница' },
  { code: '3', title: 'Перекрытие, площадка, несущие балки' },
  { code: '4', title: 'Вентиляционный стояк' },
  { code: '5', title: 'Напорный трубопровод' },
  { code: '6', title: 'Крепёж' },
  { code: '7', title: 'Оборудование и запорная арматура' },
]

// ─── Хелперы построения строк ───────────────────────────────────────────────

let seq = 0
/** Общий генератор id узлов: переиспользуется шаблонами ЕМК и КОЛ. */
export const nextId = (prefix: string) => `${prefix}-${(++seq).toString(36)}`

/** Сбрасывает счётчик id — только для детерминированных тестов. */
export function __resetIds(): void {
  seq = 0
}

export interface RowSpec {
  kind: EngineRow['kind']
  category: EngineRow['category']
  name: string
  unit: string
  qtyCalc: number | null
  fotK?: number
  bucket?: CostBucket
  note?: string
}

export function makeRow(ctx: MaterializeContext, spec: RowSpec): CalcRowNode {
  return {
    id: nextId('r'),
    kind: spec.kind,
    category: spec.category,
    name: spec.name,
    unit: spec.unit,
    qtyCalc: spec.qtyCalc,
    qtyManual: null,
    // Материализация ФИКСИРУЕТ применённую цену (Библиотека §6.2).
    priceCatalog: ctx.priceOf(spec.category, spec.name, spec.unit),
    priceManual: null,
    fotK: spec.fotK,
    bucket: spec.bucket,
    enabled: true,
    note: spec.note,
  }
}

/** Операция + парный ФОТ-спутник: ФОТ — производная, не отдельный ввод. */
export function operationWithFot(
  ctx: MaterializeContext,
  spec: Omit<RowSpec, 'kind'> & { fotK: number },
): CalcRowNode[] {
  const op = makeRow(ctx, { ...spec, kind: 'ОПЕРАЦИЯ' })
  const fot: CalcRowNode = {
    id: nextId('r'),
    kind: 'ФОТ',
    category: 'ФОТ',
    name: 'ФОТ',
    unit: 'чел. ч',
    qtyCalc: 0, // проставит recalcFotSatellites
    qtyManual: null,
    priceCatalog: ctx.priceOf('ФОТ', 'ФОТ', 'чел. ч'),
    priceManual: null,
    fotK: spec.fotK,
    parentId: op.id,
    enabled: true,
  }
  return [op, fot]
}

// ─── Патрубки: гильза из трубы (A5, общий узел трёх изделий) ────────────────

/** Длина гильзы из трубы на патрубок, м (листы: `0,5 × кол-во`). */
export const SLEEVE_PIPE_M = 0.5
/** От этого DN гильза — отрезок трубы, ниже — ручная формовка (листы: `IF(DN>=200; …)`). */
export const SLEEVE_PIPE_FROM_DN = 200
/** Марка трубы гильз — SN 2500 (в наименовании строк листов). */
export const SLEEVE_PIPE_SN = 2500
/** PN труб, не несущих давления, — гильз, шахты, горловины: «-0,1-» в листах. */
export const SERVICE_PIPE_PN = '0,1'

/** Труба из стеклокомпозита своего производства: цена договорная, в прайсе её нет. */
export function ownPipeRow(ctx: MaterializeContext, name: string, qtyCalc: number, note: string): CalcRowNode {
  return {
    ...makeRow(ctx, { kind: 'МАТЕРИАЛ', category: 'Собственное производство', name, unit: 'м', qtyCalc, bucket: 'Труба, муфта', note }),
    priceCatalog: null,
  }
}

/**
 * До этого DN включительно гильза формуется — «Формовка гильз» по норме Мф,
 * а не режется из трубы (уточнение 11.09.2026). Так делают гильзу, через
 * которую протягивают напорную трубу КНС, и гильзу стеклопластикового
 * патрубка ёмкости. Формованная гильза большего диаметра возможна, но пока
 * не нужна — крупнее идёт отрезок трубы. Листы здесь ставят ручную формовку
 * 0,5 кг (меньше DN 200) или отрезок трубы.
 */
export const FORMED_SLEEVE_MAX_DN = 300

/**
 * Стеклопластиковый патрубок под стеклокомпозитную трубу (уточнения завода
 * 11.09.2026): у ёмкости — гильза и фланец (`flange`), у колодца и КНС —
 * муфта вместо гильзы (`coupling`): она ламинируется к корпусу, и труба
 * заводится внутрь через неё.
 */
export type GrpNozzleJoint = 'flange' | 'coupling'

/**
 * Материал подходящей трубы, под который патрубок — стеклопластиковый: в
 * листах «Труба стеклокомпозитная».
 */
export const GRP_PIPE_MATERIAL: PipeMaterial = 'стеклокомпозит'

/**
 * Патрубок под стеклокомпозитную трубу: с фланцем — гильза до DN 300
 * включительно формуется, с муфтой — гильзы нет вовсе. Прочие материалы —
 * `null`: гильза под проход трубы, как в листах.
 */
export function grpNozzleOf(
  material: PipeMaterial | null | undefined,
  joint: GrpNozzleJoint,
): Pick<SleeveNozzle, 'formed' | 'grpJoint'> | null {
  if (material !== GRP_PIPE_MATERIAL) return null
  return joint === 'flange'
    ? { formed: { maxDn: FORMED_SLEEVE_MAX_DN, why: 'стеклопластиковый патрубок' }, grpJoint: joint }
    : { grpJoint: joint }
}

/** Патрубок изделия: заголовок узла, DN и число, наименование прорезки по прайсу. */
export interface SleeveNozzle {
  /**
   * Роль патрубка — ключ узла (CalcComponent.slot): патрубок с нулевым
   * количеством не строится, и номер компонента сдвинулся бы.
   */
  role: 'inlet' | 'outlet'
  title: string
  dn: number
  count: number
  cutoutName: string
  /**
   * Гильза формуется, а не режется из трубы: до `maxDn` включительно —
   * «Формовка гильз», масса — норма Мф по Ø гильзы × кол-во; `why` — зачем,
   * для пояснения строки. Нет — модель листа.
   */
  formed?: { maxDn: number; why: string }
  /**
   * Патрубок под стеклокомпозитную трубу (ОЛ «Материал» — стеклокомпозит),
   * он сам стеклопластиковый: `flange` — к гильзе добавляется
   * стеклокомпозитный фланец, `coupling` — вместо гильзы муфта «Муфта-2».
   */
  grpJoint?: GrpNozzleJoint
}

/**
 * Патрубки с гильзой — узел A5 трёх изделий, по их листам: КНС (строки
 * 26–30, 40–44, 87–88), ЕМК (36–46), колодец (25–34, 80–81). Считают они
 * одинаково:
 *
 * - гильза — отрезок трубы Ø гильзы (`sleeveDiameter`, эталон K8/M8), 0,5 м
 *   на патрубок, с приданием товарного вида `Ø/1300 × L`; у патрубка меньше
 *   DN 200 — «Ручная формовка патрубка», 0,5 кг на патрубок;
 * - к корпусу гильза ламинируется: `Мф(Ø гильзы) × 3/10 × кол-во`, ФОТ этого
 *   ламинирования в листах k = 1;
 * - прорезка отверстия `Ø·π/1000 × 0,5 × кол-во`; её наименование у изделий
 *   своё — у КНС «под гильзу входящего / напорного патрубка», у ёмкости и
 *   колодца «патрубка в корпусе».
 *
 * Отступления от листов — уточнения завода 11.09.2026:
 *
 * - `formed` — гильза до DN 300 включительно формуется («Формовка гильз»,
 *   Мф × кол-во, ФОТ k = 1): у напорных патрубков КНС через неё
 *   протягивается напорная труба малого диаметра, у стеклопластикового
 *   патрубка ёмкости это его гильза;
 * - `grpJoint` — патрубок под стеклокомпозитную трубу: у ёмкости к гильзе
 *   добавляется «Ручная формовка стеклокомпозитного фланца» = Мф фланца(DN)
 *   × кол-во с болтовым комплектом на каждый фланец; у колодца и КНС гильзы
 *   нет — вместо неё муфта «Муфта-2 СК/НПС-К DN-1» на патрубок (та же
 *   «Муфта-1», только без центрального ограничителя, цена договорная), и к
 *   корпусу ламинируется она: «Ламинирование проходной муфты к корпусу» —
 *   так строку называет лист колодца (строки 28, 33).
 *
 * Ламинирование к корпусу и прорезка у всех патрубков одни: норма Мф и
 * прорезка — по Ø гильзы, как в листах, и у муфты тоже.
 */
export function buildSleeveNozzles(ctx: MaterializeContext, nozzles: SleeveNozzle[]): CalcComponent[] {
  const out: CalcComponent[] = []
  for (const n of nozzles) {
    if (n.count <= 0) continue
    const sleeve = sleeveDiameter(n.dn)
    const norm = ctx.nozzleNormOf?.(sleeve) ?? null
    const lamination = norm ? laminationMassKg(norm.moldingMassKg) * n.count : null
    const sleeveM = SLEEVE_PIPE_M * n.count
    const formed = n.formed != null && n.dn <= n.formed.maxDn
    const fromPipe = !formed && n.dn >= SLEEVE_PIPE_FROM_DN
    const formedMass = norm ? norm.moldingMassKg * n.count : null

    // Муфта ставится вместо гильзы: строк гильзы у неё нет.
    const sleeveRows: CalcRowNode[] = n.grpJoint === 'coupling'
      ? []
      : formed
      ? operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Формовка гильз',
          unit: 'кг',
          qtyCalc: formedMass,
          fotK: FOT_K_MANUAL,
          note:
            formedMass == null
              ? `Гильза Ø${sleeve} × ${n.count} · нормы формовки для Ø${sleeve} в «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф(Ø${sleeve}) ${fmtNum(norm!.moldingMassKg)} кг × ${n.count} = ${fmtNum(formedMass)} кг — ${n.formed!.why}: до DN ${n.formed!.maxDn} гильза формуется`,
        })
      : fromPipe
      ? [
          ownPipeRow(
            ctx,
            `Труба СК/НПС-К ${sleeve}-${SERVICE_PIPE_PN}-${SLEEVE_PIPE_SN}`,
            sleeveM,
            `Гильза Ø${sleeve} — отрезок трубы ${fmtNum(SLEEVE_PIPE_M)} м × ${n.count} · цена трубы договорная — введите`,
          ),
          makeRow(ctx, {
            kind: 'ОПЕРАЦИЯ',
            category: 'Собственное производство',
            name: 'Придание изделию товарного вида',
            unit: 'чел. ч',
            qtyCalc: marketableAppearanceHours(sleeve, sleeveM),
            note: `ƒ Ø${sleeve}/1300 × ${fmtNum(sleeveM)} м гильз`,
          }),
        ]
      : operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ручная формовка патрубка',
          unit: 'кг',
          qtyCalc: sleeveM,
          fotK: FOT_K_MANUAL,
          note: `ƒ 0,5 кг на патрубок × ${n.count} — меньше DN ${SLEEVE_PIPE_FROM_DN} гильза формуется вручную`,
        })

    // Соединение стеклопластикового патрубка с трубой. Норма фланца — по DN
    // трубы, как у фланцевого патрубка под задвижку КНС (A6).
    const flangeNorm = n.grpJoint === 'flange' ? (ctx.nozzleNormOf?.(n.dn) ?? null) : null
    const flangeMass = flangeNorm?.flangeMassKg != null ? flangeNorm.flangeMassKg * n.count : null
    const jointRows: CalcRowNode[] =
      n.grpJoint === 'flange'
        ? [
            ...operationWithFot(ctx, {
              category: 'Собственное производство',
              name: 'Ручная формовка стеклокомпозитного фланца',
              unit: 'кг',
              qtyCalc: flangeMass,
              fotK: FOT_K_MANUAL,
              note:
                flangeMass == null
                  ? `Мф фланца для DN${n.dn} в нормах «Для расчетов» нет — введите массу вручную`
                  : `ƒ Мф фланца(DN${n.dn}) ${fmtNum(flangeNorm!.flangeMassKg!)} кг × ${n.count} = ${fmtNum(flangeMass)} кг — фланец под стеклокомпозитную трубу`,
            }),
            // Фланцевому соединению с трубой — болтовой комплект.
            ...flangeBoltRows(ctx, n.dn, n.count, `${n.count} фланц. соединений с трубой`),
          ]
        : n.grpJoint === 'coupling'
        ? [
            {
              ...makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                category: 'Собственное производство',
                name: `Муфта-2 СК/НПС-К ${n.dn}-1`,
                unit: 'шт',
                qtyCalc: n.count,
                bucket: 'Труба, муфта',
                note:
                  `Муфта под стеклокомпозитную трубу DN${n.dn} × ${n.count}: та же «Муфта-1», без центрального ` +
                  'ограничителя — труба проходит насквозь · цена договорная — введите',
              }),
              priceCatalog: null,
            },
          ]
        : []

    out.push({
      id: nextId('c'),
      nodeCode: 'A5',
      slot: n.role,
      title: `${n.title}${n.grpJoint ? ' стеклопластиковый' : ''} DN${n.dn} ×${n.count}`,
      enabled: true,
      rows: [
        ...sleeveRows,
        ...jointRows,
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          // У патрубка с муфтой лист колодца называет строку так (строки 28, 33).
          name: n.grpJoint === 'coupling' ? 'Ламинирование проходной муфты к корпусу' : 'Ламинирование патрубка к корпусу',
          unit: 'кг',
          qtyCalc: lamination,
          // В листах у этой строки k = 1 («*ламин*» → 1), а не 0,56.
          fotK: FOT_K_MANUAL,
          note:
            lamination == null
              ? `Мф для гильзы Ø${sleeve} в нормах «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф(Ø${sleeve}) ${fmtNum(norm!.moldingMassKg)} кг × 3/10 × ${n.count} = ${fmtNum(lamination)} кг`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: n.cutoutName,
          unit: 'чел. ч',
          qtyCalc: cutoutHours(sleeve, n.count),
          note: `ƒ Ø${sleeve}·π/1000 × 0,5 чел.ч × ${n.count}`,
        }),
      ],
    })
  }
  return out
}

// ─── Раздел 1: Корпус ────────────────────────────────────────────────────────

// Раздел 1 «Корпус» собирается из встроенных узлов (engines/code-nodes.ts):
// каждая функция ниже — один узел каталога (Библиотека §2), а порядок узлов
// в разделе задаёт шаблон изделия. Петли A10, дробилка D4 и корзина D3 —
// общие узлы трёх изделий (mounting-loops.ts, basket-grinder.ts).

/** A1 — обечайка корпуса; при исполнении «частями» — ещё сегменты и стыки. */
export function buildKnsShell(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const lengthM = pipeLengthM(s.depthMm)
  const components: CalcComponent[] = []

  // A1 — Обечайка корпуса.
  const pnPipe = pnForWeightLookup(s.pnSurvey, s.dn, s.sn)
  const kgPerM = ctx.pipeWeightOf(s.dn, pnPipe, s.sn)
  const pipeName = pipeGradeName(s.dn, s.pnSurvey, s.sn, { mvk: s.mvk })

  components.push({
    id: nextId('c'),
    nodeCode: 'A1',
    title: 'Обечайка корпуса',
    enabled: true,
    rows: [
      {
        ...makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Собственное производство',
          name: pipeName,
          unit: 'м',
          qtyCalc: lengthM,
          bucket: 'Труба, муфта',
          note:
            kgPerM == null
              ? `Вес трубы не найден в справочнике (DN ${s.dn}; PN ${pnPipe}; SN ${s.sn})`
              : `${kgPerM} кг/пм · PN трубы ${pnPipe} (автоподбор)`,
        }),
        // Цена трубы корпуса договорная — в прайсе её нет (Механика §5.2).
        // Её дают полем ОЛ «Цена трубы, ₽/м.п.»; пустое поле — строка
        // «красная», как и прежде.
        priceCatalog: null,
        priceBinding: 'pipePrice',
        priceManual: boundPrice(s.pipePriceRub),
      },
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        // Категория «Собственное производство», а НЕ «Работы»: в прайсе НН
        // категория «Работы» пуста (0 позиций из 1040) — весь труд лежит в
        // «Собственном производстве». Строка с «Работы» всегда была бы красной.
        category: 'Собственное производство',
        name: 'Придание изделию товарного вида',
        unit: 'чел. ч',
        qtyCalc: marketableAppearanceHours(s.dn, lengthM),
      }),
      // Транспортировка, разметка осей и шлифовка — на всю длину трубы,
      // и при исполнении «частями» тоже (лист, строка 86: `G5/(200·6)·J14`).
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)',
        unit: 'чел. ч',
        qtyCalc: pipePrepHours(s.dn, lengthM),
        note: `ƒ DN/(200·6) × L = ${s.dn}/1200 × ${fmtNum(lengthM)} м`,
      }),
    ],
  })

  // A1 (продолжение) — исполнение «труба частями»: сегменты и стыки.
  //
  // Длины сегментов эталон НЕ выводит: в листе строки 16 и 18 ждут ручного
  // ввода, потому что раскрой зависит от того, какой отрезок трубы нашёлся на
  // складе. Поэтому сегменты создаются с пустым количеством — инженер
  // разносит по ним общую длину, включая правку первой строки.
  //
  // Ламинирование стыков, наоборот, детерминировано: Мс из справочника.
  // Коэффициент ФОТ здесь 1, а не 0,56, как у прочего ламинирования, — так в
  // эталоне (строка 21: «*ламин*» → 1).
  if (s.pipeExecution === 'частями') {
    const jointMass = ctx.jointLayerMassOf?.(s.dn) ?? null
    const segmentRows: CalcRowNode[] = []

    for (const n of [2, 3]) {
      segmentRows.push(
        // Сегмент — кусок той же трубы: цена за метр у него та же, что у
        // трубы корпуса, и связана с тем же полем ОЛ.
        bindPrice(
          makeRow(ctx, {
            kind: 'МАТЕРИАЛ',
            category: 'Собственное производство',
            name: pipeName,
            unit: 'м',
            qtyCalc: null,
            bucket: 'Труба, муфта',
            note: `Сегмент ${n} — длину введите вручную, разнеся общие ${lengthM.toLocaleString('ru-RU')} м`,
          }),
          'pipePrice',
          s.pipePriceRub,
        ),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Придание изделию товарного вида',
          unit: 'чел. ч',
          qtyCalc: null,
          note: `ƒ DN/1300 × длина сегмента ${n} — введите после неё`,
        }),
      )
    }

    components.push({
      id: nextId('c'),
      nodeCode: 'A1',
      title: 'Труба частями: сегменты и стыки',
      enabled: true,
      rows: [
        ...segmentRows,
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование частей корпуса',
          unit: 'кг',
          qtyCalc: jointMass,
          fotK: FOT_K_MANUAL,
          note:
            jointMass == null
              ? `Мс для Dу ${s.dn} нет в справочнике — введите вручную`
              : `Мс из справочника f(Dу ${s.dn}) = ${jointMass} кг`,
        }),
      ],
    })
  }

  return components
}

/** A2 — днище: формованное дно и его ламинирование, каждое со своим ФОТ. */
export function buildKnsBottom(ctx: MaterializeContext, s: Pick<KnsSurveyParams, 'dn'>): CalcComponent[] {
  const bottom = bottomMassKg(s.dn)
  return [
    {
      id: nextId('c'),
      nodeCode: 'A2',
      title: 'Днище',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическое формованное дно',
          unit: 'кг',
          qtyCalc: bottom,
          fotK: FOT_K_MECH,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование дна к фальшполу',
          unit: 'кг',
          qtyCalc: laminationMassKg(bottom),
          fotK: FOT_K_LAMIN,
        }),
      ],
    },
  ]
}

/**
 * A5 — патрубки КНС: подводящие и напорные, каждый со своей гильзой
 * (`buildSleeveNozzles`; лист КНС, строки 26–30, 40–44, 87–88). У напорных
 * до DN 300 включительно гильза формуется — «Формовка гильз» по норме Мф.
 */
export function buildKnsNozzles(
  ctx: MaterializeContext,
  s: Pick<KnsSurveyParams, 'inletDn' | 'inletCount' | 'outletDn' | 'outletCount' | 'inletMaterial' | 'outletMaterial'>,
): CalcComponent[] {
  // Наименования прорезок — ДОСЛОВНО из прайса НН: ключ поиска это тройка
  // (категория, наименование, ЕИ), и любое расхождение даёт «красную» строку.
  //
  // Трубы заводятся внутрь станции через гильзу или — стеклокомпозитная —
  // через муфту, которая ставится вместо гильзы и ламинируется к корпусу;
  // фланцы стоят уже внутри: у подводящего — патрубок под задвижку (A6), у
  // напорных — стык с ниткой напорного трубопровода (C2).
  return buildSleeveNozzles(ctx, [
    {
      role: 'inlet',
      title: 'Патрубок подводящий',
      dn: s.inletDn,
      count: s.inletCount,
      cutoutName: 'Прорезка отверстия под гильзу входящего патрубка',
      ...grpNozzleOf(s.inletMaterial, 'coupling'),
    },
    {
      role: 'outlet',
      title: 'Патрубок напорный',
      dn: s.outletDn,
      count: s.outletCount,
      cutoutName: 'Прорезка отверстия под гильзу напорного патрубка (ов)',
      // Гильза под протяжку напорной трубы малого диаметра формуется.
      formed: { maxDn: FORMED_SLEEVE_MAX_DN, why: 'гильза под протяжку напорной трубы' },
      ...grpNozzleOf(s.outletMaterial, 'coupling'),
    },
  ])
}

/** Отрезок трубы фланцевого патрубка, м (лист КНС, J33: `0,3` на патрубок при DN ≥ 300). */
export const FLANGE_NOZZLE_PIPE_M = 0.3
/** От этого DN фланцевый патрубок — отрезок трубы, ниже — ручная формовка (J33). */
export const FLANGE_NOZZLE_PIPE_FROM_DN = 300
/** Стенка ручной формовки фланцевого патрубка, м (J33: `π·DN·0,005·0,3·1850`). */
const FLANGE_NOZZLE_WALL_M = 0.005

/**
 * A6 — фланцевый патрубок под задвижку на подводящем (лист КНС, строки
 * 32–38). Задвижка на подводящем у КНС есть всегда (уточнение завода
 * 11.09.2026), и патрубок под неё — тоже; флага ОЛ у него больше нет:
 *
 * - патрубок — отрезок трубы Ø гильзы 0,3 м с приданием товарного вида; у
 *   подводящего меньше DN 300 — ручная формовка `π·DN·0,005·0,3·1850` кг;
 * - «Ручная формовка фланца» — Мф фланца по DN подводящего (норма
 *   «Для расчетов»), ФОТ k = 1;
 * - «Ламинирование патрубка к корпусу» — `Мф(DN подводящего) × 3/10`, ФОТ
 *   k = 1, как в листе (строка 38).
 *
 * Прежде ламинирование считалось 3/10 от массы фланца с k = 0,56, а отрезка
 * трубы не было.
 *
 * ❗ Расхождение с эталоном (осознанное): лист ставит ДВА патрубка на каждый
 * подводящий (`I32 = 2×K5`), завод уточнил (2026-09-09) — один. Берём один.
 */
export function buildKnsInletFlange(
  ctx: MaterializeContext,
  s: Pick<KnsSurveyParams, 'inletDn' | 'inletCount'>,
): CalcComponent[] {
  // Номинал диктует подводящий патрубок: течение там безнапорное, но задвижка
  // всегда идёт с номинальным PN в наименовании. Масса ручной формовки фланца
  // и Мф ламинирования берутся из норм листа «Для расчетов» по DN, а не по
  // диаметру гильзы: формуется фланец под арматуру (строки 35 и 37).
  const n = s.inletCount
  if (n <= 0) return []
  const dn = s.inletDn
  const sleeve = sleeveDiameter(dn)
  const norm = ctx.nozzleNormOf?.(dn) ?? null
  const flangeMass = norm?.flangeMassKg != null ? norm.flangeMassKg * n : null
  const lamination = norm ? laminationMassKg(norm.moldingMassKg) * n : null
  const pipeM = FLANGE_NOZZLE_PIPE_M * n
  const moldedKg = Math.PI * (dn / 1000) * FLANGE_NOZZLE_WALL_M * FLANGE_NOZZLE_PIPE_M * LAMINATE_DENSITY * n

  const nozzleRows: CalcRowNode[] =
    dn >= FLANGE_NOZZLE_PIPE_FROM_DN
      ? [
          ownPipeRow(
            ctx,
            `Труба СК/НПС-К ${sleeve}-${SERVICE_PIPE_PN}-${SLEEVE_PIPE_SN}`,
            pipeM,
            `Фланцевый патрубок Ø${sleeve} — отрезок трубы ${fmtNum(FLANGE_NOZZLE_PIPE_M)} м × ${n} · цена трубы договорная — введите`,
          ),
          makeRow(ctx, {
            kind: 'ОПЕРАЦИЯ',
            category: 'Собственное производство',
            name: 'Придание изделию товарного вида',
            unit: 'чел. ч',
            qtyCalc: marketableAppearanceHours(sleeve, pipeM),
            note: `ƒ Ø${sleeve}/1300 × ${fmtNum(pipeM)} м`,
          }),
        ]
      : operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ручная формовка патрубка',
          unit: 'кг',
          qtyCalc: moldedKg,
          fotK: FOT_K_MANUAL,
          note: `ƒ π·DN${dn}/1000·0,005·0,3·1850 × ${n} = ${fmtNum(moldedKg)} кг — меньше DN ${FLANGE_NOZZLE_PIPE_FROM_DN} патрубок формуется вручную`,
        })

  return [
    {
      id: nextId('c'),
      nodeCode: 'A6',
      title: `Фланцевый патрубок под задвижку на подводящем DN${dn}`,
      enabled: true,
      rows: [
        ...nozzleRows,
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ручная формовка фланца для задвижки на подводящем трубопроводе',
          unit: 'кг',
          qtyCalc: flangeMass,
          // В листе у этой строки k = 1 («*руч*» → 1), а не 0,56.
          fotK: FOT_K_MANUAL,
          note:
            flangeMass == null
              ? `Мф фланца для DN${dn} в нормах «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф фланца(DN${dn}) × ${n} = ${fmtNum(flangeMass)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование патрубка к корпусу',
          unit: 'кг',
          qtyCalc: lamination,
          // Лист, строка 38: «*ламин*» → 1, а не 0,56.
          fotK: FOT_K_MANUAL,
          note:
            lamination == null
              ? `Мф для DN${dn} в нормах «Для расчетов» нет — введите массу вручную`
              : `ƒ Мф(DN${dn}) ${fmtNum(norm!.moldingMassKg)} кг × 3/10 × ${n} = ${fmtNum(lamination)} кг`,
        }),
        // Фланец патрубка стыкуется с задвижкой — болтовой комплект на
        // соединение (всем фланцевым соединениям, уточнение 11.09.2026).
        ...flangeBoltRows(ctx, dn, n, `${n} фланц. соединений с задвижкой`),
      ],
    },
  ]
}

/** A7 — кабельный ввод. */
export function buildKnsCableEntry(ctx: MaterializeContext): CalcComponent[] {
  // A7 — Кабельный ввод (лист, строки 46–48 и 89): гильза под кабели
  // ручной формовки, два гермоввода и прорезка отверстия Ø100.
  //
  // Масса гильзы в листе — 0,5 кг, если не вписана своя (`IF(H46="";0,5;…)`);
  // в образце вписано 6. Гермоввод в листе назван «Гермоввод 110
  // (комплектация 1)» — в прайсе он «для труб 89/110», той же комплектации.
  const CABLE_SLEEVE_D = 100
  return [
    {
      id: nextId('c'),
      nodeCode: 'A7',
      title: 'Кабельный ввод',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ручная формовка гильз для ввода кабелей',
          unit: 'кг',
          qtyCalc: 0.5,
          fotK: FOT_K_MANUAL,
          note: 'ƒ норма эталона 0,5 кг · в образце вписано 6 кг — уточните по чертежу',
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Прочие материалы',
          name: 'Гермоввод для труб 89/110 (комплектация 1)',
          unit: 'шт',
          qtyCalc: 2,
          note: 'ƒ два на ввод, как в эталоне',
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия под гильзу ввода кабелей',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(CABLE_SLEEVE_D, 1),
          note: `ƒ Ø${CABLE_SLEEVE_D}·π/1000 × 0,5 чел.ч`,
        }),
      ],
    },
  ]
}

/** A9 — теплоизоляция корпуса, по тумблеру ОЛ. */
export function buildKnsInsulation(
  ctx: MaterializeContext,
  s: Pick<KnsSurveyParams, 'dn' | 'insulationDepthMm' | 'insulationEnabled'>,
): CalcComponent[] {
  // A9 — Теплоизоляция: включается флагом ОЛ (Механика §7.2).
  //
  // По листу КНС (строки 58–60, 92): боковая площадь вверх до 0,01 м² плюс
  // горловины люков — константа формулы; слой ламинации и монтаж от всей
  // площади. У ёмкости и колодца горловин в формуле нет (engines/formulas.ts).
  const ins = knsInsulation(s.dn, s.insulationDepthMm, INSULATION_LAYER_MM / 1000)
  const sideM2 = ins.verticalM2 - KNS_NECK_INSULATION_M2
  return [
    {
      id: nextId('c'),
      nodeCode: 'A9',
      title: 'Теплоизоляция корпуса',
      // Выключённый узел не удаляется: строки остаются «призраками», включение
      // обратно восстанавливает всё, включая overrides (Механика §7.2).
      ...surveyToggled(s.insulationEnabled),
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Прочие материалы',
          // Наименование в НН — с префиксом «Теплоизоляция - » (750 ₽/м²).
          // README хендоффа приводит его без префикса и с ценой 890 — это данные
          // мок-прототипа, а не прайса.
          name: 'Теплоизоляция - Изофом ППЭ ОР 15 1,5х40',
          unit: 'м²',
          qtyCalc: ins.totalM2,
          note:
            `ƒ бок π·DN·h ↑0,01 (${fmtNum(sideM2)}) + горловины люков ${fmtNum(KNS_NECK_INSULATION_M2)} + ` +
            `крышка π·(DN/2)² (${fmtNum(ins.lidM2)}) = ${fmtNum(ins.totalM2)} м²`,
        }),
        // В прайсе две позиции, различающиеся толщиной слоя: «5 мм» и «4 мм».
        // Это подтверждает Реверс §4.3 (S·0,005·1850 у КНС, 0,004 у колодца) —
        // толщина зашита в наименование, поэтому имя выводится из параметра.
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: `Защитный слой ламинации ${INSULATION_LAYER_MM} мм на теплоизоляцию`,
          unit: 'кг',
          qtyCalc: ins.protectiveLayerKg,
          fotK: FOT_K_LAMIN,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж теплоизоляции',
          unit: 'чел. ч',
          qtyCalc: ins.mountingHours,
          note: 'ƒ 1 чел.ч на 1 м²',
        }),
      ],
    },
  ]
}

// ─── Раздел 2: Лестница (Библиотека B1) ─────────────────────────────────────

/**
 * Материалы нержавеющей лестницы — дословно из прайса. Ступени у ёмкости
 * в эталоне из трубы 25×2,5, у КНС и колодца — 25×2.
 */
export const LADDER_ITEMS = {
  stringer: { category: 'Металлопрокат', name: 'Уголок 40х40х3мм 08Х18Н10Т(AISI304) ГОСТ 8509-93', unit: 'м' },
  rungs: { category: 'Металлопрокат', name: 'Труба 25х2 мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81', unit: 'м' },
  rungsEmk: { category: 'Металлопрокат', name: 'Труба 25х2,5мм 12Х18Н10Т (AISI 304) ГОСТ 9941-81', unit: 'м' },
  /** Приставная алюминиевая — у ёмкости и колодца вместе с нержавеющей. */
  portable: { category: 'Прочие материалы', name: 'Лестница приставная односекционная 14 ступеней 3,98 м (алюминиевая)', unit: 'шт' },
} as const satisfies Record<string, { category: EngineRow['category']; name: string; unit: string }>

/**
 * Узел B1 — лестница.
 *
 * `enabled` — ответ ОЛ «Лестница» у ёмкости и колодца: узел следует за
 * тумблером (surveyToggled). У КНС вопроса нет — лестница есть всегда.
 *
 * Материалы — по листам всех трёх изделий (КНС 124–125, ЕМК 116–117,
 * колодец 115–116): тетивы из уголка на две стороны и ступени 0,44 м через
 * 0,35 м.
 *
 * `portable` — приставные алюминиевые лестницы. Листы ёмкости и колодца
 * считают их вместе с нержавеющей формулой: у ёмкости по одной на шахту
 * (строка 119, `I113 = L8`), у колодца одну (строка 118); монтаж — 2 чел.ч
 * на лестницу (строки 123 и 122). У КНС их число вписано руками (в образце
 * 3), и узел их не строит.
 */
export function buildLadder(
  ctx: MaterializeContext,
  s: { depthMm: number; enabled?: boolean; device?: BasketDevice; portable?: number },
): CalcComponent[] {
  const heightM = s.depthMm / 1000
  const l = ladder(heightM)
  const rungs = s.device === 'EMK' ? LADDER_ITEMS.rungsEmk : LADDER_ITEMS.rungs

  return [
    {
      id: nextId('c'),
      nodeCode: 'B1',
      title: 'Лестница нержавеющая',
      ...(s.enabled === undefined ? { enabled: true } : surveyToggled(s.enabled)),
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          ...LADDER_ITEMS.stringer,
          qtyCalc: l.materialM,
          note: `ƒ 2 тетивы × H (${fmtNum(heightM)} м)`,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          ...rungs,
          qtyCalc: l.rungPipeM,
          note: `ƒ H × 0,44 / 0,35 — ступень 0,44 м через 0,35 м`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Изготовление Лестницы',
          unit: 'чел. ч',
          qtyCalc: l.fabricationHours,
          note: `ƒ 1,25 × H (${heightM.toFixed(1)} м)`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж Лестницы',
          unit: 'чел. ч',
          qtyCalc: l.mountingHours,
          note: 'ƒ изготовление / 2',
        }),
        ...(s.portable && s.portable > 0
          ? [
              makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                ...LADDER_ITEMS.portable,
                qtyCalc: s.portable,
                note: s.device === 'EMK' ? `ƒ по одной на шахту (${s.portable})` : 'ƒ одна на колодец',
              }),
              makeRow(ctx, {
                kind: 'ОПЕРАЦИЯ',
                category: 'Собственное производство',
                name: 'Монтаж Лестницы',
                unit: 'чел. ч',
                qtyCalc: 2 * s.portable,
                note: 'ƒ 2 чел.ч на приставную лестницу',
              }),
            ]
          : []),
      ],
    },
  ]
}

// ─── Раздел 3: Перекрытие, площадка, несущие балки (B2, B6) ─────────────────

/** Рама перекрытия ставится от этого DN (лист КНС, строка 145: `IF(F140<1200;0;…)`). */
export const SLAB_FRAME_FROM_DN = 1200

/** Типовой люк в перекрытии, Ø мм — когда ОЛ не задаёт ни горловины, ни шахты. */
export const TYPICAL_HATCH_MM = 800

export interface SlabParams {
  dn: number
  /** Глубина погружения для анкеров, мм. */
  depthMm: number
  /**
   * Рама перекрытия из профильной трубы (лист КНС, строки 145 и 218–219).
   * У ёмкости и колодца она зависит от признаков, которых в их ОЛ нет
   * (исполнение крышки, наличие рамы), — поэтому только по запросу.
   */
  frame?: boolean
  /** Толщина перекрытия, мм: у КНС 6, у ёмкости и колодца 10. */
  thicknessMm?: number
  /**
   * Крышки люков: их масса вычитается из массы перекрытия, как в листах
   * ёмкости и колодца (`… − H141·I131`). Пусто — не вычитается: у КНС число
   * люков вписано руками, и узел их не строит.
   */
  hatches?: { count: number; coverMassKg: number } | null
  /**
   * Прорезка типового люка Ø800 в перекрытии. Нет — отверстие под горловину
   * или шахту прорезает их узел (раздел 1).
   */
  hatchCutout?: boolean
}

/** Раздел 3: перекрытие и анкеры. */
export function buildSlab(ctx: MaterializeContext, s: SlabParams): CalcComponent[] {
  const thicknessMm = s.thicknessMm ?? 6
  const hatches = s.hatches ?? null
  const slabMass = topSlabMassKg(s.dn, hatches?.coverMassKg ?? 0, hatches?.count ?? 0, thicknessMm)
  const hatchCutout = s.hatchCutout ?? true
  // Наружный диаметр ≈ DN + 300 (по геометрии формовки, Реверс §4.3).
  const outerD = (s.dn + 300) / 1000
  const anchors = anchorCount(outerD, s.depthMm / 1000)
  const frame = s.frame && s.dn >= SLAB_FRAME_FROM_DN ? frameHours(s.dn) : null
  const threshold = `DN ${s.dn} ${s.dn < 2500 ? '<' : '≥'} 2500`

  return [
    {
      id: nextId('c'),
      nodeCode: 'B2',
      title: 'Перекрытие верхнее',
      enabled: true,
      rows: [
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Механическая формовка верхнего перекрытия',
          unit: 'кг',
          qtyCalc: slabMass,
          fotK: FOT_K_MECH,
          note:
            `ƒ π·((DN+300)/2000)²·${fmtNum(thicknessMm / 1000, 3)}·1850` +
            (hatches ? ` − крышки люков ${fmtNum(hatches.coverMassKg, 1)} кг × ${hatches.count}` : '') +
            ` = ${fmtNum(slabMass, 1)} кг`,
        }),
        ...operationWithFot(ctx, {
          category: 'Собственное производство',
          name: 'Ламинирование верхнего перекрытия',
          unit: 'кг',
          qtyCalc: laminationMassKg(slabMass),
          fotK: FOT_K_LAMIN,
          note: 'ƒ масса перекрытия × 3/10',
        }),
        // Кол-во люков в ОЛ не задаётся — типовой один; уточняется вручную.
        ...(hatchCutout
          ? [
              makeRow(ctx, {
                kind: 'ОПЕРАЦИЯ',
                category: 'Собственное производство',
                name: 'Прорезка люков (горловин) в стеклокомпозитном перекрытии',
                unit: 'чел. ч',
                qtyCalc: cutoutHours(TYPICAL_HATCH_MM, 1),
                note: `ƒ Ø${TYPICAL_HATCH_MM}·π/1000 × 0,5 чел.ч · один люк типовой, уточните вручную`,
              }),
            ]
          : []),
      ],
    },
    // Рама перекрытия: метраж профиля лист не выводит (в образце вписано
    // 10 м), нормы работ — по порогу DN 2500, как у рамы насосов. В листе
    // работы не зависят от DN ≥ 1200, а сам профиль — зависит; раму без
    // профиля не собрать, поэтому узел целиком следует за порогом.
    ...(frame
      ? [
          {
            id: nextId('c'),
            nodeCode: 'B2',
            title: 'Рама перекрытия из профильной трубы',
            enabled: true,
            rows: [
              makeRow(ctx, {
                kind: 'МАТЕРИАЛ',
                category: 'Металлопрокат',
                name: 'Труба 60х30х2мм 12Х18Н10Т ГОСТ 8639-82',
                unit: 'м',
                qtyCalc: null,
                note: 'Метраж по компоновке рамы — в образце эталона 10 м',
              }),
              work(ctx, 'Изготовление рамы перекрытия из профильной трубы', frame.make, `ƒ ${threshold} → ${frame.make} чел.ч`),
              work(
                ctx,
                'Монтаж рамы перекрытия на верхнем стеклокомпозитном перекрытии',
                frame.mount,
                `ƒ ${threshold} → ${frame.mount} чел.ч`,
              ),
            ],
          } satisfies CalcComponent,
        ]
      : []),
    {
      id: nextId('c'),
      nodeCode: 'B6',
      title: 'Анкерное крепление против всплытия',
      enabled: true,
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Метизы',
          // 20х200, а не 16х100: сноска эталона под таблицей башмаков задаёт
          // «распорный анкер-болт класса 5.8 с резьбой М16 (рубашка Ø20 мм) на
          // расчётное усилие 27 500 Н» — то есть Ø20, и строки 212 (КНС) и 174
          // (колодец) называют именно «20х200». Прайс знает обе позиции, они
          // отличаются в полтора раза: 200 ₽ против 150 ₽.
          name: 'Анкерный болт распорный 20х200',
          unit: 'шт',
          qtyCalc: Math.ceil(anchors),
          note: `ƒ (глубина·1000·9,8·π·Дн²/4)/27500, Дн ${outerD.toFixed(2)} м → ${anchors.toFixed(1)} → ${Math.ceil(anchors)} шт`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж анкерных болтов к плите перекрытия',
          unit: 'чел. ч',
          qtyCalc: Math.ceil(anchors) * 0.5,
          note: 'ƒ 0,5 чел.ч на анкер',
        }),
      ],
    },
  ]
}

// ─── Раздел 4: Вентиляционный стояк (C1) ────────────────────────────────────

/**
 * Узел C1 — вентиляционный стояк.
 *
 * `enabled` — ответ ОЛ «Вентиляция» у ёмкости: узел следует за тумблером.
 * У КНС и колодца вопроса нет — стояк есть всегда.
 *
 * `count` — стояков: у ёмкости по одному на шахту (лист ЕМК, строки
 * 210–215 умножаются на `H209 = L8`), у КНС и колодца один.
 */
export function buildVent(ctx: MaterializeContext, s: { enabled?: boolean; count?: number } = {}): CalcComponent[] {
  // Ø вентстояка в ОЛ не задаётся; типовой ПЭ Ду110 — под него есть дефлектор.
  const VENT_D = 110
  const n = s.count && s.count > 1 ? s.count : 1
  const per = n > 1 ? ` × ${n} стояка` : ''

  return [
    {
      id: nextId('c'),
      nodeCode: 'C1',
      title: n > 1 ? `Вентиляционный стояк ПЭ Ду110 ×${n}` : 'Вентиляционный стояк ПЭ Ду110',
      ...(s.enabled === undefined ? { enabled: true } : surveyToggled(s.enabled)),
      rows: [
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Детали труб_да ПЭ ПВХ PPR',
          name: 'Дефлектор ПВХ Ду110',
          unit: 'шт',
          qtyCalc: n,
          note: n > 1 ? `ƒ по одному на стояк (${n})` : undefined,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Прорезка отверстия вентиляции в перекрытии',
          unit: 'чел. ч',
          qtyCalc: cutoutHours(VENT_D, n),
          note: `ƒ Ø${VENT_D}·π/1000 × 0,5 чел.ч${per}`,
        }),
        makeRow(ctx, {
          kind: 'ОПЕРАЦИЯ',
          category: 'Собственное производство',
          name: 'Монтаж вентиляционного стояка',
          unit: 'чел. ч',
          qtyCalc: 3 * n,
          note: `ƒ норматив 3 чел.ч (Библиотека C1)${per}`,
        }),
      ],
    },
  ]
}

// ─── Раздел 5: Напорный трубопровод (C2) ────────────────────────────────────

export function buildPressurePipe(
  ctx: MaterializeContext,
  s: {
    depthMm: number
    pumpsWorking: number
    pumpsReserve: number
    outletDn: number
    outletCount: number
    emergencyPipeline?: boolean
    /** Размер быстросъёмной муфты аварийной линии, ГМ (у ЕМК и КОЛ его нет). */
    emergencyCouplingGm?: number
    hasFlowMeter?: boolean
  },
): CalcComponent[] {
  const kit = PRESSURE_PIPE_KITS[s.outletDn] ?? null
  const n = s.outletCount
  const components: CalcComponent[] = []

  // Свободные фланцы: раньше это был ручной обмер — лист их не выводит. Завод
  // дал правило (2026-09-09): по патрубку у насоса, задвижки и обратного
  // клапана на каждый насос, два на расходомер и по одному на отводящий.
  // Прокладки и борт-шайбы следуют за ними, поэтому тоже стали расчётными.
  const pumps = s.pumpsWorking + s.pumpsReserve
  const meters = s.hasFlowMeter ? n : 0
  const flanges = pressureFlangeCount({
    pumpsWorking: s.pumpsWorking,
    pumpsReserve: s.pumpsReserve,
    outletCount: n,
    hasFlowMeter: Boolean(s.hasFlowMeter),
  })
  const flangeNote = `ƒ 3×насосов (${pumps}) + 2×расходомеров (${meters}) + отводящих (${n}) = ${flanges} шт`

  // C2 — комплект нитки. Соотношения внутри него заданы эталоном и от заказа
  // не зависят; якорные величины (метраж стальной трубы, число свободных
  // фланцев, отводов и тройников) снимаются с компоновки — лист их тоже не
  // выводит, поэтому они рождаются пустыми, а не выдуманными.
  //
  // Прокладок «свободных фланцев + 2» и борт-шайб «столько же, сколько
  // свободных фланцев» — оба следуют за ручным числом фланцев, поэтому тоже
  // пустые до его ввода: считать их от нуля значило бы напечатать «2 шт»
  // прокладок там, где их два десятка.
  if (kit) {
    const item = (
      k: KitItem,
      qtyCalc: number | null,
      note: string,
    ): Parameters<typeof makeRow>[1] => ({
      kind: 'МАТЕРИАЛ',
      category: k.category,
      name: k.name,
      unit: k.unit,
      qtyCalc,
      note,
    })

    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: `Нитка напорного трубопровода DN${s.outletDn} ×${n}`,
      slot: 'line',
      enabled: true,
      rows: [
        makeRow(ctx, item(kit.peSleeve, n, `ƒ по одной на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.pePipe, 0.5 * n, `ƒ 0,5 м на втулку × ${n}`)),
        makeRow(ctx, item(kit.peWeld, n, `ƒ по одному стыку на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.steelPipe, null, 'Метраж по компоновке — введите вручную')),
        makeRow(ctx, item(kit.weldFlange, n, `ƒ по одному на нитку, ниток ${n}`)),
        makeRow(ctx, item(kit.freeFlange, flanges, flangeNote)),
        makeRow(ctx, item(kit.gasket, flanges + 2, `ƒ свободных фланцев (${flanges}) + 2`)),
        makeRow(ctx, item(kit.backingRing, flanges, `ƒ по одной на свободный фланец (${flanges})`)),
        makeRow(ctx, item(kit.elbow, null, 'Число по компоновке — введите вручную')),
        makeRow(ctx, item(kit.tee, null, 'Число по компоновке — введите вручную')),
      ],
    })
  }

  // Обвязка датчика давления — по комплекту на нитку (лист, строки 369–371).
  if (kit) {
    const { threeWayValve, ballValve, unionPipe } = PRESSURE_PIPE_EXTRAS
    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: 'Обвязка датчика давления',
      slot: 'sensor',
      enabled: true,
      rows: [threeWayValve, ballValve, unionPipe].map((k) =>
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: k.category,
          name: k.name,
          unit: k.unit,
          qtyCalc: n,
          note: `ƒ по одному на нитку, ниток ${n}`,
        }),
      ),
    })
  }

  // Аварийный трубопровод — флаг ОЛ (лист, строки 361–362: `1 × ОЛ!J47`).
  //
  // `undefined` означает не «выключен», а «у изделия такого признака нет»:
  // опросные листы ЕМК и колодца про аварийный трубопровод не спрашивают, и
  // вечно выключенный блок был бы у них шумом. Поэтому у КНС компонент есть
  // всегда (включённый или нет), а у остальных изделий его нет вовсе.
  if (s.emergencyPipeline !== undefined) {
    // Состав шире, чем в листе: помимо быстросъёмной муфты и резьбового
    // патрубка завод назвал (2026-09-09) обратный клапан, задвижку и два
    // фланца. Наименования клапана и задвижки строятся по шаблону НН с
    // подстановкой DN — прайс держит ряд DN50…DN300, так что при типовом
    // напорном строка находит цену; при нетиповом останется «красной», и
    // инженер выберет позицию сам.
    // Труба аварийной линии идёт тем же DN, что напорная, а размер муфты от
    // него не зависит: муфта приваривается к трубопроводу, наружу торчит
    // только ответная часть, и её размером определяется, чем подключатся.
    const gm = s.emergencyCouplingGm ?? DEFAULT_COUPLING_GM
    const nut = couplingItem(gm)
    const nozzle = COUPLING_NOZZLES[gm] ?? null

    const emergencyRows = [
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: nut.category,
        name: nut.name,
        unit: nut.unit,
        qtyCalc: 1,
        note: 'ƒ одна на станцию · приваривается к трубопроводу, размер из ОЛ',
      }),
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: nozzle?.category ?? 'Прочие материалы',
        name: nozzle?.name ?? `Патрубок резьбовой под муфту ГМ${gm}`,
        unit: 'шт',
        qtyCalc: 1,
        note: nozzle
          ? 'ƒ один на станцию, приваривается к трубе аварийной линии'
          : `Резьба под ГМ${gm} в прайсе не указана — подберите патрубок из каталога: ` +
            `резьба под муфту, приваривается к трубе аварийной линии DN${s.outletDn}`,
      }),
    ]

    emergencyRows.push(
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Запорная арматура',
        name: `Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN${s.outletDn} PN10/16`,
        unit: 'шт',
        qtyCalc: 1,
        note: 'ƒ один на аварийную линию',
      }),
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Запорная арматура',
        name: `Задвижка чугунная клиновая металл/металл DN${s.outletDn} PN10/16 клин бронза`,
        unit: 'шт',
        qtyCalc: 1,
        note: 'ƒ одна на аварийную линию',
      }),
      // Монтаж — по норме раздела 7 эталона: 1 чел.ч на задвижку и клапан.
      // Здесь, а не в разделе 7: работы следуют за своей арматурой и
      // выключаются вместе с линией.
      work(ctx, STATION_WORKS.wedgeGateMount, 1, 'ƒ 1 чел.ч на задвижку аварийной линии'),
      work(ctx, STATION_WORKS.checkValveMount, 1, 'ƒ 1 чел.ч на клапан аварийной линии'),
    )

    if (kit) {
      emergencyRows.push(
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: kit.freeFlange.category,
          name: kit.freeFlange.name,
          unit: kit.freeFlange.unit,
          qtyCalc: 2,
          note: 'ƒ два фланца на аварийную линию',
        }),
      )
    }

    components.push({
      id: nextId('c'),
      nodeCode: 'C2',
      title: 'Аварийный трубопровод',
      slot: 'emergency',
      ...surveyToggled(s.emergencyPipeline),
      rows: emergencyRows,
    })
  }

  // Направляющие насосов здесь больше не считаются: в эталоне это материал
  // и работы узла «Крепление насосного оборудования» раздела 3
  // (station-equipment.ts, buildPumpMounting), а не «0,25 чел.ч на метр».
  components.push({
    id: nextId('c'),
    nodeCode: 'C2',
    title: 'Работы по напорному трубопроводу',
    slot: 'works',
    enabled: true,
    rows: [
      // Трудоёмкость самой нитки — норматив эталона, от диаметра и числа
      // ниток не зависит (строки 374–375). Надбавка ×1,2 за коллекторную
      // компоновку не применяется: признака «сложный» в опросном листе нет.
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Изготовление напорного трубопровода',
        unit: 'чел. ч',
        qtyCalc: PRESSURE_PIPE_HOURS.fabrication,
        note: 'Норматив эталона; при коллекторной компоновке ×1,2 — уточните',
      }),
      makeRow(ctx, {
        kind: 'ОПЕРАЦИЯ',
        category: 'Собственное производство',
        name: 'Монтаж напорного трубопровода',
        unit: 'чел. ч',
        qtyCalc: PRESSURE_PIPE_HOURS.installation,
        note: 'Норматив эталона; при коллекторной компоновке ×1,2 — уточните',
      }),
    ],
  })

  if (!kit) {
    components[components.length - 1]!.rows.push(
      makeRow(ctx, {
        kind: 'МАТЕРИАЛ',
        category: 'Детали трубопровода сталь',
        name: `Комплект нитки DN${s.outletDn}`,
        unit: 'шт',
        qtyCalc: null,
        note: `Комплекта для DN${s.outletDn} в эталоне нет (есть 50, 65, 80, 150) — соберите нитку из каталога`,
      }),
    )
  }

  return components
}

/**
 * Полное наименование болта из марки норм.
 *
 * Нормы дают краткую марку «М20х90», а в прайсе НН имя полное и единообразное:
 * «Болт М20-6gх90.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)». Проверено:
 * все четыре марки норм (М16х80, М20х90, М24х100, М27х110) находятся по
 * этому шаблону.
 */
export function boltFullName(bolt: string): string {
  const m = /^М(\d+)х(\d+)$/.exec(bolt)
  if (!m) return `Болт ${bolt}`
  return `Болт М${m[1]}-6gх${m[2]}.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)`
}

/**
 * Спутники болта: плоская шайба, гроверная и гайка того же типоразмера.
 *
 * В эталоне (раздел 6, строки 383–398) они выписаны для М20, М16, М12 и М6, но
 * наименования у всех строятся по одному шаблону НН, и справочник знает
 * размеры от М6 до М42 — поэтому имя собирается, а не берётся из таблицы на
 * четыре размера: фланцы дают и М24, и М27.
 *
 * @param bolt обозначение из норм патрубка, напр. «М20х90»
 */
export function fastenerSetNames(bolt: string): { washer: string; lockWasher: string; nut: string } | null {
  const m = /^М(\d+)х\d+$/.exec(bolt)
  if (!m) return null
  const d = m[1]
  return {
    washer: `Шайба 2.М${d}.12Х18Н10Т ГОСТ 11371-78 (DIN125)`,
    lockWasher: `Шайба М${d} 12Х18Н10Т ГОСТ 6402-70 (DIN 127)`,
    nut: `Гайка М${d}-6Н.5.12Х18Н10Т ГОСТ 5915-70 (DIN 934)`,
  }
}

/**
 * Болтовой комплект фланцевых соединений одного DN: болт по норме патрубка
 * «Для расчетов» (марка и число отверстий фланца), на болт две плоские
 * шайбы, гроверная и гайка — соотношения листа КНС (раздел 6), от заказа
 * они не зависят. Комплект нужен каждому фланцевому соединению (уточнение
 * завода 11.09.2026): стыкам напорного трубопровода (C3), фланцевому
 * патрубку под задвижку (A6), фланцу стеклопластикового патрубка ёмкости.
 *
 * @param joints число соединений; `jointsNote` — откуда оно, в пояснение
 */
export function flangeBoltRows(ctx: MaterializeContext, dn: number, joints: number, jointsNote: string): CalcRowNode[] {
  const norm = ctx.nozzleNormOf?.(dn) ?? null
  const bolts = norm?.boltCount != null ? norm.boltCount * joints : null
  const set = norm?.bolt ? fastenerSetNames(norm.bolt) : null
  const metiz = (name: string, qtyCalc: number | null, note: string) =>
    makeRow(ctx, { kind: 'МАТЕРИАЛ', category: 'Метизы', name, unit: 'шт', qtyCalc, note })
  return [
    // Полное наименование болта из прайса: у каждого DN своя марка
    // (М16х80…М27х110), а имя строится по единому шаблону НН
    // «Болт {М}-6gх{L}.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)».
    metiz(
      norm?.bolt ? boltFullName(norm.bolt) : 'Болт фланцевого соединения',
      bolts,
      bolts == null
        ? `Норма крепежа для DN${dn} в матрице «Для расчетов» не найдена — введите вручную`
        : `ƒ ${norm!.boltCount} отв. × ${jointsNote} = ${bolts} шт (${norm!.bolt})`,
    ),
    ...(set
      ? [
          metiz(set.washer, bolts == null ? null : bolts * 2, 'ƒ 2 шайбы на болт'),
          metiz(set.lockWasher, bolts, 'ƒ 1 гроверная шайба на болт'),
          metiz(set.nut, bolts, 'ƒ 1 гайка на болт'),
        ]
      : []),
  ]
}

// ─── Раздел 6: Крепёж (C3) ──────────────────────────────────────────────────

/**
 * C3 — болтовой комплект стыков напорного трубопровода: соединений столько
 * же, сколько свободных фланцев нитки (`pressureFlangeCount`): у насоса,
 * задвижки и обратного клапана, по два на расходомер, по одному на
 * отводящий. Так считает и лист ёмкости (H247 = отверстий × свободных
 * фланцев); лист КНС умножает на прокладки — на две больше (строка 383).
 * Прежде соединений было по одному на отводящий — болтов втрое-вчетверо
 * меньше, чем фланцев.
 */
export function buildFasteners(
  ctx: MaterializeContext,
  s: { outletDn: number; outletCount: number; pumpsWorking: number; pumpsReserve: number; hasFlowMeter?: boolean },
): CalcComponent[] {
  const joints = pressureFlangeCount({
    pumpsWorking: s.pumpsWorking,
    pumpsReserve: s.pumpsReserve,
    outletCount: s.outletCount,
    hasFlowMeter: Boolean(s.hasFlowMeter),
  })
  return [
    {
      id: nextId('c'),
      nodeCode: 'C3',
      title: 'Крепёжный комплект фланцевых соединений',
      enabled: true,
      rows: flangeBoltRows(ctx, s.outletDn, joints, `${joints} соединений (по свободным фланцам нитки)`),
    },
  ]
}

// ─── Раздел 7: Оборудование (частично — насосная группа и арматура) ─────────

/**
 * Количество из ОЛ с учётом ручного ввода и примечание, объясняющее его.
 *
 * Ручная цифра ОЛ становится РАСЧЁТНЫМ количеством строки (qtyCalc), а не её
 * ручным override: для расчёта это вход шаблона, как любое другое поле ОЛ.
 * Канал ручного override в самом расчёте остаётся свободным.
 */
function fromSurvey(calc: number, manual: number | null | undefined, formula: string): { qty: number; note: string } {
  if (manual == null || !Number.isFinite(manual) || manual < 0) return { qty: calc, note: formula }
  // «ƒ = насосов (3) + …» → «насосов (3) + …»: в скобках — только сама формула.
  return { qty: manual, note: `задано в ОЛ вручную: ${manual} · расчётное ${calc} (${formula.replace(/^ƒ\s*=?\s*/, '')})` }
}

/**
 * Задвижка на подводящем — шиберная с удлинённым штоком (лист, строка 408):
 * подводящий идёт на глубине лотка, и шток выводится к поверхности. Длина
 * штока — от оси трубы: глубина лотка минус половина DN.
 *
 * В прайсе такой задвижки нет — цена под длину штока, строка «красная» до
 * ввода (в образце эталона вписано 250 000 ₽).
 */
export function inletGateValveName(inletDn: number, trayDepthMm: number | null | undefined): string {
  const base = `Задвижка шиберная с невыдв.шпинделем с ручным управлением DN${inletDn} PN10 и удлиненным штоком`
  if (typeof trayDepthMm !== 'number' || !Number.isFinite(trayDepthMm) || trayDepthMm <= 0) return base
  const stemMm = Math.round(trayDepthMm - inletDn / 2)
  return `${base} L=${stemMm} мм (высота штока указана от оси трубы)`
}

/** C4 — узел запорной арматуры: задвижки, обратные клапаны и их монтаж. */
export function buildKnsValves(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const pumps = s.pumpsWorking + s.pumpsReserve
  const W = STATION_WORKS
  const gatesCalc = gateValveCount(s.inletCount)
  const pressureGatesCalc = pressureGateValveCount(s.pumpsWorking, s.pumpsReserve, s.outletCount)
  const checkValvesCalc = checkValveCount(s.pumpsWorking, s.pumpsReserve)

  const gates = fromSurvey(gatesCalc, s.gatesInletManual, `ƒ = по задвижке на подводящий (${s.inletCount}) — есть всегда`)
  const pressureGates = fromSurvey(
    pressureGatesCalc,
    s.gatesPressureManual,
    `ƒ = насосов (${pumps}) + отводящих (${s.outletCount}) = ${pressureGatesCalc} шт`,
  )
  const checkValves = fromSurvey(checkValvesCalc, s.checkValvesManual, `ƒ = по клапану на каждый установленный насос (${pumps})`)

  return [
    {
      id: nextId('c'),
      nodeCode: 'C4',
      title: 'Узел запорной арматуры',
      enabled: true,
      rows: [
        // На подводящем — шиберная задвижка со штоком до поверхности
        // (inletGateValveName). Длина штока входит в наименование, и цену
        // под неё дают по запросу: сменилась глубина лотка в ОЛ — строка
        // новая и снова «красная», прежняя цена к ней не переносится.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: inletGateValveName(s.inletDn, s.inletTrayDepthMm),
          unit: 'шт',
          qtyCalc: gates.qty,
          note:
            gates.note +
            (s.inletTrayDepthMm
              ? ` · шток = лоток ${s.inletTrayDepthMm} − DN/2`
              : ' · длина штока = глубина лотка − DN/2: укажите в ОЛ глубину лотка подводящего'),
        }),
        // Клиновые задвижки в НН — с полной спецификацией («…металл/металл
        // DN50 PN10/16 клин бронза»), и позиции есть не для всех DN: для
        // нетипового строка останется «красной», и позицию выберет инженер.
        //
        // Напорная сторона: по схеме завода на стояке каждого установленного
        // насоса стоят задвижка и обратный клапан, плюс задвижка на каждом
        // отводящем патрубке. Резервный насос обвязан как рабочий, поэтому
        // здесь считаются ВСЕ насосы: рабочие задают расход (гидравлика),
        // установленные — состав.
        //
        // Прежде здесь стоял «Кран шаровой DN{напорного}» — на схеме шаровых
        // кранов на напорной линии нет, а те, что есть в эталоне, относятся к
        // обвязке датчика давления и материализуются в разделе 5.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Задвижка чугунная клиновая металл/металл DN${s.outletDn} PN10/16 клин бронза`,
          unit: 'шт',
          qtyCalc: pressureGates.qty,
          note: pressureGates.note,
        }),
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: 'Запорная арматура',
          name: `Клапан обратный фланцевый с мягким уплотнением и наклонным седлом DN${s.outletDn} PN10/16`,
          unit: 'шт',
          qtyCalc: checkValves.qty,
          note: checkValves.note,
        }),
        // Монтаж арматуры — 1 чел.ч на штуку (лист, строки 425–427), от
        // тех же количеств, включая заданные в ОЛ вручную.
        work(ctx, W.knifeGateMount, gates.qty, 'ƒ 1 чел.ч на задвижку на подводящем'),
        work(ctx, W.wedgeGateMount, pressureGates.qty, 'ƒ 1 чел.ч на задвижку напорной стороны'),
        work(ctx, W.checkValveMount, checkValves.qty, 'ƒ 1 чел.ч на обратный клапан'),
      ],
    },
  ]
}

/** D1 — насосная группа: насосы, трубные муфты, поплавки и их монтаж. */
export function buildKnsPumps(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const pumps = s.pumpsWorking + s.pumpsReserve
  const spare = s.pumpsSpare && s.pumpsSpare > 0 ? s.pumpsSpare : 0
  const heightM = stationHeightM(s)
  const W = STATION_WORKS

  return [
    {
      id: nextId('c'),
      nodeCode: 'D1',
      title: 'Насосная группа',
      enabled: true,
      rows: [
        // Цена насоса — позиция прайса по марке: «Насосы, АТМ | Насос <марка>
        // | шт» (заводится на каждую модель каталога, цены вносит закупка).
        // Поле ОЛ «Цена насоса, ₽/шт» её перекрывает и связано с ценой строки
        // в обе стороны. Нет ни того, ни другого — строка «красная».
        //
        // Марка приходит из подбора по притоку, напору и числу рабочих
        // насосов (`/api/pump-station/select-pump`, каталог Vandjord VSL) либо
        // вводится вручную в ОЛ. Без неё в КП уходило бы «Насос (марка по
        // подбору)» — строка, по которой заказчику нечего согласовывать.
        //
        // Запасные на склад входят в поставку (лист, I412 = раб + рез +
        // запас), но не в монтаж и не в обвязку.
        bindPrice(
          makeRow(ctx, {
            kind: 'МАТЕРИАЛ',
            category: PUMP_PRICE_CATEGORY,
            name: pumpRowName(s.pumpModel),
            unit: 'шт',
            qtyCalc: pumps + spare,
            note:
              `ƒ = раб ${s.pumpsWorking} + рез ${s.pumpsReserve}` +
              (spare ? ` + на склад ${spare}` : '') +
              (s.pumpModel ? '' : ' · марка не подобрана — уточните в опросном листе'),
          }),
          'pumpPrice',
          s.pumpPriceRub,
        ),
        // Автоматическая трубная муфта — по одной на установленный насос
        // (лист, строка 413). DN — из паспорта насоса; в прайсе муфты нет,
        // цену даёт поставщик насосов.
        makeRow(ctx, {
          kind: 'МАТЕРИАЛ',
          category: PUMP_PRICE_CATEGORY,
          name: 'Автоматическая трубная муфта',
          unit: 'шт',
          qtyCalc: pumps,
          note: `ƒ по одной на установленный насос (${pumps}) · цена по предложению поставщика насосов; если муфта входит в цену насоса — выключите строку`,
        }),
        // Кабель поплавка — по высоте станции: в эталоне при 11,8 м — 20 М.
        floatSwitchRow(ctx, floatSwitchCount(s.pumpsWorking, s.pumpsReserve), heightM, 'ƒ = раб + рез + 2'),
        work(ctx, W.pumpsMount, 2 * pumps, `ƒ 2 чел.ч на установленный насос (${pumps}); запасные не монтируются`),
        work(ctx, W.couplingMount, 3 * pumps, `ƒ 3 чел.ч на муфту (${pumps})`),
        work(ctx, W.floatsMount, floatSwitchCount(s.pumpsWorking, s.pumpsReserve), 'ƒ 1 чел.ч — 1 выключатель'),
      ],
    },
  ]
}

/** D2 — шкаф управления, датчики, расходомер: каждый под своим тумблером ОЛ. */
export function buildKnsAutomation(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  const pumps = s.pumpsWorking + s.pumpsReserve
  const heightM = stationHeightM(s)
  return buildAutomation(ctx, {
    heightM,
    depthM: pipeLengthM(s.depthMm),
    outletDn: s.outletDn,
    outletCount: s.outletCount,
    pumps,
    controlCabinet: Boolean(s.hasControlCabinet),
    cabinetType: s.controlCabinetType,
    cabinetStart: s.controlCabinetStart,
    pressureSensors: Boolean(s.hasPressureSensors),
    levelSensor: Boolean(s.hasLevelSensor),
    flowMeter: Boolean(s.hasFlowMeter),
  })
}

/** D5 — тренога, таль по высоте станции, газоанализатор. */
export function buildKnsService(ctx: MaterializeContext, s: KnsSurveyParams): CalcComponent[] {
  return [buildServiceEquipment(ctx, { heightM: stationHeightM(s) })]
}

// ─── Дерево ──────────────────────────────────────────────────────────────────

/** Все строки дерева единым списком — вход агрегатора экономики. */
export function flattenRows(tree: CalcTree): CalcRowNode[] {
  return tree.sections.flatMap((s) => s.components.flatMap((c) => c.rows))
}

/**
 * Включён ли раздел/компонент для конкретной строки: выключение любого уровня
 * обнуляет количество (Механика §7.2).
 */
export function sectionEnabledFor(tree: CalcTree): (row: EngineRow) => boolean {
  const map = new Map<string, boolean>()
  for (const s of tree.sections) {
    for (const c of s.components) {
      for (const r of c.rows) map.set(r.id, s.enabled && c.enabled)
    }
  }
  return (row) => map.get(row.id) ?? true
}
