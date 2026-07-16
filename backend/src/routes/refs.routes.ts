import { Router } from 'express'
import { requireAuth } from '../middleware/auth'

export const refsRouter = Router()
refsRouter.use('/', requireAuth)

// GET /api/refs/nomenclature — справочник НН (пока из статики, в будущем из БД)
refsRouter.get('/nomenclature', async (_req, res, next) => {
  try {
    // TODO: заменить на prisma.priceItem.findMany() сгруппированных по category.
    //       Сейчас фронт использует локальный файл src/data/nomenclature.ts
    //       После наполнения PriceItem — возвращать { [category]: NomItem[] }
    res.json({ message: 'Справочник НН — интеграция в Sprint 5' })
  } catch (e) { next(e) }
})

// GET /api/refs/pipe-weights
refsRouter.get('/pipe-weights', (_req, res) => {
  // TODO: вернуть таблицу весов труб по DN и толщине стенки для расчёта массы корпуса.
  //       Нужна для автоматического расчёта весовых позиций в CalcEngine.
  res.json({ message: 'Веса труб — Sprint 5' })
})
