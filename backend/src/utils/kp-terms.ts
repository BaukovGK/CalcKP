/**
 * Условия предложения, подпись и реквизиты — постоянная часть КП.
 *
 * В эталоне (`doc/Эталон_КП_разбор.md` §7, §8) это девять пронумерованных
 * пунктов под таблицей, подпись коммерческого директора, блок исполнителя и
 * подвал с реквизитами. Текст пунктов один и тот же от предложения к
 * предложению, меняются подстановки: ставка НДС, адрес доставки, дата
 * окончания, доли оплаты, срок поставки, порог курса.
 *
 * Значения приходят из диалога выпуска КП (решение пользователя 17.09.2026),
 * а дефолты — здесь: менеджер открывает окно и видит заполненные поля, а не
 * пустую форму. Подписант и телефон отдела переопределяются переменными
 * окружения — они меняются без правки кода и у каждой установки свои.
 *
 * @module utils/kp-terms
 */

import { shortName, signatureName } from './person'

/** Реквизиты поставщика — подвал документа. */
export interface KpCompany {
  name: string
  ogrn: string
  innKpp: string
  phone: string
  address: string
  email: string
  site: string
}

/** Подстановки девяти пунктов условий. */
export interface KpTerms {
  /** Ставка НДС, %: цена уже включает налог, сверху он не начисляется. */
  vatRatePct: number
  /**
   * Куда доставляем: «г. Москва» или адрес, введённый менеджером. При
   * `deliveryIncluded == null` — адрес объекта прежней формулировки.
   */
  deliveryTo: string | null
  /**
   * Входит ли доставка в стоимость (раздел «Доставка» опросного листа):
   * true — «стоимость включает доставку со склада … до …»; false — «доставка
   * в стоимость не входит»; null — прежняя формулировка пункта 1 (КП,
   * выпущенные до раздела «Доставка», и изделия без него печатаются как раньше).
   */
  deliveryIncluded?: boolean | null
  /** Склад отгрузки — откуда везём или откуда самовывоз. */
  shipmentFrom: string | null
  /** Предложение действительно до этой даты. */
  validUntil: Date | null
  /** Предоплата, % от суммы договора. */
  prepaymentPct: number
  /** Срок оплаты каждой части, рабочих дней. */
  paymentDays: number
  /** Срок поставки, рабочих дней — диапазоном: «40-50». */
  leadTimeDays: string
  /** Порог изменения курса евро по ЦБ, % — выше него стоимость уточняется. */
  euroThresholdPct: number
  /** Что не входит в стоимость: каждая строка — отдельный пункт условий. */
  excluded: string[]
}

/** Подпись и исполнитель. */
export interface KpSignature {
  signerTitle: string
  signerName: string | null
  executorName: string | null
  /** Должность исполнителя из его учётной записи. */
  executorPosition: string | null
  executorPhone: string | null
  executorEmail: string | null
}

/**
 * Реквизиты НТТ из эталона. Любое поле переопределяется переменной окружения
 * `KP_COMPANY_*` — у другой площадки они свои.
 */
export function companyFromEnv(env: NodeJS.ProcessEnv = process.env): KpCompany {
  const pick = (key: string, fallback: string): string => {
    const v = env[key]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback
  }
  return {
    name: pick('KP_COMPANY_NAME', 'Общество с ограниченной ответственностью «Новые Трубные Технологии»'),
    ogrn: pick('KP_COMPANY_OGRN', 'ОГРН 5077746425257'),
    innKpp: pick('KP_COMPANY_INN', 'ИНН/КПП 7707622256/504201001'),
    phone: pick('KP_COMPANY_PHONE', 'тел./факс: +7 (499) 940 14 04'),
    address: pick(
      'KP_COMPANY_ADDRESS',
      'Юридический адрес: Россия, 141320, Московская обл., ГО Сергиево-Посадский, д. Коврово, д. 50, помещ. 2',
    ),
    email: pick('KP_COMPANY_EMAIL', 'info@ntt.su'),
    site: pick('KP_COMPANY_SITE', 'www.ntt.su'),
  }
}

/**
 * Строка исходящего в шапке КП — с пустыми полями.
 *
 * Исходящий номер и дату КП получает только после согласования руководством,
 * поэтому они вписываются потом — от руки или в DOCX. Номер калькулятора
 * (счётчик выпуска) остаётся внутренним: реестр, имя файла, лента сделки Б24.
 */
export const OUTGOING_LINE = 'Исх. № ____________ от ____________'

/**
 * Склад отгрузки по умолчанию — площадка НТТ в Пересвете, откуда считаются
 * тарифы доставки (книга закупок). Точный адрес задаётся `KP_WAREHOUSE`.
 */
const DEFAULT_WAREHOUSE = 'Московская область, г.о. Сергиево-Посадский, г. Пересвет'

/** Доставка по разделу «Доставка» опросного листа. */
export interface KpDelivery {
  /** Стоимость доставки посчитана или введена — она входит в цену. */
  included: boolean
  /** Куда: «г. Москва» либо адрес, введённый менеджером. */
  to: string | null
}

/** Признаки, что маршрут книги тарифов — не просто город. */
const NOT_A_CITY = /обл\.?|област|кра[йя]|республик|р-н|район|(^|\s)ст\.|станц|ГРЭС|ТЭС|ТКО|ТБО|МПК|порт|,|\s-\s|\(|\d/i

/**
 * «Москва» → «г. Москва»; маршрут вроде «Пермский край» или «Солнечногорск,
 * МО» печатается как есть: приставлять к нему «г.» было бы ошибкой.
 */
export function deliveryPlace(city: string): string {
  const c = city.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (!c) return c
  if (/^(г\.|город\s)/i.test(c) || NOT_A_CITY.test(c)) return c
  return `г. ${c}`
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Доставка из сохранённого опросного листа (`surveyData`): блок `delivery`
 * (итог раздела) и ответы `form` (город, адрес).
 *
 *  - своя стоимость введена — доставка включена, куда — введённый адрес
 *    (пусто — город);
 *  - стоимость посчитана по тарифам — включена, куда — «г. <город>»;
 *  - город не выбран или стоимости нет — не включена.
 *
 * `null` — блока доставки в листе нет (расчёт старше раздела, ЕМК, КОЛ):
 * пункт 1 печатается прежней формулировкой.
 */
export function deliveryFromSurvey(survey: unknown): KpDelivery | null {
  if (!isObj(survey) || !isObj(survey.delivery)) return null
  const d = survey.delivery
  const form = isObj(survey.form) ? survey.form : {}
  const city = typeof d.city === 'string' ? d.city.trim() : ''
  const address = typeof form.deliveryAddress === 'string' ? form.deliveryAddress.trim() : ''
  const manual = typeof d.manualRub === 'number'
  const cost = typeof d.costRub === 'number'
  if (manual) return { included: true, to: address || (city ? deliveryPlace(city) : null) }
  if (city && cost) return { included: true, to: deliveryPlace(city) }
  return { included: false, to: null }
}

/** Сколько дней действительно предложение, если менеджер не указал иначе. */
export const DEFAULT_VALID_DAYS = 14

/**
 * Дефолты условий: ими заполняется диалог выпуска.
 *
 * Срок действия считается от даты выпуска, а не «плюс две недели от сегодня»:
 * КП печатается из снапшота, и повторная печать обязана дать ту же дату.
 */
export function defaultTerms(
  issuedAt: Date,
  opts: { deliveryTo?: string | null; delivery?: KpDelivery | null; env?: NodeJS.ProcessEnv } = {},
): KpTerms {
  const env = opts.env ?? process.env
  const validUntil = new Date(issuedAt.getTime())
  validUntil.setDate(validUntil.getDate() + DEFAULT_VALID_DAYS)

  // Раздел «Доставка» есть — пункт 1 по нему; нет — прежний «на объект».
  const delivery = opts.delivery ?? null
  return {
    vatRatePct: 22,
    deliveryTo: delivery ? delivery.to : (opts.deliveryTo ?? null),
    deliveryIncluded: delivery ? delivery.included : null,
    shipmentFrom: env.KP_WAREHOUSE?.trim() || DEFAULT_WAREHOUSE,
    validUntil,
    prepaymentPct: 70,
    paymentDays: 3,
    leadTimeDays: env.KP_LEAD_TIME_DAYS?.trim() || '40-50',
    euroThresholdPct: 5,
    excluded: [
      'Диспетчеризация и пусконаладочные работы не включены в стоимость предложения.',
      'Электромонтажные работы по прокладке кабеля не включены в стоимость предложения.',
    ],
  }
}

/**
 * Подпись по умолчанию.
 *
 * Подписант — из окружения: коммерческий директор один на все предложения, а
 * учётной записи у него может и не быть. Исполнитель — из учётной записи
 * автора расчёта: ФИО сокращается до «Иванов С.В.», должность и телефон
 * берутся оттуда же. Телефона в карточке нет — подставляется общий из
 * окружения, чтобы заказчику было куда звонить.
 */
export function defaultSignature(
  executor: {
    name?: string | null
    position?: string | null
    phone?: string | null
    email?: string | null
  } = {},
  env: NodeJS.ProcessEnv = process.env,
): KpSignature {
  return {
    signerTitle: env.KP_SIGNER_TITLE?.trim() || 'Коммерческий директор',
    signerName: signatureName(env.KP_SIGNER_NAME ?? null),
    executorName: shortName(executor.name ?? null),
    executorPosition: executor.position?.trim() || null,
    executorPhone: executor.phone?.trim() || env.KP_EXECUTOR_PHONE?.trim() || null,
    executorEmail: executor.email?.trim() || null,
  }
}

/** Число процентов в виде документа: без лишнего нуля после запятой. */
function pct(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',')
}

/**
 * Пункт 1: НДС и доставка.
 *
 *  - доставка включена: «Стоимость включает доставку со склада поставщика
 *    (<склад>) до г. Москва»;
 *  - не включена: «Доставка в стоимость не входит: отгрузка со склада
 *    поставщика (<склад>), стоимость доставки до объекта рассчитывается
 *    отдельно по запросу»;
 *  - признака нет (`null`, КП до раздела «Доставка»): прежняя формулировка,
 *    чтобы старые редакции печатались слово в слово.
 */
export function priceTerm(terms: KpTerms): string {
  const vat = `Цены приведены с учётом НДС ${pct(terms.vatRatePct)} %.`
  const from = terms.shipmentFrom ? ` (${terms.shipmentFrom})` : ''

  if (terms.deliveryIncluded === true) {
    const to = terms.deliveryTo ? ` до ${terms.deliveryTo}` : ' до объекта'
    return `${vat} Стоимость включает доставку со склада поставщика${from}${to}.`
  }
  if (terms.deliveryIncluded === false) {
    return (
      `${vat} Доставка в стоимость не входит: отгрузка со склада поставщика${from}, ` +
      'стоимость доставки до объекта рассчитывается отдельно по запросу.'
    )
  }

  const price = [`Цены приведены с учётом НДС ${pct(terms.vatRatePct)} %`]
  if (terms.deliveryTo) price.push(`и доставкой на объект: ${terms.deliveryTo}`)
  let line = `${price.join(' ')}.`
  if (terms.shipmentFrom) {
    line += ` Стоимость самовывоза со склада поставщика (${terms.shipmentFrom}) в цену не входит.`
  }
  return line
}

/**
 * Девять пунктов условий — текст эталона с подстановками.
 *
 * Пункт про доставку в эталоне сформулирован противоречиво («с доставкой на
 * объект» и тут же «без учёта доставки со склада»). Здесь он разведён: цена с
 * доставкой до объекта, если адрес задан; про склад — отдельным предложением,
 * что самовывоз в цену не входит.
 *
 * @param formatDate дата в формате документа — передаётся, чтобы модуль не
 *   зависел от часового пояса печати
 */
export function termsItems(terms: KpTerms, formatDate: (d: Date) => string): string[] {
  const items: string[] = []
  items.push(priceTerm(terms))

  if (terms.validUntil) {
    items.push(`Настоящее предложение действительно до ${formatDate(terms.validUntil)} г.`)
  }

  items.push(
    'Продукция соответствует ГОСТ Р 54560-2015 и ГОСТ Р ИСО 10467-2013, применение ' +
      'стеклокомпозитных изделий рекомендовано техническими требованиями СП 32.13330.2018, ' +
      'срок службы стеклокомпозитного корпуса 50 лет.',
  )

  const rest = Math.max(0, 100 - terms.prepaymentPct)
  items.push(
    `Условия оплаты: предоплата ${pct(terms.prepaymentPct)} % от суммы договора в течение ` +
      `${terms.paymentDays} рабочих дней после подписания договора; оплата ${pct(rest)} % от суммы ` +
      `договора в течение ${terms.paymentDays} рабочих дней после уведомления о готовности к отгрузке.`,
  )

  items.push(
    `Условия поставки: ${terms.leadTimeDays} рабочих дней со дня заключения договора, ` +
      'предоплаты, согласования чертежа.',
  )

  items.push(
    'Стоимость изделий может измениться в процессе согласования чертежей при изменении ' +
      'технических характеристик и комплектации изделия.',
  )

  items.push(
    `Стоимость изделий уточняется в случае изменения курса евро по ЦБ более чем на ` +
      `${pct(terms.euroThresholdPct)} %.`,
  )

  items.push(...terms.excluded.filter((line) => line.trim() !== ''))
  return items
}
