import 'dotenv/config'
import express from 'express'
import { logger } from './utils/logger'
import { errorHandler } from './middleware/errorHandler'
import { authRouter }      from './routes/auth.routes'
import { adminRouter }     from './routes/admin.routes'
import { projectsRouter }  from './routes/projects.routes'
import { estimatesRouter } from './routes/estimates.routes'
import { pricesRouter }    from './routes/prices.routes'
import { refsRouter }      from './routes/refs.routes'
import { purchaseRouter }  from './routes/purchase.routes'
import { templatesRouter } from './routes/templates.routes'
import { pumpStationRouter } from './routes/pump-station.routes'

const app  = express()
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json())
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',').map(s => s.trim())

app.use((req, res, next) => {
  const origin = req.headers.origin ?? ''
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
  if (req.method === 'OPTIONS') { res.sendStatus(204); return }
  next()
})

// ── Request log (dev) ──────────────────────────────────────────────────────
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter)
app.use('/api/admin',     adminRouter)
app.use('/api/projects',  projectsRouter)
app.use('/api/estimates', estimatesRouter)
// Заявка на закупку — отчёт поверх расчёта (ТЗ §9.6), поэтому висит на
// /api/estimates, а не на своём ресурсе: своей сущности у неё нет.
app.use('/api/estimates', purchaseRouter)
app.use('/api/prices',    pricesRouter)
app.use('/api/refs',      refsRouter)
// Редактор шаблонов (TECHNOLOG): запись в справочники, из которых
// материализуются шаблоны; чтение — через /api/refs.
app.use('/api/templates', templatesRouter)
app.use('/api/pump-station', pumpStationRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: process.env.npm_package_version })
})

// ── Error handler (must be last) ───────────────────────────────────────────
app.use(errorHandler)

app.listen(PORT, () => {
  logger.info(`НТТ backend listening on http://localhost:${PORT}`)
})

export default app
