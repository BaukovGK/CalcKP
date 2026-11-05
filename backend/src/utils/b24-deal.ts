/**
 * Сделка Битрикс24 для экрана калькулятора — только то, что ему нужно, из
 * ответов crm.deal.get, crm.company.get, crm.contact.get, user.get.
 * Поля портала приходят строками; пустые — null.
 */

export interface DealSummary {
  id: string
  title: string
  stageId: string | null
  /** Сумма сделки в портале — только показать: калькулятор её не меняет. */
  opportunity: number | null
  currency: string | null
  companyId: string | null
  contactId: string | null
  /** Заказчик: компания сделки, нет её — контакт. */
  customer: string | null
  assignedName: string | null
  /** Ссылка на сделку в портале. */
  url: string
}

type Rec = Record<string, unknown>

function str(v: unknown): string | null {
  if (typeof v === 'number') return String(v)
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** ID в портале: «0» значит «не задано». */
export function entityId(v: unknown): string | null {
  const s = str(v)
  return s && /^[1-9]\d{0,17}$/.test(s) ? s : null
}

export function personName(u: Rec | null | undefined): string | null {
  if (!u) return null
  const name = [u.LAST_NAME, u.NAME, u.SECOND_NAME].map(str).filter(Boolean).join(' ')
  return name || null
}

export function dealSummary(
  portal: string,
  deal: Rec,
  company: Rec | null,
  contact: Rec | null,
  assigned: Rec | null,
): DealSummary {
  const id = entityId(deal.ID) ?? ''
  const sum = Number(deal.OPPORTUNITY)
  return {
    id,
    title: str(deal.TITLE) ?? `Сделка №${id}`,
    stageId: str(deal.STAGE_ID),
    opportunity: deal.OPPORTUNITY == null || deal.OPPORTUNITY === '' || !Number.isFinite(sum) ? null : sum,
    currency: str(deal.CURRENCY_ID),
    companyId: entityId(deal.COMPANY_ID),
    contactId: entityId(deal.CONTACT_ID),
    customer: str(company?.TITLE) ?? personName(contact),
    assignedName: personName(assigned),
    url: `https://${portal}/crm/deal/details/${id}/`,
  }
}
