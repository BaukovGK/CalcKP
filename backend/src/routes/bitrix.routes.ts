import express, { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { signAccess, signRefresh } from '../utils/jwt'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { logger } from '../utils/logger'
import { createLimiter, limitByIp } from '../utils/rate-limit'
import {
  bitrixConfig, BitrixAuthError, createOneTimeCodes, fetchBitrixRest, resolveAccount, verifyLaunch,
  type BitrixDenial, type BitrixLaunch, type BitrixRest,
} from '../utils/bitrix-auth'

/**
 * Вход из вкладки Битрикс24 (ТЗ §10.3), `/api/auth/bitrix`.
 *
 *  1. Портал открывает приложение POST-запросом на `/launch` — это адрес
 *     обработчика в настройках локального приложения. Сервер проверяет ключ
 *     сотрудника у портала, находит учётку и отвечает переходом на
 *     `/bitrix?code=…` (или `/bitrix?error=…`).
 *  2. Экран `/bitrix` меняет одноразовый код на обычные токены `/exchange`.
 *
 * Дальше сессия ничем не отличается от входа по паролю: роли, отзыв, журнал.
 * Выключен, пока не задан BITRIX_PORTAL.
 */
export const bitrixRouter = Router()

const WINDOW_MS = 15 * 60 * 1000
/** Каждое открытие вкладки — запуск: с запасом на офис за одним NAT. */
const launchByIp = createLimiter({ windowMs: WINDOW_MS, max: 300 })
const exchangeByIp = createLimiter({ windowMs: WINDOW_MS, max: 300 })

const codes = createOneTimeCodes()

const rests = new Map<string, BitrixRest>()
function portalRest(portal: string): BitrixRest {
  let rest = rests.get(portal)
  if (!rest) rests.set(portal, rest = fetchBitrixRest(portal))
  return rest
}

/** Портал присылает форму, а не JSON. */
const form = express.urlencoded({ extended: false, limit: '64kb' })

/** Причина отказа в журнале — словами: её читает администратор. */
const DENIAL_TEXT: Record<BitrixDenial, string> = {
  disabled: 'вход из Битрикс24 не включён',
  bad_request: 'портал не передал ключ',
  wrong_portal: 'чужой портал',
  wrong_app: 'ключ другого приложения',
  portal_error: 'портал не подтвердил ключ',
  portal_inactive: 'сотрудник неактивен в портале',
  no_email: 'портал не передал почту сотрудника — у приложения нет прав user_basic',
  no_account: 'нет учётной записи с этой почтой',
  blocked: 'учётная запись заблокирована',
  email_taken: 'учётная запись с этой почтой привязана к другому сотруднику',
}

function firstString(...values: unknown[]): string | undefined {
  for (const v of values) if (typeof v === 'string' && v !== '') return v
  return undefined
}

function toScreen(res: express.Response, query: Record<string, string>) {
  // 303: после POST браузер идёт на экран GET-запросом.
  res.redirect(303, `/bitrix?${new URLSearchParams(query).toString()}`)
}

// POST /api/auth/bitrix/launch — обработчик приложения в портале.
bitrixRouter.post('/launch', limitByIp(launchByIp, 'Слишком много запусков с этого адреса'), form, async (req, res, next) => {
  const cfg = bitrixConfig()
  if (!cfg) { toScreen(res, { error: 'disabled' }); return }

  const body = (req.body ?? {}) as Record<string, unknown>
  // DOMAIN портал кладёт в адрес запроса, ключ и member_id — в тело.
  const launch: BitrixLaunch = {
    domain:   firstString(req.query.DOMAIN, body.DOMAIN),
    authId:   firstString(body.AUTH_ID, req.query.AUTH_ID),
    memberId: firstString(body.member_id, req.query.member_id),
  }

  try {
    const profile = await verifyLaunch(launch, cfg, portalRest(cfg.portal))
    // Ключ подтверждён нашим порталом — его member_id можно закрепить.
    if (!cfg.memberId && launch.memberId) {
      logger.info(`Битрикс24: member_id портала ${launch.memberId} — впишите его в BITRIX_MEMBER_ID`)
    }

    const select = { id: true, email: true, isActive: true, bitrixUserId: true, mustChangePassword: true } as const
    const [byBitrixId, byEmail] = await Promise.all([
      prisma.user.findUnique({ where: { bitrixUserId: profile.id }, select }),
      profile.email
        ? prisma.user.findFirst({ where: { email: { equals: profile.email, mode: 'insensitive' } }, select })
        : Promise.resolve(null),
    ])
    const found = resolveAccount(profile, byBitrixId, byEmail)

    if (found.kind === 'denied') {
      // Кто пришёл — для администратора: «нет учётки» значит завести её с
      // этой почтой. Сотрудник ещё не вошёл, поэтому автор записи пуст.
      await audit(null, 'auth.bitrix_denied', 'User', (byBitrixId ?? byEmail)?.id, {
        reason: DENIAL_TEXT[found.code], bitrixUserId: profile.id, name: profile.name, email: profile.email,
      })
      toScreen(res, { error: found.code })
      return
    }

    const user = found.user
    const data: { bitrixUserId?: string; passwordHash?: string; mustChangePassword?: boolean } = {}
    if (found.kind === 'link') data.bitrixUserId = profile.id
    // Пароль задан не сотрудником (временный от администратора) — входом через
    // портал он больше не нужен, а оставлять его рабочим без обязательной
    // смены нельзя. Пароль заменяется случайным: войти по паролю снова можно
    // после «Сбросить пароль» у администратора.
    if (user.mustChangePassword) {
      data.passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 10)
      data.mustChangePassword = false
    }
    if (Object.keys(data).length) await prisma.user.update({ where: { id: user.id }, data })
    if (found.kind === 'link') {
      await audit(user.id, 'auth.bitrix_link', 'User', user.id, { email: user.email, bitrixUserId: profile.id, name: profile.name })
    }

    toScreen(res, { code: codes.issue(user.id) })
  } catch (e) {
    if (e instanceof BitrixAuthError) {
      logger.warn(`Вход из Битрикс24 отклонён (${e.code}): ${e.message}`)
      await audit(null, 'auth.bitrix_denied', undefined, undefined, { reason: DENIAL_TEXT[e.code], detail: e.message })
      toScreen(res, { error: e.code })
      return
    }
    next(e)
  }
})

const exchangeSchema = z.object({ code: z.string().min(1).max(200) })

// POST /api/auth/bitrix/exchange — одноразовый код → токены приложения.
bitrixRouter.post('/exchange', limitByIp(exchangeByIp, 'Слишком много попыток входа с этого адреса'), validate(exchangeSchema), async (req, res, next) => {
  try {
    const userId = codes.consume((req.body as z.infer<typeof exchangeSchema>).code)
    if (!userId) {
      res.status(401).json({ message: 'Код входа устарел — откройте вкладку в Битрикс24 заново', code: 'BITRIX_CODE_EXPIRED' })
      return
    }
    const user = await prisma.user.findUnique({ where: { id: userId } })
    // Между запуском и обменом учётку могли заблокировать или отвязать.
    if (!user || !user.isActive || !user.bitrixUserId) {
      res.status(401).json({ message: 'Учётная запись недоступна', code: 'BITRIX_ACCOUNT_UNAVAILABLE' })
      return
    }
    const claims = { userId: user.id, role: user.role, tokenVersion: user.tokenVersion }
    const [accessToken, refreshToken] = await Promise.all([signAccess(claims), signRefresh(claims)])
    await audit(user.id, 'auth.login', 'User', user.id, { email: user.email, via: 'Битрикс24' })
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        position: user.position,
        phone: user.phone,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
    })
  } catch (e) { next(e) }
})
