/**
 * Справочники, которыми собран расчёт (План_устранения, 3.6).
 *
 * Материализация читает веса труб, нормы патрубков, Мс на стыке, матрицу
 * эллиптических днищ и узлы каталога. Технолог правит их на экране
 * «Шаблоны» — а собранный расчёт об этом не знал: число в нём оставалось
 * прежним, и узнать, что справочник под ним сдвинулся, было не из чего.
 *
 * Теперь материализация записывает, КАКИЕ значения она прочла: ключ
 * обращения → значение (`CalcTree.refsUsed`). При открытии расчёта те же
 * обращения повторяются по нынешним справочникам, и расходится хоть одно —
 * плашка «справочники изменились» с тем, что именно изменилось, и
 * пересборкой. Правка строки, которой расчёт не касался, его не тревожит.
 *
 * Цены прайса сюда не входят: у них своя версия и пересчёт (engines/reprice.ts).
 *
 * @module engines/refs-used
 */

import type { MaterializeContext } from './template-kns'

/** Ключ обращения к справочнику → прочитанное значение (JSON). */
export type RefsUsed = Record<string, string>

/** Что изменилось в справочнике с тех пор, как расчёт собран. */
export interface RefChange {
  key: string
  /** Кратко по-человечески: «вес трубы DN1000 PN0,6 SN10000». */
  label: string
  before: unknown
  after: unknown
}

/** JSON с упорядоченными ключами: значения сравниваются строками. */
function json(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(json).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${json(v)}`).join(',')}}`
}

/**
 * Контекст, записывающий каждое обращение к справочникам в `used`. Всё
 * остальное — как у исходного: цены, шаблоны, версия прайса.
 */
export function recordingContext(ctx: MaterializeContext, used: RefsUsed): MaterializeContext {
  const put = <T>(key: string, value: T): T => {
    used[key] = json(value)
    return value
  }
  const { nozzleNormOf, jointLayerMassOf, ellipticBottomOf, catalogNodeOf } = ctx
  return {
    ...ctx,
    pipeWeightOf: (dn, pn, sn) => put(`pipeWeight:${dn}|${pn}|${sn}`, ctx.pipeWeightOf(dn, pn, sn)),
    ...(nozzleNormOf ? { nozzleNormOf: (dn: number) => put(`nozzleNorm:${dn}`, nozzleNormOf(dn)) } : {}),
    ...(jointLayerMassOf ? { jointLayerMassOf: (d: number) => put(`jointLayer:${d}`, jointLayerMassOf(d)) } : {}),
    ...(ellipticBottomOf
      ? { ellipticBottomOf: (dn: number, lengthMm: number) => put(`ellipticBottom:${dn}|${lengthMm}`, ellipticBottomOf(dn, lengthMm)) }
      : {}),
    ...(catalogNodeOf
      ? {
          catalogNodeOf: (code: string) => {
            const node = catalogNodeOf(code)
            // У узла каталога важна версия: её тело — формулы и состав.
            used[`node:${code}`] = json(node ? node.version : null)
            return node
          },
        }
      : {}),
  }
}

/** Повторить обращение по ключу на данном контексте. */
function replay(ctx: MaterializeContext, key: string): void {
  const [kind, args = ''] = key.split(/:(.*)/s)
  const nums = args.split('|').map(Number)
  switch (kind) {
    case 'pipeWeight': ctx.pipeWeightOf(nums[0]!, nums[1]!, nums[2]!); break
    case 'nozzleNorm': ctx.nozzleNormOf?.(nums[0]!); break
    case 'jointLayer': ctx.jointLayerMassOf?.(nums[0]!); break
    case 'ellipticBottom': ctx.ellipticBottomOf?.(nums[0]!, nums[1]!); break
    case 'node': ctx.catalogNodeOf?.(args); break
  }
}

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })

/** Ключ обращения — словами. */
export function refLabel(key: string): string {
  const [kind, args = ''] = key.split(/:(.*)/s)
  const p = args.split('|')
  switch (kind) {
    case 'pipeWeight': return `вес трубы DN${p[0]} PN${fmt(Number(p[1]))} SN${p[2]}`
    case 'nozzleNorm': return `норма патрубка DN${p[0]}`
    case 'jointLayer': return `Мс на стыке Dу${p[0]}`
    case 'ellipticBottom': return `эллиптическое днище DN${p[0]}`
    case 'node': return `узел каталога ${args}`
    default: return key
  }
}

/**
 * Что из прочитанного при сборке изменилось: те же обращения — по нынешним
 * справочникам. Дерево без записи (собрано до 11.09.2026) — ничего.
 */
export function refsChanges(used: RefsUsed | undefined, ctx: MaterializeContext): RefChange[] {
  if (!used) return []
  const now: RefsUsed = {}
  const rec = recordingContext(ctx, now)
  for (const key of Object.keys(used)) replay(rec, key)
  const changes: RefChange[] = []
  for (const [key, before] of Object.entries(used)) {
    const after = now[key] ?? 'null'
    if (after !== before) changes.push({ key, label: refLabel(key), before: JSON.parse(before), after: JSON.parse(after) })
  }
  return changes
}

/** Изменение словами: «вес трубы DN1000 PN0,6 SN10000: 120 → 125». */
export function refChangeText(c: RefChange): string {
  const v = (x: unknown) => (x == null ? 'нет в справочнике' : typeof x === 'number' ? fmt(x) : null)
  if (c.key.startsWith('node:')) {
    return `${c.label}: ${c.before == null ? 'не было' : `v${c.before}`} → ${c.after == null ? 'снят с публикации' : `v${c.after}`}`
  }
  // Днище — масса формовки; у нормы патрубка значений несколько — «изменена».
  const mass = (x: unknown) => (x && typeof x === 'object' && typeof (x as { massKg?: unknown }).massKg === 'number' ? (x as { massKg: number }).massKg : x)
  const before = v(mass(c.before))
  const after = v(mass(c.after))
  return before != null && after != null ? `${c.label}: ${before} → ${after}` : `${c.label}: изменена`
}
