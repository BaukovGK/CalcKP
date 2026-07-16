import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import type { Response, NextFunction } from 'express'

export const estimatesRouter = Router()
estimatesRouter.use('/', requireAuth)

const createSchema = z.object({
  title:      z.string().min(1),
  deviceType: z.enum(['KNS', 'EMK', 'KOL']),
  surveyData: z.record(z.string(), z.unknown()).optional().default({}),
})

// GET /api/estimates
estimatesRouter.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const auth  = req as AuthRequest
    const where = auth.userRole === 'ADMIN' ? {} : { authorId: auth.userId }
    const estimates = await prisma.estimate.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, deviceType: true, status: true,
        totalRub: true, updatedAt: true, surveyData: true,
        author: { select: { name: true } },
      },
    })
    res.json(estimates)
  } catch (e) { next(e) }
})

// POST /api/estimates
estimatesRouter.post('/', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(createSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const estimate = await prisma.estimate.create({
      data:    { ...req.body, authorId: (req as AuthRequest).userId! },
      include: { author: { select: { name: true } } },
    })
    res.status(201).json(estimate)
  } catch (e) { next(e) }
})

// GET /api/estimates/:id
estimatesRouter.get('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: { snapshots: { orderBy: { version: 'desc' }, take: 1 } },
    })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (auth.userRole !== 'ADMIN' && estimate.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    res.json(estimate)
  } catch (e) { next(e) }
})

// PATCH /api/estimates/:id/status
const statusSchema = z.object({
  status: z.enum(['DRAFT', 'CALC', 'REVIEW', 'APPROVED', 'REJECTED']),
})

estimatesRouter.patch('/:id/status', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(statusSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth  = req as AuthRequest
    const id    = String(req.params.id)
    const to    = req.body.status as string

    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (auth.userRole !== 'ADMIN' && estimate.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    const from = estimate.status
    const role = auth.userRole!
    const managerUp   = ['MANAGER', 'ADMIN'].includes(role)
    const engineerUp  = ['ENGINEER', 'MANAGER', 'ADMIN'].includes(role)

    const allowed =
      (from === 'DRAFT'   && to === 'CALC'     && engineerUp) ||
      (from === 'CALC'    && to === 'REVIEW'   && managerUp)  ||
      (from === 'REVIEW'  && to === 'APPROVED' && managerUp)  ||
      (from === 'REVIEW'  && to === 'CALC'     && managerUp)  ||
      (to   === 'REJECTED'                     && role === 'ADMIN')

    if (!allowed) {
      res.status(422).json({ message: `Переход ${from}→${to} недопустим для роли ${role}` }); return
    }

    const updated = await prisma.estimate.update({ where: { id }, data: { status: to as 'DRAFT' | 'CALC' | 'REVIEW' | 'APPROVED' | 'REJECTED' } })
    res.json(updated)
  } catch (e) { next(e) }
})

// DELETE /api/estimates/:id
estimatesRouter.delete('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)

    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (auth.userRole !== 'ADMIN' && estimate.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    if (!['DRAFT', 'REJECTED'].includes(estimate.status)) {
      res.status(422).json({ message: 'Удалить можно только расчёт в статусе Черновик или Отклонён' }); return
    }

    await prisma.estimate.delete({ where: { id } })
    res.status(204).send()
  } catch (e) { next(e) }
})

// TODO: POST /api/estimates/:id/snapshot — сохранить версию расчёта.
//       Данные: { bundlesJson, totalRub, priceListVersion }.
//       Версию брать как MAX(version)+1 для данного estimateId.

// PATCH /api/estimates/:id/survey
estimatesRouter.patch('/:id/survey', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const estimate = await prisma.estimate.findUnique({ where: { id } })
    if (!estimate) { res.status(404).json({ message: 'Расчёт не найден' }); return }
    if (auth.userRole !== 'ADMIN' && estimate.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    const merged = { ...(estimate.surveyData as object ?? {}), ...req.body }
    const updated = await prisma.estimate.update({
      where: { id },
      data:  { surveyData: merged, status: 'CALC' },
    })
    res.json(updated)
  } catch (e) { next(e) }
})
