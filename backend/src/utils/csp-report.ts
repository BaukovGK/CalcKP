/**
 * Отчёты браузера о нарушениях CSP (План_устранения 2.4).
 *
 * Политика стоит в режиме Report-Only (`ntt-calculator/nginx/security-headers.conf`):
 * браузер ничего не блокирует, а о каждом нарушении шлёт отчёт на
 * `/api/csp-report`. По ним видно, что сломается при боевом режиме, — до того,
 * как сломается.
 *
 * Отчёт присылает браузер без входа, то есть кто угодно: здесь он только
 * приводится к короткой записи для лога — без адресных параметров (в адресе
 * `/bitrix?code=…` одноразовый код входа) и с обрезанными строками.
 */

export interface CspViolation {
  /** Страница, на которой случилось нарушение, — без параметров. */
  page: string
  /** Какое правило нарушено: script-src, img-src, frame-ancestors… */
  directive: string
  /** Что пытались загрузить: адрес без параметров, `inline`, `eval`… */
  blocked: string
  /** Где в коде — файл и строка, если браузер их назвал. */
  source?: string
  /** `report` — только сообщено, `enforce` — заблокировано. */
  disposition?: string
}

const MAX = 300

function str(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (typeof v === 'number') return String(v)
  return undefined
}

/** Адрес без query и фрагмента; не адрес (`inline`, `eval`) — как есть. */
function stripUrl(v: string): string {
  try {
    const u = new URL(v)
    return `${u.origin}${u.pathname}`.slice(0, MAX)
  } catch {
    return v.split(/[?#]/)[0]!.slice(0, MAX)
  }
}

/** Одно нарушение из старого формата (`csp-report`) или Reporting API. */
function one(r: Record<string, unknown>): CspViolation | null {
  const page = str(r['document-uri'] ?? r.documentURL)
  const directive = str(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'] ?? r.violatedDirective)
  if (!page || !directive) return null
  const file = str(r['source-file'] ?? r.sourceFile)
  const line = str(r['line-number'] ?? r.lineNumber)
  return {
    page: stripUrl(page),
    directive: directive.split(' ')[0]!.slice(0, 60),
    blocked: stripUrl(str(r['blocked-uri'] ?? r.blockedURL) ?? '—'),
    ...(file ? { source: `${stripUrl(file)}${line ? `:${line}` : ''}` } : {}),
    ...(str(r.disposition) ? { disposition: str(r.disposition)!.slice(0, 20) } : {}),
  }
}

/**
 * Нарушения из тела запроса. Старый формат (`report-uri`) — объект
 * `{ "csp-report": {...} }`, Reporting API — массив `[{ type, body }]`.
 * Мусор — пустой список, а не ошибка: отвечать на него всё равно нечем.
 */
export function parseCspReport(body: unknown): CspViolation[] {
  const items: unknown[] = Array.isArray(body) ? body.slice(0, 20) : [body]
  const out: CspViolation[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Record<string, unknown>
    const inner = o['csp-report'] ?? (o.type === 'csp-violation' ? o.body : undefined)
    if (typeof inner !== 'object' || inner === null) continue
    const v = one(inner as Record<string, unknown>)
    if (v) out.push(v)
  }
  return out
}

/**
 * Одно и то же нарушение браузер шлёт на каждой загрузке страницы. В лог —
 * раз в окно на каждое сочетание «страница + правило + что загружали»,
 * иначе неделя сбора утонет в повторах.
 */
export function createCspDeduper(windowMs = 60 * 60 * 1000, maxKeys = 2000) {
  const seen = new Map<string, number>()
  return (v: CspViolation, now = Date.now()): boolean => {
    const key = `${v.page}|${v.directive}|${v.blocked}`
    const last = seen.get(key)
    if (last !== undefined && now - last < windowMs) return false
    seen.delete(key)
    while (seen.size >= maxKeys) seen.delete(seen.keys().next().value as string)
    seen.set(key, now)
    return true
  }
}
