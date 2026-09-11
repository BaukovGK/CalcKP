import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger'

/**
 * Последний обработчик: превращает исключение в ответ и пишет его в лог.
 *
 * Наружу текст ошибки уходит только для «ожидаемых» статусов — на 500 клиент
 * получает общую формулировку, чтобы наружу не утекали детали БД и путей.
 * В лог при этом идёт всё: стек, маршрут и пользователь. Раньше писался только
 * `err.message`, и по логу нельзя было понять ни где упало, ни у кого.
 *
 * Prisma P2025 — «запись для изменения или удаления не найдена» — это 404, а
 * не сбой: маршруты проверяют запись заранее, но её могут удалить между
 * проверкой и записью (План_реализации §4.2 №5). P2002 — нарушение
 * уникальности, та же гонка с другой стороны: запись с такими данными
 * успели создать — 409 (План_устранения 2.5).
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const prismaCode = (err as { code?: string }).code
  const notFound = prismaCode === 'P2025'
  const conflict = prismaCode === 'P2002'
  const status = (err as { status?: number }).status ?? (notFound ? 404 : conflict ? 409 : 500)

  logger.log(status >= 500 ? 'error' : 'warn', err.message, {
    status,
    method: req.method,
    path: req.originalUrl,
    userId: (req as { userId?: string }).userId,
    // Код Prisma (P2025 «запись не найдена» и подобные) — по нему сразу видно
    // класс проблемы, не разбирая стек.
    prismaCode,
    stack: err.stack,
  })

  const message =
    status === 500 ? 'Внутренняя ошибка сервера'
      : notFound ? 'Запись не найдена'
        : conflict ? 'Запись с такими данными уже есть'
          : err.message
  res.status(status).json({ message })
}
