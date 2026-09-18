import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import { seesAllProjects } from '../utils/access'
import { buildProjectKpDocument, documentFileName } from '../utils/kp-document'
import { renderKpDocx } from '../utils/kp-docx'
import { renderKpPdf } from '../utils/kp-pdf'
import { renderKpXlsx } from '../utils/kp-xlsx'
import { shellWallMm } from '../utils/kp-lookup'
import { parseKpHeader } from '../utils/kp-payload'
import { blocksDeletion, PRINTABLE_REASONS } from '../utils/snapshot-reason'
import { projectDeletionBlocks, projectDeletionMessage } from '../utils/project-delete'
import type { SnapshotReason } from '@prisma/client'
import type { Response, NextFunction } from 'express'

/** Причины слепков, защищающих расчёт от удаления: выпуск КП и ручная фиксация. */
const DELETION_BLOCKING_REASONS = (['CREATE', 'MANUAL', 'KP'] as SnapshotReason[]).filter(blocksDeletion)

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
    await audit((req as AuthRequest).userId, 'project.create', 'Project', project.id, {
      title: project.title,
      customer: project.customer,
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
    // В журнал — что именно правили: карточка проекта попадает в КП (заказчик,
    // объект, адрес), и «кто поменял заказчика» — вопрос, который задают.
    await audit(auth.userId, 'project.update', 'Project', id, {
      title: updated.title,
      changed: Object.keys(req.body as Record<string, unknown>),
    })
    res.json(updated)
  } catch (e) { next(e) }
})

/**
 * DELETE /api/projects/:id (ADMIN) — проект вместе с единицами оборудования.
 *
 * Окно подтверждения обещает «со всеми единицами», и так и происходит: единицы
 * удаляются вместе с проектом одной транзакцией. Удалить только проект нельзя —
 * `Estimate.projectId` объявлен `ON DELETE SET NULL`, и расчёты остались бы без
 * заказчика и объекта, которые печатаются в КП.
 *
 * Правила — те же, что у единицы по отдельности (`utils/project-delete.ts`):
 * утверждённый расчёт и расчёт с выпущенным КП или зафиксированной версией не
 * удаляются. Хоть одна такая единица — 422 `PROJECT_UNITS_PROTECTED` со
 * списком, и не удаляется ничего: удалить полпроекта хуже, чем ничего.
 */
projectsRouter.delete('/:id', requireRole('ADMIN'), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id = String(req.params.id)

    const project = await prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        estimates: {
          select: {
            id: true,
            title: true,
            status: true,
            deviceType: true,
            totalRub: true,
            _count: { select: { snapshots: { where: { reason: { in: DELETION_BLOCKING_REASONS } } } } },
          },
        },
      },
    })
    if (!project) { res.status(404).json({ message: 'Проект не найден' }); return }

    const blocks = projectDeletionBlocks(
      project.estimates.map((e) => ({
        id: e.id,
        title: e.title,
        status: e.status,
        protectedSnapshots: e._count.snapshots,
      })),
    )
    if (blocks.length > 0) {
      res.status(422).json({
        message: projectDeletionMessage(blocks),
        code: 'PROJECT_UNITS_PROTECTED',
        units: blocks,
      })
      return
    }

    // Слепки создания уходят каскадом (EstimateSnapshot → Estimate: Cascade).
    await prisma.$transaction([
      prisma.estimate.deleteMany({ where: { projectId: id } }),
      prisma.project.delete({ where: { id } }),
    ])

    // Каждая единица — своей записью: цепочка событий по расчёту в журнале
    // должна заканчиваться удалением, а не обрываться.
    for (const e of project.estimates) {
      await audit(auth.userId, 'estimate.delete', 'Estimate', e.id, {
        title: e.title,
        deviceType: e.deviceType,
        project: project.title,
        totalRub: e.totalRub,
      })
    }
    await audit(auth.userId, 'project.delete', 'Project', id, {
      title: project.title,
      units: project.estimates.length,
    })
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
 * GET /api/projects/:id/kp/export?format=docx|pdf|xlsx&estimates=id,id — КП на проект.
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

    if (!['docx', 'pdf', 'xlsx'].includes(format)) {
      res.status(400).json({ message: 'format должен быть docx, pdf или xlsx' })
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
        author: { select: { name: true, position: true, phone: true, email: true } },
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

    // Каждая позиция печатается тем описанием и составом, с которыми по ней
    // выпускалось КП: правки менеджера лежат в её слепке.
    const units = await Promise.all(
      estimates.map(async (e) => {
        const snapshot = e.snapshots[0]!
        const header = parseKpHeader(snapshot.kpJson)
        return {
          estimateId: e.id,
          estimateTitle: e.title,
          deviceType: e.deviceType,
          wallMm: await shellWallMm(snapshot.bundlesJson),
          kp: header.position ?? null,
          snapshot: {
            version: snapshot.version,
            priceListVersion: snapshot.priceListVersion,
            totalRub: snapshot.totalRub,
            createdAt: snapshot.createdAt,
            bundlesJson: snapshot.bundlesJson,
          },
        }
      }),
    )

    // Номер у проектного КП свой, и журнальный номер единицы ему не подходит:
    // до отдельного выпуска проектного КП печатается «Исх. ___ от ⟨дата⟩».
    // Условия и подпись — умолчания с адресом объекта проекта.
    const doc = buildProjectKpDocument({
      projectId: project.id,
      project: { title: project.title, customer: project.customer, address: project.address },
      units,
      // Исполнитель проектного КП — автор первой единицы: его учётная запись
      // несёт и должность, и рабочий телефон.
      executor: estimates[0]?.author ?? {},
    })

    const body =
      format === 'pdf'
        ? await renderKpPdf(doc)
        : format === 'xlsx'
          ? await renderKpXlsx(doc)
          : await renderKpDocx(doc)
    const filename = documentFileName(doc, format)

    await audit(auth.userId, 'project.kp.export', 'Project', id, {
      format,
      units: doc.positions.length,
      positions: doc.meta.positionsCount,
    })

    res.setHeader(
      'Content-Type',
      format === 'pdf'
        ? 'application/pdf'
        : format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
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
