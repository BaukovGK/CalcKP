import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import type { Response, NextFunction } from 'express'

export const pricesRouter = Router()
pricesRouter.use('/', requireAuth)

// GET /api/prices
pricesRouter.get('/', async (_req, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.priceItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    })
    res.json(items)
  } catch (e) { next(e) }
})

const patchSchema = z.object({
  priceRub: z.number().nonnegative().optional(),
  supplier: z.string().optional(),
})

// PATCH /api/prices/:id
pricesRouter.patch('/:id', requireRole('ADMIN', 'BUYER'), validate(patchSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const id      = String(req.params.id)
    const current = await prisma.priceItem.findUnique({ where: { id } })
    if (!current) { res.status(404).json({ message: 'Позиция не найдена' }); return }
    const updated = await prisma.priceItem.update({ where: { id }, data: req.body })
    await prisma.priceHistory.create({
      data: {
        priceItemId: current.id,
        oldPrice:    current.priceRub,
        newPrice:    req.body.priceRub ?? current.priceRub,
        changedById: (req as AuthRequest).userId,
      },
    })
    res.json(updated)
  } catch (e) { next(e) }
})

// POST /api/prices/import
// TODO: реализовать импорт прайс-листа из Excel (.xlsx).
//       Логика: парсить multipart/form-data с файлом → ExcelJS/SheetJS →
//       upsert prisma.priceItem по lookupKey (category:name) →
//       создать PriceHistory записи для изменённых цен →
//       вернуть { updated, created, skipped }.
pricesRouter.post('/import', requireRole('ADMIN', 'BUYER'), (_req, res) => {
  res.status(501).json({ message: 'Импорт из Excel — не реализован' })
})
