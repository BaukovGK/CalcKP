import { z } from 'zod'
import contract from './catalog-contract.json'

/**
 * Каталог узлов и шаблоны изделий — проверка тел на сервере (редактор
 * шаблонов, этап 2; Библиотека §4, §6.2).
 *
 * Формулы узлов, реестр функций и встроенные узлы — код фронтенда
 * (`ntt-calculator/src/engines/node-def.ts`, `code-nodes.ts`): там же полная
 * проверка — разбор формул, известные имена, число аргументов. Сервер не
 * разбирает формулы, но не пропускает то, что сломало бы чтение каталога:
 * форму тела, размеры, коды и рубрики из общего контракта, ссылки шаблона
 * на встроенные узлы своего изделия и на опубликованные узлы каталога.
 *
 * Черновик проверяется мягко — это незаконченная работа, в нём бывают
 * пустые наименования и строки без формул. Публикуемая версия — строго.
 */

export type DeviceType = 'KNS' | 'EMK' | 'KOL'

/** Код узла: буква, дальше буквы, цифры, точка, дефис — до 16 знаков. */
export const NODE_CODE_RE = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9.-]{0,15}$/
/** Имя параметра: буква или «_», дальше буквы, цифры, «_». */
export const PARAM_KEY_RE = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*$/

export const RESERVED_NODE_CODES: ReadonlySet<string> = new Set(contract.reservedNodeCodes)
export const NODE_TAGS = contract.nodeTags as [string, ...string[]]
export const ROW_CATEGORIES = contract.rowCategories as [string, ...string[]]
export const BUILTIN_REFS: Readonly<Record<DeviceType, readonly string[]>> = contract.builtinRefs as Record<DeviceType, string[]>

/** Формула: разбирает фронтенд, сервер ограничивает только длину. */
const formula = z.string().max(500)

function nodeSchema(strict: boolean) {
  const text = (max: number) => (strict ? z.string().trim().min(1).max(max) : z.string().max(max))
  return z.object({
    code: z.string().regex(NODE_CODE_RE, 'Код узла — буква, дальше буквы, цифры, точка или дефис, до 16 знаков'),
    name: text(200),
    tag: z.enum(NODE_TAGS),
    description: z.string().max(2000).optional(),
    params: z
      .array(
        z.object({
          key: strict ? z.string().regex(PARAM_KEY_RE).max(40) : z.string().max(40),
          label: text(120),
          type: z.enum(['number', 'bool', 'text']),
          unit: z.string().max(20).optional(),
          default: z.union([z.number(), z.boolean(), z.string().max(200), z.null()]).optional(),
        }),
      )
      .max(40),
    rows: z
      .array(
        z.object({
          kind: z.enum(['МАТЕРИАЛ', 'ОПЕРАЦИЯ']),
          category: z.enum(ROW_CATEGORIES),
          name: text(400),
          unit: text(20),
          qty: formula,
          fotK: z.number().positive().max(5).nullable().optional(),
          when: formula.optional(),
          note: z.string().max(400).optional(),
        }),
      )
      .min(strict ? 1 : 0)
      .max(200),
    enabledBy: formula.optional(),
  })
}

/** Черновик узла: форма тела, без требований к заполненности. */
export const nodeDraftSchema = nodeSchema(false)
/** Публикуемая версия узла. */
export const nodeBodySchema = nodeSchema(true)
export type NodeBody = z.infer<typeof nodeBodySchema>

function templateSchema(strict: boolean) {
  return z.object({
    sections: z
      .array(
        z.object({
          title: strict ? z.string().trim().min(1).max(120) : z.string().max(120),
          nodes: z
            .array(
              z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('builtin'), ref: z.string().min(1).max(60) }),
                z.object({
                  kind: z.literal('catalog'),
                  code: z.string().regex(NODE_CODE_RE),
                  title: z.string().max(200).optional(),
                  bindings: z.record(z.string().max(40), formula),
                }),
              ]),
            )
            .max(100),
        }),
      )
      .min(strict ? 1 : 0)
      .max(30),
  })
}

export const templateDraftSchema = templateSchema(false)
export const templateBodySchema = templateSchema(true)
export type TemplateBody = z.infer<typeof templateBodySchema>

/** Код занят встроенным узлом: узел технолога путался бы с ним в аудите состава. */
export function isReservedCode(code: string): boolean {
  return RESERVED_NODE_CODES.has(code.trim().toUpperCase())
}

/**
 * Замечания к узлу, которые сервер обязан проверить сам: код занят
 * встроенным узлом, повтор имени параметра, коэффициент ФОТ не у той строки.
 */
export function nodeProblems(body: NodeBody): string[] {
  const out: string[] = []
  if (isReservedCode(body.code)) out.push(`Код ${body.code} занят встроенным узлом`)
  const keys = new Set<string>()
  for (const p of body.params) {
    if (keys.has(p.key)) out.push(`Параметр «${p.key}» повторяется`)
    keys.add(p.key)
  }
  body.rows.forEach((r, i) => {
    const massOp = r.kind === 'ОПЕРАЦИЯ' && r.unit.trim() === 'кг'
    if (massOp && !(typeof r.fotK === 'number' && r.fotK > 0)) out.push(`Строка ${i + 1}: у операции в кг нужен коэффициент ФОТ`)
    if (!massOp && r.fotK != null) out.push(`Строка ${i + 1}: коэффициент ФОТ — только у операции в кг`)
  })
  return out
}

/** Коды узлов каталога, на которые ссылается шаблон. */
export function templateCatalogCodes(body: { sections: Array<{ nodes: Array<{ kind: string; code?: string }> }> }): string[] {
  const codes = new Set<string>()
  for (const s of body.sections) for (const n of s.nodes) if (n.kind === 'catalog' && n.code) codes.add(n.code)
  return [...codes]
}

/**
 * Замечания к шаблону изделия перед публикацией: встроенные узлы — только
 * своего изделия и без повторов, узлы каталога — опубликованные и не в
 * архиве, названия разделов — без повторов.
 *
 * @param catalog состояние узлов каталога по коду: опубликован ли, в архиве ли
 */
export function templateProblems(
  device: DeviceType,
  body: TemplateBody,
  catalog: ReadonlyMap<string, { activeVersion: number | null; archived: boolean }>,
): string[] {
  const out: string[] = []
  const own = new Set(BUILTIN_REFS[device])
  const used = new Set<string>()
  const titles = new Set<string>()
  body.sections.forEach((s, si) => {
    const t = s.title.trim().toLowerCase()
    if (titles.has(t)) out.push(`Раздел «${s.title.trim()}» повторяется`)
    titles.add(t)
    for (const n of s.nodes) {
      if (n.kind === 'builtin') {
        if (!own.has(n.ref)) out.push(`Раздел ${si + 1}: встроенного узла «${n.ref}» у этого изделия нет`)
        else if (used.has(n.ref)) out.push(`Раздел ${si + 1}: встроенный узел «${n.ref}» стоит в шаблоне дважды`)
        used.add(n.ref)
        continue
      }
      const c = catalog.get(n.code)
      if (!c || c.activeVersion == null) out.push(`Раздел ${si + 1}: узел каталога ${n.code} не опубликован`)
      else if (c.archived) out.push(`Раздел ${si + 1}: узел каталога ${n.code} в архиве`)
    }
  })
  return out
}

/** Следующий номер версии: максимум опубликованных плюс один. */
export function nextVersion(versions: ReadonlyArray<{ version: number }>): number {
  return versions.reduce((m, v) => Math.max(m, v.version), 0) + 1
}

/** Устройства изделий — ключ шаблона в URL. */
export function parseDevice(v: unknown): DeviceType | null {
  return v === 'KNS' || v === 'EMK' || v === 'KOL' ? v : null
}
