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

/**
 * PATCH /api/admin/users/:id (ADMIN).
 *
 * Две защиты от необратимого состояния: смены и сброса пароля в системе нет,
 * поэтому потерять доступ администратора — значит потерять управление совсем.
 *  1. нельзя снять роль или деактивировать ПОСЛЕДНЕГО активного ADMIN;
 *  2. нельзя понизить или деактивировать самого себя — даже если админов
 *     несколько: это делается чужими руками и осознанно.
 */
adminRouter.patch('/users/:id', validate(patchUserSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const id   = String(req.params.id)
    // Тип из самой схемы: role здесь — union литералов ролей, а не string,
    // иначе Prisma не примет его как enum Role.
    const patch = req.body as z.infer<typeof patchUserSchema>

    // Без явной проверки обновление несуществующего id давало P2025 и 500.
    const current = await prisma.user.findUnique({ where: { id }, select: { role: true, isActive: true } })
    if (!current) { res.status(404).json({ message: 'Пользователь не найден' }); return }

    const losesAdmin =
      current.role === 'ADMIN' &&
      ((patch.role != null && patch.role !== 'ADMIN') || patch.isActive === false)

    if (losesAdmin && id === auth.userId) {
      res.status(422).json({
        message: 'Нельзя снять права администратора с самого себя — попросите другого администратора',
        code: 'SELF_DEMOTION',
      })
      return
    }

    if (losesAdmin && current.isActive) {
      const activeAdmins = await prisma.user.count({ where: { role: 'ADMIN', isActive: true } })
      if (activeAdmins <= 1) {
        res.status(422).json({
          message:
            'Это последний активный администратор. Сменить или сбросить пароль в системе нельзя, ' +
            'поэтому снятие прав сделало бы её неуправляемой. Сначала назначьте другого администратора.',
          code: 'LAST_ADMIN',
        })
        return
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data:  patch,
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    })
    await audit(auth.userId, 'user.update', 'User', id, patch)
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
