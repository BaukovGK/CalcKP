import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { signAccess, signRefresh, tokenVersionOf, verifyRefresh } from '../utils/jwt'
import { validate } from '../middleware/validate'
import { requireAuthForPasswordChange, type AuthRequest } from '../middleware/auth'
import { audit } from '../utils/audit'
import { MIN_PASSWORD_LENGTH } from '../utils/password'
import { createLimiter, limitByIp, retryText } from '../utils/rate-limit'
import type { Response } from 'express'

export const authRouter = Router()

// ── Ограничение частоты (План_устранения 2.2) ───────────────────────────────
// Первый рубеж — nginx (ntt-calculator/nginx.conf), этот — второй.
const WINDOW_MS = 15 * 60 * 1000
/** Входы с одного адреса. Офис за одним NAT входит утром разом — с запасом. */
const loginByIp = createLimiter({ windowMs: WINDOW_MS, max: 100 })
/**
 * Неудачные входы на один адрес почты — с любых адресов: подбор пароля к
 * одной учётке упирается в лимит, откуда бы ни шли попытки. Удачный вход
 * счётчик сбрасывает.
 */
const failedByEmail = createLimiter({ windowMs: WINDOW_MS, max: 10 })
/** Обновления токена с одного адреса: каждая вкладка — раз в 15 минут. */
const refreshByIp = createLimiter({ windowMs: WINDOW_MS, max: 300 })

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

/**
 * POST /api/auth/login. Больше 100 попыток за 15 минут с одного адреса или
 * 10 неудачных на один адрес почты — 429 с `Retry-After` (План_устранения 2.2).
 */
authRouter.post('/login', limitByIp(loginByIp, 'Слишком много попыток входа с этого адреса'), validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const key = email.trim().toLowerCase()
    const lock = failedByEmail.blocked(key)
    if (!lock.allowed) {
      res.setHeader('Retry-After', String(lock.retryAfterS))
      res.status(429).json({
        message: `Слишком много неудачных попыток входа — повторите ${retryText(lock.retryAfterS)}`,
        code: 'TOO_MANY_ATTEMPTS',
        retryAfterS: lock.retryAfterS,
      })
      return
    }
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive || !(await bcrypt.compare(password, user.passwordHash))) {
      failedByEmail.hit(key)
      res.status(401).json({ message: 'Неверный email или пароль' }); return
    }
    failedByEmail.reset(key)
    const payload = { userId: user.id, role: user.role, tokenVersion: user.tokenVersion }
    const [accessToken, refreshToken] = await Promise.all([
      signAccess(payload),
      signRefresh(payload),
    ])
    res.json({
      accessToken,
      refreshToken,
      // mustChangePassword — экран ведёт на смену пароля, API до неё закрыт.
      user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
    })
  } catch (e) { next(e) }
})

// POST /api/auth/refresh — больше 300 за 15 минут с одного адреса: 429.
authRouter.post('/refresh', limitByIp(refreshByIp, 'Слишком много обновлений сессии с этого адреса'), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string }
    if (!refreshToken) { res.status(400).json({ message: 'refreshToken обязателен' }); return }
    // Только refresh-токен: access сюда не проходит (План_реализации §4.2 №2).
    const payload    = await verifyRefresh(refreshToken)
    const user       = await prisma.user.findUnique({ where: { id: payload.userId } })
    if (!user || !user.isActive) { res.status(401).json({ message: 'Пользователь не найден' }); return }
    // Refresh-токен отозван вместе с версией (План_устранения 2.3).
    if (tokenVersionOf(payload) !== user.tokenVersion) { res.status(401).json({ message: 'Сессия завершена — войдите снова' }); return }
    const accessToken = await signAccess({ userId: user.id, role: user.role, tokenVersion: user.tokenVersion })
    res.json({ accessToken })
  } catch {
    res.status(401).json({ message: 'Недействительный refresh-токен' })
  }
})

// GET /api/auth/me — открыт и до обязательной смены пароля.
authRouter.get('/me', requireAuthForPasswordChange, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, role: true, mustChangePassword: true },
    })
    if (!user) { res.status(401).json({ message: 'Пользователь не найден' }); return }
    res.json(user)
  } catch (e) { next(e) }
})

/**
 * POST /api/auth/password — смена собственного пароля.
 *
 * До этого сменить пароль было нечем вообще: учётки заводит сид с
 * общеизвестными паролями, а администратор мог только создать пользователя.
 * Меняет пароль ТОЛЬКО себе и только после подтверждения текущего — чтобы
 * забытая открытая сессия не превращалась в захват учётной записи.
 *
 * Открыт и до обязательной смены пароля — ради неё и открыт: пароль,
 * заданный не самим пользователем, меняется здесь же, и отметка снимается
 * (План_устранения 2.1).
 *
 * Смена пароля отзывает все сессии пользователя — версия токенов растёт
 * (2.3). Эта сессия продолжается: ответ несёт новые токены.
 */
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH),
})

authRouter.post('/password', requireAuthForPasswordChange, validate(changePasswordSchema), async (req: AuthRequest, res: Response, next) => {
  try {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user || !user.isActive) { res.status(401).json({ message: 'Пользователь не найден' }); return }

    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      res.status(422).json({ message: 'Текущий пароль неверен', code: 'WRONG_PASSWORD' })
      return
    }
    if (await bcrypt.compare(newPassword, user.passwordHash)) {
      res.status(422).json({ message: 'Новый пароль совпадает с текущим', code: 'SAME_PASSWORD' })
      return
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
      select: { id: true, role: true, tokenVersion: true },
    })
    await audit(user.id, 'user.password_change', 'User', user.id, {})

    const claims = { userId: updated.id, role: updated.role, tokenVersion: updated.tokenVersion }
    const [accessToken, refreshToken] = await Promise.all([signAccess(claims), signRefresh(claims)])
    res.json({ accessToken, refreshToken })
  } catch (e) { next(e) }
})

/**
 * DELETE /api/auth/logout — выход на этом устройстве: токены удаляет клиент.
 * Отдельный токен сервер не отзывает — для этого «Выйти на всех
 * устройствах» ниже. Открыт и до обязательной смены пароля.
 */
authRouter.delete('/logout', requireAuthForPasswordChange, async (_req: AuthRequest, res: Response, next) => {
  try {
    res.status(204).send()
  } catch (e) { next(e) }
})

/**
 * POST /api/auth/logout-all — выйти на всех устройствах (План_устранения
 * 2.3): версия токенов растёт, и все выданные токены пользователя, включая
 * этот, больше не принимаются. Аудит `user.logout_all`.
 */
authRouter.post('/logout-all', requireAuthForPasswordChange, async (req: AuthRequest, res: Response, next) => {
  try {
    await prisma.user.update({ where: { id: req.userId }, data: { tokenVersion: { increment: 1 } } })
    await audit(req.userId, 'user.logout_all', 'User', req.userId, {})
    res.status(204).send()
  } catch (e) { next(e) }
})
