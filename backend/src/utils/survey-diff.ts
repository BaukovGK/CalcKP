/**
 * Что изменилось в опросном листе — для журнала действий.
 *
 * Лист сохраняется целиком и часто: экран ОЛ пишет его через полторы секунды
 * после правки, а конфигуратор — при каждом изменении дерева. Класть в журнал
 * «расчёт сохранён» столько же раз бессмысленно: нужен ответ на вопрос «кто и
 * что поменял в листе», а не отметка о записи.
 *
 * Поэтому сравниваются ОТВЕТЫ ЛИСТА (блок `form`), а не дерево и не
 * вычисленные значения: правка дерева журнал ОЛ не засоряет, а смена DN видна
 * строкой «DN корпуса: 2000 → 3000».
 *
 * @module utils/survey-diff
 */

/** Одно изменение ответа: поле и значения до и после. */
export interface SurveyChange {
  field: string
  from: string
  to: string
}

/** Сколько изменений кладём в запись журнала: остальное — счётчиком. */
export const SURVEY_CHANGES_MAX = 20

/**
 * Подписи полей листа — те же слова, что видит инженер на экране.
 *
 * Поля трёх изделий (КНС, ЕМК, КОЛ) лежат в одном словаре: имена у них не
 * пересекаются, а где пересекаются — значат одно и то же.
 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  zayavka: '№ заявки', stadiya: 'стадия', zakazchik: 'заказчик', obekt: 'объект',
  region: 'регион', data: 'дата листа',

  tipNs: 'тип станции', tankType: 'тип ёмкости', wellType: 'тип колодца',
  dn: 'DN корпуса', vozv: 'возвышение', volumeM3: 'объём, м³',
  placement: 'расположение', installation: 'установка', bottomType: 'днища',
  lengthManual: 'длина корпуса', depthMm: 'глубина', elevationMm: 'возвышение',
  npodzManual: 'Нподз вручную', underRoadway: 'под проезжей частью', mvk: 'ТТ МВК',
  insulation: 'утепление', tiGlubina: 'глубина утепления', ispolnenie: 'исполнение обечайки',
  pnManual: 'PN вручную', snManual: 'SN вручную', pipeManual: 'PN/SN вручную',
  resin: 'смола', effluent: 'стоки',

  hasShaft: 'шахта', shaftCount: 'шахт', shaftD: 'диаметр шахты', shaftH: 'высота шахты',
  hasNeck: 'горловина', neckD: 'диаметр горловины', neckH: 'высота горловины',
  hasLadder: 'лестница',

  podvMat: 'материал подводящего', podvDn: 'DN подводящего', podvKol: 'подводящих',
  podvLotok: 'лоток подводящего', napMat: 'материал напорного', napDn: 'DN напорного',
  napKol: 'напорных', napLotok: 'лоток напорного', otvMat: 'материал отводящего',
  otvDn: 'DN отводящего', otvKol: 'отводящих', otvLotok: 'лоток отводящего',
  emergency: 'аварийный трубопровод', muftaGm: 'муфта ГМ',

  rashod: 'расход', rashodUnit: 'единица расхода', napor: 'напор',
  nRab: 'рабочих насосов', nRez: 'резервных насосов', nZap: 'запасных насосов',
  marka: 'марка насоса', vzryv: 'взрывозащита', hasPumps: 'насосы',
  drobilka: 'корзина/дробилка', grinder: 'корзина/дробилка', hasValves: 'арматура',
  zadvManual: 'задвижек вручную', kranManual: 'кранов вручную',
  klapanManual: 'клапанов вручную', armaturaManual: 'арматура вручную',

  shu: 'шкаф управления', shuTip: 'исполнение шкафа', shuPusk: 'пуск',
  datchikiDavl: 'датчики давления', datchikiUrov: 'датчики уровня',
  datchiki: 'датчики', rashodomer: 'расходомер', ventilation: 'вентиляция',

  pipePrice: 'цена трубы', pumpPrice: 'цена насоса', servicePipePrice: 'цена трубы шахты',
  tiManual: 'глубина утепления вручную',
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Блок ответов листа. Его нет (старый расчёт, запись дерева) — сравнивать нечего. */
function formOf(survey: unknown): Record<string, unknown> | null {
  if (!isObj(survey)) return null
  return isObj(survey.form) ? survey.form : null
}

/** Значение ответа для журнала: признаки — словами, пустое — прочерком. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'да' : 'нет'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Изменения ответов листа между двумя состояниями `surveyData`.
 *
 * Пустой список значит «лист не трогали»: сохранялось дерево, цены или
 * вычисленные значения — для журнала ОЛ это не событие.
 */
export function surveyChanges(before: unknown, after: unknown): SurveyChange[] {
  const was = formOf(before)
  const now = formOf(after)
  if (!now) return []
  // Первое сохранение листа (у расчёта ещё не было ответов) — это создание
  // единицы, оно уже в журнале своим событием.
  if (!was) return []

  const changes: SurveyChange[] = []
  for (const key of Object.keys(now)) {
    const from = was[key]
    const to = now[key]
    if (show(from) === show(to)) continue
    changes.push({ field: FIELD_LABELS[key] ?? key, from: show(from), to: show(to) })
  }
  return changes
}

/** Изменения строкой для журнала: «DN корпуса: 2000 → 3000». */
export function changeText(change: SurveyChange): string {
  return `${change.field}: ${change.from} → ${change.to}`
}
