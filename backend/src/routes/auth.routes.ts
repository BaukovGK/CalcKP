import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { signAccess, signRefresh, verifyToken } from '../utils/jwt'
import { validate } from '../middleware/validate'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import type { Response } from 'express'

export const authRouter = Router()

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(6),
})

// POST /api/auth/login
authRouter.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || !user.isActive) {
      res.status(401).json({ message: 'Неверный email или пароль' }); return
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      res.status(401).json({ message: 'Неверный email или пароль' }); return
    }
    const payload = { userId: user.id, role: user.role }
    const [accessToken, refreshToken] = await Promise.all([
      signAccess(payload),
      signRefresh(payload),
    ])
    res.json({
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    })
  } catch (e) { next(e) }
})

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string }
    if (!refreshToken) { res.status(400).json({ message: 'refreshToken обязателен' }); return }
    const payload    = await verifyToken(refreshToken)
    const user       = await prisma.user.findUnique({ where: { id: payload.userId } })
    if (!user || !user.isActive) { res.status(401).json({ message: 'Пользователь не найден' }); return }
    const accessToken = await signAccess({ userId: user.id, role: user.role })
    res.json({ accessToken })
  } catch {
    res.status(401).json({ message: 'Недействительный refresh-токен' })
  }
})

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: AuthRequest, res: Response, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, name: true, email: true, role: true },
    })
    if (!user) { res.status(401).json({ message: 'Пользователь не найден' }); return }
    res.json(user)
  } catch (e) { next(e) }
})

// DELETE /api/auth/logout
authRouter.delete('/logout', requireAuth, async (_req: AuthRequest, res: Response, next) => {
  try {
    // Stateless JWT — на клиенте просто удалить токены.
    // TODO: добавить token blacklist через Redis (SET ntt:bl:<jti> EX <ttl>).
    //       При refresh и requireAuth — проверять наличие jti в blacklist.
    //       Текущая реализация безопасна пока JWT короткоживущие (15 мин).
    res.status(204).send()
  } catch (e) { next(e) }
})
