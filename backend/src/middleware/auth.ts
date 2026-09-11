import type { Request, RequestHandler } from 'express'
import { authenticate, AuthError, type FindAuthUser } from '../utils/auth-check'
import { prisma } from '../utils/prisma'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
}

const findAuthUser: FindAuthUser = (id) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } })

/**
 * Пропускает запрос с действующим токеном доступа. Роль (`userRole`) — та,
 * что у пользователя в БД сейчас, а не та, что была при выдаче токена
 * (`utils/auth-check.ts`).
 */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Необходима авторизация' })
    return
  }
  try {
    const { userId, role } = await authenticate(header.slice(7), findAuthUser)
    ;(req as AuthRequest).userId   = userId
    ;(req as AuthRequest).userRole = role
    next()
  } catch (e) {
    if (e instanceof AuthError) {
      res.status(401).json({ message: e.message })
      return
    }
    // Сбой БД — не «плохой токен»: 500 через общий обработчик.
    next(e)
  }
}
