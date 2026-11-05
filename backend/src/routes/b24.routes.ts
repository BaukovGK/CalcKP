import { Router, type Response } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { canSeeProjects } from '../utils/access'
import { bitrixConfig } from '../utils/bitrix-auth'
import { B24ClientError, type B24Client, type B24ClientErrorCode } from '../utils/b24-client'
import { b24Client } from '../utils/b24-portal'
import { dealSummary, entityId } from '../utils/b24-deal'
import { logger } from '../utils/logger'

/**
 * Данные портала Битрикс24 для экранов калькулятора, `/api/b24`
 * (doc/План_Б24_сделка.md). Портал спрашивается ключом вошедшего
 * сотрудника: что закрыто ему в портале, закрыто и здесь.
 */
export const b24Router = Router()
b24Router.use('/', requireAuth)
// Сделка — это заказчик и деньги: снабженцу, как и проекты, закрыта.
b24Router.use('/', (req, res, next) => {
  if (!canSeeProjects((req as AuthRequest).userRole)) {
    res.status(403).json({ message: 'Сделки снабженцу недоступны' })
    return
  }
  next()
})

const STATUS: Record<B24ClientErrorCode, number> = {
  no_token: 409,
  token_expired: 409,
  access_denied: 403,
  not_found: 404,
  portal_error: 502,
}

/** Ошибка портала — понятным текстом и кодом `B24_…` для экрана. */
function portalFailure(res: Response, e: unknown): boolean {
  if (!(e instanceof B24ClientError)) return false
  if (e.code === 'portal_error') logger.warn(e.message)
  res.status(STATUS[e.code]).json({ message: e.message, code: `B24_${e.code.toUpperCase()}` })
  return true
}

function client(res: Response): B24Client | null {
  const c = b24Client()
  if (!c) res.status(503).json({ message: 'Битрикс24 на сервере не настроен', code: 'B24_DISABLED' })
  return c
}

// GET /api/b24/deals/:id — шапка сделки: название, заказчик, ответственный.
b24Router.get('/deals/:id', async (req, res, next) => {
  const id = entityId(req.params.id)
  if (!id) { res.status(400).json({ message: 'Неверный номер сделки' }); return }
  const c = client(res)
  if (!c) return
  const userId = (req as AuthRequest).userId!
  try {
    const deal = await c.call<Record<string, unknown>>(userId, 'crm.deal.get', { id })
    const companyId = entityId(deal.COMPANY_ID)
    const contactId = entityId(deal.CONTACT_ID)
    const assignedId = entityId(deal.ASSIGNED_BY_ID)
    // Компания, контакт и ответственный — дополнение: не открылись (нет прав
    // на компанию) — сделка показывается и без них.
    const soft = <T>(p: Promise<T>) => p.catch(() => null)
    const [company, contact, users] = await Promise.all([
      companyId ? soft(c.call<Record<string, unknown>>(userId, 'crm.company.get', { id: companyId })) : null,
      !companyId && contactId ? soft(c.call<Record<string, unknown>>(userId, 'crm.contact.get', { id: contactId })) : null,
      assignedId ? soft(c.call<Record<string, unknown>[]>(userId, 'user.get', { ID: assignedId })) : null,
    ])
    res.json(dealSummary(bitrixConfig()!.portal, deal, company, contact, Array.isArray(users) ? users[0] ?? null : null))
  } catch (e) {
    if (portalFailure(res, e)) return
    next(e)
  }
})
