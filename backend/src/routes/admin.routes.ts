import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import type { Response, NextFunction } from 'express'

/**
 * Роли (ТЗ §2) — один список на оба маршрута.
 *
 * Раньше перечень дублировался в двух zod-схемах, и при добавлении TECHNOLOG
 * в enum БД они разошлись: назначить новую роль было невозможно.
 */
const ROLES = ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNOLOG', 'BUYER', 'VIEWER'] as const

export const adminRouter = Router()
adminRouter.use('/', requireAuth)
adminRouter.use('/', requireRole('ADMIN'))

// GET /api/admin/users
adminRouter.get('/users', async (_req, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json(users)
  } catch (e) { next(e) }
})

const createUserSchema = z.object({
  email:    z.string().email(),
  name:     z.string().min(1),
  role:     z.enum(ROLES),
  password: z.string().min(6),
})

// POST /api/admin/users
adminRouter.post('/users', validate(createUserSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const { email, name, role, password } = req.body
    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, name, role, passwordHash },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    })
    await audit((req as AuthRequest).userId, 'user.create', 'User', user.id, {
      email: user.email,
      role: user.role,
    })
    res.status(201).json(user)
  } catch (e) { next(e) }
})

const patchUserSchema = z.object({
  name:     z.string().min(1).optional(),
  role:     z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
})

// PATCH /api/admin/users/:id
adminRouter.patch('/users/:id', validate(patchUserSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const id   = String(req.params.id)
    const user = await prisma.user.update({
      where: { id },
      data:  req.body,
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    })
    res.json(user)
  } catch (e) { next(e) }
})

// GET /api/admin/audit
adminRouter.get('/audit', async (_req, res: Response, next: NextFunction) => {
  try {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { name: true, email: true } } },
    })
    res.json(logs)
  } catch (e) { next(e) }
})
