import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { requireAuth, type AuthRequest } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { audit } from '../utils/audit'
import type { Response, NextFunction } from 'express'

/**
 * Редактор шаблонов (роль TECHNOLOG, ТЗ §2; Библиотека §6.2) — этап 1.
 *
 * Шаблоны материализуются из формул (`ntt-calculator/src/engines/template-*`)
 * и ДАННЫХ: норм патрубков, весов труб и инженерных матриц. Формулы — код,
 * данные — БД; технолог правит данные, и следующая материализация любого
 * расчёта берёт новые значения. Чтение — через существующий `/api/refs/*`.
 *
 * Все записи — upsert по естественному ключу справочника (dn / (dn,pn,sn) /
 * (kind,d,lengthMm)): у технолога нет понятия «id строки», он мыслит ключами
 * эталонных листов.
 */
export const templatesRouter = Router()
templatesRouter.use('/', requireAuth, requireRole('ADMIN', 'TECHNOLOG'))

// ── Нормы патрубков (NozzleNorm, ключ dn) ──────────────────────────────────

const nozzleSchema = z.object({
  odMm: z.number().nullable().optional(),
  minLengthMm: z.number().nullable().optional(),
  moldingMassKg: z.number().positive(),
  h1Mm: z.number().nullable().optional(),
  s1Mm: z.number().nullable().optional(),
  flangeMassKg: z.number().nullable().optional(),
  bolt: z.string().nullable().optional(),
  boltCount: z.number().int().nullable().optional(),
})

templatesRouter.put('/nozzle-norms/:dn', validate(nozzleSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const dn = Number(req.params.dn)
    if (!Number.isInteger(dn) || dn <= 0) { res.status(400).json({ message: 'dn — целое положительное' }); return }

    const norm = await prisma.nozzleNorm.upsert({
      where: { dn },
      update: req.body,
      create: { dn, ...req.body },
    })
    await audit(auth.userId, 'template.nozzle_norm.upsert', 'NozzleNorm', String(dn), req.body)
    res.json(norm)
  } catch (e) { next(e) }
})

templatesRouter.delete('/nozzle-norms/:dn', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const dn = Number(req.params.dn)
    const found = await prisma.nozzleNorm.findUnique({ where: { dn } })
    if (!found) { res.status(404).json({ message: `Нормы DN${dn} нет` }); return }

    await prisma.nozzleNorm.delete({ where: { dn } })
    await audit(auth.userId, 'template.nozzle_norm.delete', 'NozzleNorm', String(dn))
    res.status(204).send()
  } catch (e) { next(e) }
})

// ── Веса GRP-труб (PipeWeight, ключ dn+pn+sn) ──────────────────────────────

const pipeWeightSchema = z.object({
  dn: z.number().int().positive(),
  pn: z.number().positive(),
  sn: z.number().int().positive(),
  wallMm: z.number().nullable().optional(),
  kgPerM: z.number().positive(),
})

templatesRouter.put('/pipe-weights', validate(pipeWeightSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const { dn, pn, sn, wallMm, kgPerM } = req.body

    const row = await prisma.pipeWeight.upsert({
      where: { dn_pn_sn: { dn, pn, sn } },
      update: { wallMm, kgPerM },
      create: { dn, pn, sn, wallMm, kgPerM },
    })
    await audit(auth.userId, 'template.pipe_weight.upsert', 'PipeWeight', `${dn}/${pn}/${sn}`, { wallMm, kgPerM })
    res.json(row)
  } catch (e) { next(e) }
})

templatesRouter.delete('/pipe-weights', async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const dn = Number(req.query.dn)
    const pn = Number(req.query.pn)
    const sn = Number(req.query.sn)
    if (!dn || !pn || !sn) { res.status(400).json({ message: 'Нужны dn, pn, sn' }); return }

    const found = await prisma.pipeWeight.findUnique({ where: { dn_pn_sn: { dn, pn, sn } } })
    if (!found) { res.status(404).json({ message: `Веса (${dn}; ${pn}; ${sn}) нет` }); return }

    await prisma.pipeWeight.delete({ where: { dn_pn_sn: { dn, pn, sn } } })
    await audit(auth.userId, 'template.pipe_weight.delete', 'PipeWeight', `${dn}/${pn}/${sn}`)
    res.status(204).send()
  } catch (e) { next(e) }
})

// ── Инженерные матрицы (EngineeringMatrix, ключ kind+d+lengthMm) ───────────

const matrixSchema = z.object({
  kind: z.enum(['SHELL', 'ELLIPTIC_BOTTOM']),
  d: z.number().int().positive(),
  lengthMm: z.number().int().positive(),
  massKg: z.number().positive(),
  thicknessMm: z.number().nullable().optional(),
})

templatesRouter.put('/engineering', validate(matrixSchema), async (req, res: Response, next: NextFunction) => {
  try {
    const auth = req as AuthRequest
    const { kind, d, lengthMm, massKg, thicknessMm } = req.body

    const cell = await prisma.engineeringMatrix.upsert({
      where: { kind_d_lengthMm: { kind, d, lengthMm } },
      update: { massKg, thicknessMm },
      create: { kind, d, lengthMm, massKg, thicknessMm },
    })
    await audit(auth.userId, 'template.engineering.upsert', 'EngineeringMatrix', `${kind}/${d}/${lengthMm}`, {
      massKg,
      thicknessMm,
    })
    res.json(cell)
  } catch (e) { next(e) }
})
