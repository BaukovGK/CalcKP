import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import type { Response, NextFunction } from 'express'

export const projectsRouter = Router()
projectsRouter.use('/', requireAuth)

const createSchema = z.object({
  title:    z.string().min(1),
  address:  z.string().optional(),
  customer: z.string().optional(),
  notes:    z.string().optional(),
})

const updateSchema = createSchema.partial()

/**
 * Чтение всех проектов: ADMIN; MANAGER — проверяет чужие расчёты (§4.3);
 * VIEWER — наблюдатель (просмотр расчёта, вкладка Битрикс24).
 */
function seesAllProjects(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER'
}

// GET /api/projects
projectsRouter.get('/', async (req, res: Response, next: NextFunction) => {
  try {
    const auth  = req as AuthRequest
    const where = seesAllProjects(auth.userRole) ? {} : { authorId: auth.userId }
    const projects = await prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, title: true, address: true, customer: true,
        updatedAt: true, createdAt: true,
        author: { select: { name: true } },
        estimates: {
          select: { id: true, title: true, deviceType: true, status: true, totalRub: true },
        },
      },
    })
    res.json(projects)
  } catch (e) { next(e) }
})

// POST /api/projects
projectsRouter.post('/', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(createSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.create({
      data: { ...req.body, authorId: (req as AuthRequest).userId! },
      include: { author: { select: { name: true } }, estimates: true },
    })
    res.status(201).json(project)
  } catch (e) { next(e) }
})

// GET /api/projects/:id
projectsRouter.get('/:id', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        author: { select: { name: true } },
        estimates: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true, title: true, deviceType: true, status: true,
            totalRub: true, updatedAt: true, surveyData: true,
            author: { select: { name: true } },
          },
        },
      },
    })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }
    if (!seesAllProjects(auth.userRole) && project.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    res.json(project)
  } catch (e) { next(e) }
})

// PATCH /api/projects/:id
projectsRouter.patch('/:id', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(updateSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    const project = await prisma.project.findUnique({ where: { id } })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }
    if (auth.userRole !== 'ADMIN' && project.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    const updated = await prisma.project.update({ where: { id }, data: req.body })
    res.json(updated)
  } catch (e) { next(e) }
})

/**
 * DELETE /api/projects/:id (ADMIN).
 *
 * Расчёты вместе с проектом НЕ удаляются: внешний ключ объявлен
 * `ON DELETE SET NULL`, поэтому они остались бы без проекта — а вместе с ним
 * без заказчика, объекта и адреса, которые печатаются в КП. Поэтому проект с
 * расчётами не удаляется вовсе: сначала разберитесь с расчётами.
 */
projectsRouter.delete('/:id', requireRole('ADMIN'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)

    // Без явной проверки удаление несуществующего проекта давало P2025 и 500.
    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, title: true, _count: { select: { estimates: true } } },
    })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }

    if (project._count.estimates > 0) {
      res.status(422).json({
        message:
          `В проекте ${project._count.estimates} расчёт(ов). Удаление проекта не удаляет их, ` +
          'а оставляет без заказчика и объекта — эти данные печатаются в КП. ' +
          'Сначала удалите или перенесите расчёты.',
        code: 'PROJECT_HAS_ESTIMATES',
        estimateCount: project._count.estimates,
      })
      return
    }

    await prisma.project.delete({ where: { id } })
    await audit(auth.userId, 'project.delete', 'Project', id, { title: project.title })
    res.status(204).send()
  } catch (e) { next(e) }
})

// POST /api/projects/:id/estimates — создать единицу оборудования внутри проекта
const addEstimateSchema = z.object({
  title:      z.string().min(1),
  deviceType: z.enum(['KNS', 'EMK', 'KOL']),
  surveyData: z.record(z.string(), z.unknown()).optional().default({}),
})

projectsRouter.post('/:id/estimates', requireRole('ADMIN', 'MANAGER', 'ENGINEER'), validate(addEstimateSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth      = req as AuthRequest
    const projectId = String(req.params.id)
    const project   = await prisma.project.findUnique({ where: { id: projectId } })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }
    if (auth.userRole !== 'ADMIN' && project.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }
    const estimate = await prisma.estimate.create({
      data:    { ...req.body, projectId, authorId: auth.userId! },
      include: { author: { select: { name: true } } },
    })
    res.status(201).json(estimate)
  } catch (e) { next(e) }
})
