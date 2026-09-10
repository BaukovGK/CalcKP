import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { buildProjectKpDocument, KpSpecificationIncomplete } from '../utils/kp-document'
import { renderKpDocx } from '../utils/kp-docx'
import { renderKpPdf } from '../utils/kp-pdf'
import { PRINTABLE_REASONS } from '../utils/snapshot-reason'
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
            // Последняя редакция: по ней экран проекта видит, выпускалось ли
            // КП по единице — без этого «КП на проект» пришлось бы предлагать
            // вслепую и ловить отказ сервера.
            // Только печатные слепки: слепок создания единицы есть у каждой
            // новой, и считать по нему единицу «готовой к КП» — значит
            // напечатать непроверенный расчёт.
            snapshots: {
              where: { reason: { in: [...PRINTABLE_REASONS] } },
              orderBy: { version: 'desc' },
              take: 1,
              select: { version: true, createdAt: true },
            },
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

/**
 * GET /api/projects/:id/kp/export?format=docx|pdf&estimates=id,id — КП на проект.
 *
 * Документ собирается из снапшотов единиц, а не из их текущего состояния:
 * расчёт после выпуска КП не замораживается и продолжает правиться
 * (Механика §10). По каждой единице берётся её последняя редакция.
 *
 * Единица без снапшота — отказ 422, а не пропуск: молча выброшенная из
 * документа единица обнаружится уже у заказчика. Чтобы выпустить КП на часть
 * проекта, перечислите нужные единицы в `estimates`.
 */
projectsRouter.get('/:id/kp/export', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)
    const format = String(req.query.format ?? 'docx')

    if (!['docx', 'pdf'].includes(format)) {
      res.status(400).json({ message: 'format должен быть docx или pdf' })
      return
    }

    const project = await prisma.project.findUnique({
      where: { id },
      select: { id: true, title: true, customer: true, address: true, authorId: true },
    })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }
    // Чтение КП шире правки: наблюдатель тоже должен уметь открыть документ.
    if (!seesAllProjects(auth.userRole) && project.authorId !== auth.userId) {
      res.status(403).json({ message: 'Нет доступа' }); return
    }

    const onlyRaw = String(req.query.estimates ?? '').trim()
    const only = onlyRaw ? onlyRaw.split(',').map((s) => s.trim()).filter(Boolean) : null

    const estimates = await prisma.estimate.findMany({
      where: { projectId: id, ...(only ? { id: { in: only } } : {}) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, title: true, deviceType: true,
        snapshots: { where: { reason: { in: [...PRINTABLE_REASONS] } }, orderBy: { version: 'desc' }, take: 1 },
      },
    })

    if (estimates.length === 0) {
      res.status(422).json({
        message: only
          ? 'Ни одна из перечисленных единиц не найдена в этом проекте'
          : 'В проекте нет единиц оборудования — печатать нечего',
        code: 'KP_PROJECT_EMPTY',
      })
      return
    }

    const notIssued = estimates.filter((e) => e.snapshots.length === 0)
    if (notIssued.length > 0) {
      res.status(422).json({
        message:
          `Нельзя выпустить КП на проект: по ${notIssued.length} ед. КП ещё не выпускалось — ` +
          notIssued.map((e) => `«${e.title}»`).join(', '),
        code: 'KP_UNITS_NOT_ISSUED',
        units: notIssued.map((e) => ({ id: e.id, title: e.title })),
        note: 'Выпустите КП по каждой единице или перечислите готовые в параметре estimates.',
      })
      return
    }

    let doc
    try {
      doc = buildProjectKpDocument({
        projectId: project.id,
        project: { title: project.title, customer: project.customer, address: project.address },
        units: estimates.map((e) => {
          const snapshot = e.snapshots[0]!
          return {
            estimateId: e.id,
            estimateTitle: e.title,
            deviceType: e.deviceType,
            snapshot: {
              version: snapshot.version,
              priceListVersion: snapshot.priceListVersion,
              totalRub: snapshot.totalRub,
              createdAt: snapshot.createdAt,
              bundlesJson: snapshot.bundlesJson,
            },
          }
        }),
      })
    } catch (e) {
      // Спецификацию не собрать точно — печатать нельзя (см. kp-document.ts).
      if (e instanceof KpSpecificationIncomplete) {
        res.status(422).json({
          message:
            `Печать невозможна: в расчёте «${e.estimateTitle}» ${e.rows.length} строк(и) задают ` +
            'количество выражением, а в этой редакции не сохранён его результат. ' +
            'Откройте расчёт, сохраните и выпустите КП заново.',
          code: 'KP_SPEC_INCOMPLETE',
          estimateTitle: e.estimateTitle,
          rows: e.rows.slice(0, 20),
          count: e.rows.length,
        })
        return
      }
      throw e
    }

    const body = format === 'pdf' ? await renderKpPdf(doc) : await renderKpDocx(doc)
    const filename = `${doc.number}.${format}`

    await audit(auth.userId, 'project.kp.export', 'Project', id, {
      format,
      units: doc.positions.length,
      positions: doc.positionsCount,
    })

    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    // filename* — RFC 5987: имя кириллическое, латинский fallback обязателен.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kp-${project.id.slice(0, 8)}.${format}"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
    )
    res.send(body)
  } catch (e) { next(e) }
})
