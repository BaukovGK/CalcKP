import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  logger.error(err.message)
  const status = (err as any).status ?? 500
  res.status(status).json({ message: status === 500 ? 'Внутренняя ошибка сервера' : err.message })
}
