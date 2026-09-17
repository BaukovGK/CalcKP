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
  /** Адрес доставки на объект; пусто — про доставку не пишем. */
  deliveryTo: string | null
  /** Склад отгрузки при самовывозе. */
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

/** Склад отгрузки по умолчанию — он же в пункте о доставке. */
const DEFAULT_WAREHOUSE = 'Московская область, г.о. Сергиево-Посадский, д. Коврово'

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
  opts: { deliveryTo?: string | null; env?: NodeJS.ProcessEnv } = {},
): KpTerms {
  const env = opts.env ?? process.env
  const validUntil = new Date(issuedAt.getTime())
  validUntil.setDate(validUntil.getDate() + DEFAULT_VALID_DAYS)

  return {
    vatRatePct: 22,
    deliveryTo: opts.deliveryTo ?? null,
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

/** Подпись по умолчанию: должность постоянна, фамилия — из окружения. */
export function defaultSignature(
  executor: { name?: string | null; email?: string | null } = {},
  env: NodeJS.ProcessEnv = process.env,
): KpSignature {
  return {
    signerTitle: env.KP_SIGNER_TITLE?.trim() || 'Коммерческий директор',
    signerName: env.KP_SIGNER_NAME?.trim() || null,
    executorName: executor.name?.trim() || null,
    executorPhone: env.KP_EXECUTOR_PHONE?.trim() || null,
    executorEmail: executor.email?.trim() || null,
  }
}

/** Число процентов в виде документа: без лишнего нуля после запятой. */
function pct(value: number): string {
  return String(Number(value.toFixed(2))).replace('.', ',')
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

  const price = [`Цены приведены с учётом НДС ${pct(terms.vatRatePct)} %`]
  if (terms.deliveryTo) price.push(`и доставкой на объект: ${terms.deliveryTo}`)
  let priceLine = `${price.join(' ')}.`
  if (terms.shipmentFrom) {
    priceLine += ` Стоимость самовывоза со склада поставщика (${terms.shipmentFrom}) в цену не входит.`
  }
  items.push(priceLine)

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
