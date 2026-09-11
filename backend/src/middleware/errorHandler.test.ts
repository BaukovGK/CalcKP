import { describe, expect, it, vi } from 'vitest'

vi.mock('../utils/logger', () => ({ logger: { log: vi.fn() } }))

import { errorHandler } from './errorHandler'
import { logger } from '../utils/logger'

/** Ответ обработчика: статус и тело. */
function respond(err: Error) {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }
  errorHandler(err, { method: 'DELETE', originalUrl: '/api/projects/p1' } as never, res as never, () => {})
  return res
}

/** Ошибка с кодом, как её бросает Prisma. */
const prismaError = (code: string, message: string) => Object.assign(new Error(message), { code })

describe('errorHandler', () => {
  // План_реализации §4.2 №5: несуществующая запись давала 500.
  it('Prisma P2025 «запись не найдена» — 404 без текста Prisma', () => {
    const res = respond(prismaError('P2025', 'An operation failed because it depends on one or more records that were required but not found.'))
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ message: 'Запись не найдена' })
    expect(logger.log).toHaveBeenLastCalledWith('warn', expect.any(String), expect.objectContaining({ status: 404, prismaCode: 'P2025' }))
  })

  it('ожидаемый статус — свой текст', () => {
    const res = respond(Object.assign(new Error('Проект не найден'), { status: 404 }))
    expect(res.statusCode).toBe(404)
    expect(res.body).toEqual({ message: 'Проект не найден' })
  })

  it('прочий сбой — 500 без подробностей наружу, в лог — ошибкой', () => {
    const res = respond(prismaError('P1001', "Can't reach database server"))
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ message: 'Внутренняя ошибка сервера' })
    expect(logger.log).toHaveBeenLastCalledWith('error', "Can't reach database server", expect.objectContaining({ status: 500 }))
  })
})
