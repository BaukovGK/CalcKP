import type { RequestHandler } from 'express'
import type { AuthRequest } from './auth'

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    const role = (req as AuthRequest).userRole
    if (!role || !roles.includes(role)) {
      res.status(403).json({ message: 'Недостаточно прав' })
      return
    }
    next()
  }
}
