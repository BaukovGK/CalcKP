import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { calcPumpStationDimensions } from '../utils/pump-station-dimensions'
import { calcRingStiffnessPa } from '../utils/ring-stiffness'

export const pumpStationRouter = Router()
pumpStationRouter.use('/', requireAuth)

const dimensionsSchema = z.object({
  inletPipeHeightM: z.number().min(0),
  mvkRequired: z.boolean(),
  capacityM3h: z.number().positive(),
  diameterMm: z.number().positive().optional(),
  minPumpLevelM: z.number().min(0).optional(),
  perMinuteRunMin: z.number().positive().optional(),
  startsPerHour: z.number().positive().optional(),
  // Подбор и проверка SN — вне зоны ответственности этой функции (см. модуль
  // pump-station-dimensions.ts); значение только принимается и возвращается.
  ringStiffnessPa: z.number().positive().optional(),
})

/**
 * POST /api/pump-station/dimensions — габарит насосной станции (диаметр, высота).
 *
 * Чистый расчёт `calcPumpStationDimensions` (см. `utils/pump-station-dimensions.ts`),
 * обёрнутый в эндпоинт для интеграции с калькулятором.
 */
pumpStationRouter.post('/dimensions', (req, res, next) => {
  try {
    const input = dimensionsSchema.parse(req.body)
    res.json(calcPumpStationDimensions(input))
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ message: 'Некорректные параметры', issues: e.issues })
      return
    }
    next(e)
  }
})

const ringStiffnessSchema = z.object({
  mge: z.boolean(),
  inletPipeDepthM: z.number().min(0),
})

/**
 * POST /api/pump-station/ring-stiffness — кольцевая жёсткость корпуса SN, Па.
 *
 * Чистый расчёт `calcRingStiffnessPa` (см. `utils/ring-stiffness.ts`).
 */
pumpStationRouter.post('/ring-stiffness', (req, res, next) => {
  try {
    const { mge, inletPipeDepthM } = ringStiffnessSchema.parse(req.body)
    res.json({ ringStiffnessPa: calcRingStiffnessPa(mge, inletPipeDepthM) })
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ message: 'Некорректные параметры', issues: e.issues })
      return
    }
    next(e)
  }
})
