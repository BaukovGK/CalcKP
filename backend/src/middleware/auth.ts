import type { Request, RequestHandler } from 'express'
import { authenticate, AuthError, PasswordChangeRequired, type FindAuthUser } from '../utils/auth-check'
import { prisma } from '../utils/prisma'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
}

const findAuthUser: FindAuthUser = (id) =>
  prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true, mustChangePassword: true } })

function authMiddleware(opts: { allowPasswordChange: boolean }): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ message: 'Необходима авторизация' })
      return
    }
    try {
      const { userId, role } = await authenticate(header.slice(7), findAuthUser, opts)
      ;(req as AuthRequest).userId   = userId
      ;(req as AuthRequest).userRole = role
      next()
    } catch (e) {
      if (e instanceof AuthError) {
        res.status(401).json({ message: e.message })
        return
      }
      if (e instanceof PasswordChangeRequired) {
        res.status(403).json({ message: e.message, code: 'PASSWORD_CHANGE_REQUIRED' })
        return
      }
      // Сбой БД — не «плохой токен»: 500 через общий обработчик.
      next(e)
    }
  }
}

/**
 * Пропускает запрос с действующим токеном доступа. Роль (`userRole`) — та,
 * что у пользователя в БД сейчас, а не та, что была при выдаче токена
 * (`utils/auth-check.ts`). Пользователь с паролем, заданным не им, получает
 * 403 `PASSWORD_CHANGE_REQUIRED` (План_устранения 2.1).
 */
export const requireAuth: RequestHandler = authMiddleware({ allowPasswordChange: false })

/**
 * То же для маршрутов, открытых и до обязательной смены пароля: «кто я»,
 * смена пароля, выход.
 */
export const requireAuthForPasswordChange: RequestHandler = authMiddleware({ allowPasswordChange: true })
