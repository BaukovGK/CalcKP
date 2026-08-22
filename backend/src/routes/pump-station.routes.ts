import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { calcPumpStationDimensions } from '../utils/pump-station-dimensions'
import { calcRingStiffnessPa } from '../utils/ring-stiffness'
import { calcDischargePipeDiameterMm } from '../utils/pipe-hydraulics'
import { selectPump } from '../utils/pump-selection'
import { prisma } from '../utils/prisma'

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

const pipeDiameterSchema = z.object({
  flowM3h: z.number().positive(),
  designVelocityMs: z.number().positive().optional(),
})

/**
 * POST /api/pump-station/discharge-pipe-diameter — диаметр напорного
 * трубопровода, мм, по расходу.
 *
 * Чистый расчёт `calcDischargePipeDiameterMm` (см. `utils/pipe-hydraulics.ts`).
 */
pumpStationRouter.post('/discharge-pipe-diameter', (req, res, next) => {
  try {
    const { flowM3h, designVelocityMs } = pipeDiameterSchema.parse(req.body)
    res.json(calcDischargePipeDiameterMm(flowM3h, designVelocityMs))
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ message: 'Некорректные параметры', issues: e.issues })
      return
    }
    next(e)
  }
})

const pumpSelectionSchema = z.object({
  flowM3h: z.number().positive(),
  headM: z.number().positive(),
})

/**
 * POST /api/pump-station/select-pump — подбор марки насоса по расходу и
 * напору (рабочей точке).
 *
 * Каталог берётся из БД (`Pump`, см. `prisma/seed-data/pumps.json`), отбор —
 * чистая функция `selectPump` (см. `utils/pump-selection.ts`).
 */
pumpStationRouter.post('/select-pump', async (req, res, next) => {
  try {
    const { flowM3h, headM } = pumpSelectionSchema.parse(req.body)
    const pumps = await prisma.pump.findMany()
    res.json(selectPump(flowM3h, headM, pumps))
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ message: 'Некорректные параметры', issues: e.issues })
      return
    }
    next(e)
  }
})
