import { Router, type Response } from 'express'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { canSeeProjects } from '../utils/access'
import { requireRole } from '../middleware/rbac'
import { audit } from '../utils/audit'
import { bitrixConfig, DEAL_TAB_PLACEMENT } from '../utils/bitrix-auth'
import { dealTabState, DEAL_TAB_DESCRIPTION, DEAL_TAB_TITLE, launchHandlerUrl } from '../utils/b24-placement'
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

// ── Вкладка в карточке сделки (этап 2) ─────────────────────────────────────
// Подключает администратор калькулятора, который заодно администратор
// портала: placement.bind портал принимает только с ключом администратора.

const adminOnly = requireRole('ADMIN')
const handlerUrl = () => launchHandlerUrl(process.env.PUBLIC_URL || process.env.CORS_ORIGIN)

/** Отказ портала здесь почти всегда значит «не администратор портала». */
function placementFailure(res: Response, e: unknown): boolean {
  if (e instanceof B24ClientError && e.code === 'access_denied') {
    res.status(403).json({
      message: 'Битрикс24 отказал: подключать вкладку может только администратор портала, '
        + 'и у приложения должно быть право «Встраивание приложений» (placement).',
      code: 'B24_ACCESS_DENIED',
    })
    return true
  }
  return portalFailure(res, e)
}

async function readDealTab(c: B24Client, userId: string) {
  return dealTabState(await c.call(userId, 'placement.get'), handlerUrl())
}

// GET /api/b24/deal-tab — подключена ли вкладка и куда ведёт.
b24Router.get('/deal-tab', adminOnly, async (req, res, next) => {
  const c = client(res)
  if (!c) return
  try {
    res.json(await readDealTab(c, (req as AuthRequest).userId!))
  } catch (e) {
    if (placementFailure(res, e)) return
    next(e)
  }
})

// POST /api/b24/deal-tab — подключить; ведёт на старый адрес — переподключить.
b24Router.post('/deal-tab', adminOnly, async (req, res, next) => {
  const c = client(res)
  if (!c) return
  const handler = handlerUrl()
  if (!handler) {
    res.status(503).json({ message: 'На сервере не задан адрес https (PUBLIC_URL) — портал откроет вкладку только по https', code: 'B24_NO_PUBLIC_URL' })
    return
  }
  const userId = (req as AuthRequest).userId!
  try {
    const before = await readDealTab(c, userId)
    if (!before.current) {
      if (before.bound) await c.call(userId, 'placement.unbind', { PLACEMENT: DEAL_TAB_PLACEMENT })
      await c.call(userId, 'placement.bind', {
        PLACEMENT: DEAL_TAB_PLACEMENT, HANDLER: handler, TITLE: DEAL_TAB_TITLE, DESCRIPTION: DEAL_TAB_DESCRIPTION,
      })
      await audit(userId, 'auth.bitrix_tab_bind', undefined, undefined, { handler, replaced: before.handlers })
    }
    res.json(await readDealTab(c, userId))
  } catch (e) {
    if (placementFailure(res, e)) return
    next(e)
  }
})

// DELETE /api/b24/deal-tab — убрать вкладку из карточки сделки.
b24Router.delete('/deal-tab', adminOnly, async (req, res, next) => {
  const c = client(res)
  if (!c) return
  const userId = (req as AuthRequest).userId!
  try {
    const before = await readDealTab(c, userId)
    if (before.bound) {
      await c.call(userId, 'placement.unbind', { PLACEMENT: DEAL_TAB_PLACEMENT })
      await audit(userId, 'auth.bitrix_tab_unbind', undefined, undefined, { handlers: before.handlers })
    }
    res.json(await readDealTab(c, userId))
  } catch (e) {
    if (placementFailure(res, e)) return
    next(e)
  }
})

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
