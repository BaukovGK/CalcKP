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
import { catalogRouter }   from './routes/catalog.routes'
import { pumpStationRouter } from './routes/pump-station.routes'

/**
 * Проверка окружения на старте.
 *
 * `JWT_SECRET` читался лениво — при первой подписи токена, — поэтому запуск
 * без него выглядел успешным, а падало на первом же логине: контейнер
 * «здоров», health отвечает, а войти нельзя. Лучше не подняться совсем.
 */
function assertEnv() {
  const problems: string[] = []
  if (!process.env.DATABASE_URL) problems.push('DATABASE_URL не задан')

  const secret = process.env.JWT_SECRET
  if (!secret) problems.push('JWT_SECRET не задан')
  else if (secret.length < 32) problems.push(`JWT_SECRET короче 32 символов (сейчас ${secret.length})`)
  else if (/change|secret|example|password|123456/i.test(secret)) {
    problems.push('JWT_SECRET похож на значение из шаблона .env.example — замените на случайное')
  }

  if (problems.length) {
    logger.error(`Некорректное окружение:\n  — ${problems.join('\n  — ')}`)
    throw new Error(`Некорректное окружение: ${problems.join('; ')}`)
  }
}
assertEnv()

const app  = express()
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

// ── Middleware ─────────────────────────────────────────────────────────────
// Лимит тела. Умолчание express — 100 КБ, а дерево расчёта на 300–450 строк
// (эталонный КНС — 452) в этот предел уже не помещается: сохранение падало бы
// с 413 ровно тогда, когда шаблон дорастёт до эталона. nginx пропускает 25 МБ
// (`ntt-calculator/nginx.conf`), так что узким местом был именно express.
app.use(express.json({ limit: '2mb' }))
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

// ── Request log ────────────────────────────────────────────────────────────
// Пишется ПОСЛЕ ответа: без кода ответа и длительности запись бесполезна для
// разбора («был запрос» — не факт, помогающий понять инцидент). userId берётся
// уже проставленным requireAuth, если маршрут защищён.
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint()
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
    logger.info(`${req.method} ${req.path}`, {
      status: res.statusCode,
      ms: Math.round(ms),
      userId: (req as { userId?: string }).userId,
    })
  })
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
// Каталог узлов и шаблоны изделий (редактор шаблонов, этап 2); калькулятор
// читает действующие версии через /api/refs/templates.
app.use('/api/templates', catalogRouter)
app.use('/api/pump-station', pumpStationRouter)

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: process.env.npm_package_version })
})

// Неизвестный маршрут API. Без этого express отдавал свою HTML-страницу 404,
// и клиент, ожидающий JSON, падал на разборе ответа вместо внятной ошибки.
app.use('/api', (req, res) => {
  res.status(404).json({ message: `Маршрут ${req.method} ${req.originalUrl} не найден`, code: 'NOT_FOUND' })
})

// ── Error handler (must be last) ───────────────────────────────────────────
app.use(errorHandler)

app.listen(PORT, () => {
  logger.info(`НТТ backend listening on http://localhost:${PORT}`)
})

export default app
