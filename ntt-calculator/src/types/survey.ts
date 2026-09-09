/**
 * Модель опросного листа КНС (§5.6 ТЗ, прототип «Опросный лист v2»).
 *
 * КНС/ЛНС/ДНС — один тип изделия с одним шаблоном; «Тип НС» влияет на подписи
 * и входы, не на структуру (Реверс §1).
 */

import type { FlowUnit } from '@/engines/survey-kns'

export type NsType = 'Канализационная' | 'Ливневая' | 'Дренажная' | 'Водопроводная'
export type Stage = 'проект' | 'рабочая' | 'КД' | 'продажа' | 'тендер'
export type PipeMaterial = 'ПЭ' | 'ПВХ' | 'ПНД' | 'ПП' | 'Асбестцемент' | 'Корсис' | 'стеклокомпозит'
export type Grinder = 'корзина' | 'дробилка' | 'обе' | 'нет'

/**
 * Корзина и дробилка на экране — два независимых тумблера над ОДНИМ полем
 * модели.
 *
 * В опросном листе завода это одно поле с четырьмя значениями, и таким оно
 * сохраняется: менять форму хранения ради вида экрана значило бы осиротить
 * сохранённые расчёты. Тумблеры — проекция: пара булевых однозначно ложится
 * на четвёрку и обратно. Функции общие для КНС и ЕМК — поле у них называется
 * по-разному (`drobilka` и `grinder`), а смысл один.
 */
export function grinderValue(basket: boolean, grinder: boolean): Grinder {
  if (basket && grinder) return 'обе'
  if (basket) return 'корзина'
  if (grinder) return 'дробилка'
  return 'нет'
}
export const hasBasketIn = (g: Grinder): boolean => g === 'корзина' || g === 'обе'
export const hasGrinderIn = (g: Grinder): boolean => g === 'дробилка' || g === 'обе'
export type ShuType = 'внутренний' | 'уличный'
export type ShuStart = 'стандартный' | 'плавный' | 'ЧП'
/** Исполнение обечайки корпуса (лист КНС, «Списки»!AI2/AI3). */
export type PipeExecution = 'целая' | 'частями'

/**
 * Общая часть опросного листа — одинакова для всех трёх изделий (КНС/ЕМК/КОЛ).
 *
 * В сохранённом `surveyData` дублируется отдельным блоком `common`, чтобы
 * страницы (топбар конфигуратора, карточки проекта) читали заказчика и
 * № заявки, не зная типа изделия.
 */
export interface SurveyCommonForm {
  zayavka: string
  stadiya: Stage
  zakazchik: string
  obekt: string
  region: string
  data: string
}

/** Выделяет общий блок из любой формы ОЛ — для записи в `surveyData.common`. */
export function pickCommon(f: SurveyCommonForm): SurveyCommonForm {
  return {
    zayavka: f.zayavka,
    stadiya: f.stadiya,
    zakazchik: f.zakazchik,
    obekt: f.obekt,
    region: f.region,
    data: f.data,
  }
}

export interface KnsSurveyForm extends SurveyCommonForm {
  // ── Специфика КНС ──
  tipNs: NsType

  // ── Корпус ──
  dn: string
  /** Возвышение над землёй, мм. */
  vozv: string
  /** Ручной override PN/SN: пусто — берутся расчётные. */
  pnManual: string
  snManual: string
  /** Чекбокс «изменить вручную» раскрывает селекты PN/SN. */
  pipeManual: boolean

  underRoadway: boolean
  mvk: boolean
  insulation: boolean
  tiGlubina: string
  /**
   * Чекбокс «изменить вручную» у глубины теплоизоляции.
   *
   * Глубина почти всегда типовая (2000 мм), поэтому поле ввода скрыто за
   * флажком — так же, как PN и SN трубы: значение видно, но не просит
   * внимания на каждом заказе.
   */
  tiManual: boolean
  /**
   * Исполнение обечайки: одной трубой либо сегментами со сваркой на месте
   * (лист КНС, ячейка E14). «Частями» добавляет в расчёт сегменты и
   * ламинирование стыков — в эталоне при «целой трубе» этот блок обнулён.
   *
   * Типовое исполнение — ЧАСТЯМИ (решение завода 2026-09-09): цельную трубу
   * нужной длины удаётся взять не всегда. В эталонном листе стояла «целая»,
   * но это свойство того экземпляра, а не правило.
   */
  ispolnenie: PipeExecution

  // ── Патрубки ──
  podvMat: PipeMaterial
  podvDn: string
  podvKol: string
  /** Глубина залегания лотка подводящего, мм — обязательное для Нподз. */
  podvLotok: string

  napMat: PipeMaterial
  napDn: string
  napKol: string
  napLotok: string

  /** Арматура на подводящем. */
  valveOnInlet: boolean
  /** Аварийный трубопровод. */
  emergency: boolean
  /**
   * Размер быстросъёмной муфты аварийной линии, ГМ.
   *
   * Муфта приваривается к трубопроводу, наружу торчит только ответная часть,
   * к которой подключаются при аварии. Труба линии идёт тем же DN, что
   * напорная, а муфта — нет: ею определяется, чем подключатся, и в прайсе
   * она стоит от 250 до 2000 ₽ в зависимости от размера.
   */
  muftaGm: string
  /**
   * Override количеств арматуры: пусто — расчётное.
   *
   * `kranManual` исторически назывался по шаровым кранам; по схеме завода на
   * напорной стороне стоят ЗАДВИЖКИ, и поле переопределяет именно их. Ключ
   * не переименован намеренно: он лежит в сохранённых опросных листах.
   */
  zadvManual: string
  kranManual: string
  klapanManual: string
  /** Чекбокс «изменить вручную» у блока арматуры — как у трубы корпуса. */
  armaturaManual: boolean

  // ── Насосное оборудование ──
  rashod: string
  rashodUnit: FlowUnit
  napor: string
  nRab: string
  nRez: string
  nZap: string
  marka: string
  vzryv: boolean
  drobilka: Grinder

  // ── Автоматика ──
  shu: boolean
  shuTip: ShuType
  shuPusk: ShuStart
  datchikiDavl: boolean
  datchikiUrov: boolean
  rashodomer: boolean

  /** Ручной ввод Нподз: пусто — берётся расчётная. */
  npodzManual: string
}

/**
 * Предзаполнение реальным кейсом ОЛ3487 — как в прототипе.
 * Это же данные сценария приёмки №2.
 */
export function makeDefaultKnsSurvey(): KnsSurveyForm {
  return {
    zayavka: '2406-118',
    tipNs: 'Канализационная',
    stadiya: 'рабочая',
    zakazchik: 'АО «ГК «ЕКС»',
    obekt: 'ГКБ №52, ул. Пехотная, 3',
    region: 'Москва',
    // Дата — сегодняшняя, как в ЕМК и КОЛ: в прототипе тут стояла дата кейса
    // ОЛ3487, и каждый новый лист открывался задним числом.
    data: new Date().toLocaleDateString('ru-RU'),

    dn: '3000',
    vozv: '300',
    pnManual: '',
    snManual: '',
    pipeManual: false,
    underRoadway: false,
    mvk: true,
    insulation: true,
    tiGlubina: '2000',
    tiManual: false,
    ispolnenie: 'частями',

    podvMat: 'ПЭ',
    podvDn: '250',
    podvKol: '1',
    podvLotok: '9910',
    napMat: 'ПЭ',
    napDn: '150',
    napKol: '2',
    napLotok: '1800',
    valveOnInlet: true,
    muftaGm: '150',
    emergency: false,
    zadvManual: '',
    kranManual: '',
    klapanManual: '',
    armaturaManual: false,

    rashod: '25,13',
    rashodUnit: 'l/s',
    napor: '12,9',
    nRab: '2',
    nRez: '1',
    nZap: '0',
    // Пусто намеренно: поле — РУЧНОЕ ПЕРЕОПРЕДЕЛЕНИЕ подобранной марки
    // (`composables/usePumpSelection.ts`). Любое значение по умолчанию
    // навсегда маскировало бы подбор: он считался бы, но никогда не применялся.
    marka: '',
    vzryv: false,
    drobilka: 'корзина',

    shu: true,
    shuTip: 'уличный',
    shuPusk: 'плавный',
    datchikiDavl: true,
    datchikiUrov: true,
    rashodomer: true,

    npodzManual: '',
  }
}
