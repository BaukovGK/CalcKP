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
  mvk: z.boolean(),
  inletPipeDepthM: z.number().min(0),
})

/**
 * POST /api/pump-station/ring-stiffness — кольцевая жёсткость корпуса SN, Па.
 *
 * Чистый расчёт `calcRingStiffnessPa` (см. `utils/ring-stiffness.ts`).
 */
pumpStationRouter.post('/ring-stiffness', (req, res, next) => {
  try {
    const { mvk, inletPipeDepthM } = ringStiffnessSchema.parse(req.body)
    res.json({ ringStiffnessPa: calcRingStiffnessPa(mvk, inletPipeDepthM) })
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
  workingPumps: z.number().int().positive().optional(),
  designVelocityMs: z.number().positive().optional(),
})

/**
 * POST /api/pump-station/discharge-pipe-diameter — диаметр напорного
 * трубопровода, мм, по притоку и числу рабочих насосов.
 *
 * Чистый расчёт `calcDischargePipeDiameterMm` (см. `utils/pipe-hydraulics.ts`).
 */
pumpStationRouter.post('/discharge-pipe-diameter', (req, res, next) => {
  try {
    const { flowM3h, workingPumps, designVelocityMs } = pipeDiameterSchema.parse(req.body)
    res.json(calcDischargePipeDiameterMm(flowM3h, workingPumps, designVelocityMs))
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
  workingPumps: z.number().int().positive().optional(),
  /**
   * Окно запаса по напору, м. По умолчанию заводское 0,5…2,0: страхует не рост
   * притока (он уже в `headM`), а несовпадение реального насоса с паспортом.
   */
  minHeadMarginM: z.number().min(0).max(100).optional(),
  maxHeadMarginM: z.number().min(0).max(100).optional(),
})

/**
 * POST /api/pump-station/select-pump — подбор марки насоса по притоку,
 * напору и числу рабочих насосов (рабочей точке одного насоса).
 *
 * Каталог берётся из БД (`Pump` + точки характеристики `PumpCurvePoint`),
 * отбор — чистая функция `selectPump` (см. `utils/pump-selection.ts`): при
 * требуемом расходе кривая насоса должна давать напор не меньше требуемого.
 *
 * Кривые обязательно грузятся вместе с каталогом: без них `selectPump`
 * откатится на грубую рамку диапазонов и вернёт `APPROXIMATE_MATCH`.
 */
pumpStationRouter.post('/select-pump', async (req, res, next) => {
  try {
    const { flowM3h, headM, workingPumps, minHeadMarginM, maxHeadMarginM } = pumpSelectionSchema.parse(req.body)
    const rows = await prisma.pump.findMany({
      include: { curve: { orderBy: { idx: 'asc' }, select: { q: true, h: true, p2: true, p1: true, eff: true } } },
    })
    res.json(selectPump(flowM3h, headM, workingPumps, rows, { minHeadMarginM, maxHeadMarginM }))
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ message: 'Некорректные параметры', issues: e.issues })
      return
    }
    next(e)
  }
})
