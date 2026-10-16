import express, { Router } from 'express'
import { logger } from '../utils/logger'
import { createLimiter } from '../utils/rate-limit'
import { createCspDeduper, parseCspReport } from '../utils/csp-report'

/**
 * POST /api/csp-report — отчёты браузера о нарушениях CSP (Report-Only,
 * `utils/csp-report.ts`). Входа не требует: отчёт шлёт сам браузер. В лог
 * бэкенда с меткой «CSP», без повторов; ответ всегда 204 — браузеру он не
 * нужен, а постороннему нечего из него узнать.
 */
export const cspRouter = Router()

// Браузеры шлют application/csp-report (report-uri) или
// application/reports+json (Reporting API) — express.json их сам не разбирает.
const body = express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' })

/** С одного адреса — не больше 200 отчётов за 15 минут: дальше молча мимо. */
const byIp = createLimiter({ windowMs: 15 * 60 * 1000, max: 200 })
const fresh = createCspDeduper()

cspRouter.post('/', (req, res, next) => {
  if (!byIp.hit(req.ip ?? 'unknown').allowed) { res.status(204).end(); return }
  next()
}, body, (req, res) => {
  for (const v of parseCspReport(req.body)) {
    if (fresh(v)) logger.warn(`CSP: ${v.directive} — ${v.blocked} на ${v.page}${v.source ? ` (${v.source})` : ''}`)
  }
  res.status(204).end()
})

// Битое тело (не JSON, сверх лимита) — тоже 204: общий обработчик ответил бы
// 400/500 и записал ошибку в лог на каждый мусорный запрос.
cspRouter.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(204).end()
})
