import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

/**
 * Последний обработчик: превращает исключение в ответ и пишет его в лог.
 *
 * Наружу текст ошибки уходит только для «ожидаемых» статусов — на 500 клиент
 * получает общую формулировку, чтобы наружу не утекали детали БД и путей.
 * В лог при этом идёт всё: стек, маршрут и пользователь. Раньше писался только
 * `err.message`, и по логу нельзя было понять ни где упало, ни у кого.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const status = (err as { status?: number }).status ?? 500

  logger.error(err.message, {
    status,
    method: req.method,
    path: req.originalUrl,
    userId: (req as { userId?: string }).userId,
    // Код Prisma (P2025 «запись не найдена» и подобные) — по нему сразу видно
    // класс проблемы, не разбирая стек.
    prismaCode: (err as { code?: string }).code,
    stack: err.stack,
  })

  res.status(status).json({ message: status === 500 ? 'Внутренняя ошибка сервера' : err.message })
}
