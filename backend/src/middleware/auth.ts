import type { Request, Response, NextFunction, RequestHandler } from 'express'
import { verifyToken } from '../utils/jwt'

export interface AuthRequest extends Request {
  userId?: string
  userRole?: string
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Необходима авторизация' })
    return
  }
  try {
    const payload = await verifyToken(header.slice(7))
    ;(req as AuthRequest).userId   = payload.userId
    ;(req as AuthRequest).userRole = payload.role
    next()
  } catch {
    res.status(401).json({ message: 'Недействительный или истёкший токен' })
  }
}
