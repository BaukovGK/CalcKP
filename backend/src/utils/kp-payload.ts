/**
 * Шапка КП, которую задаёт менеджер в окне выпуска, — приём, хранение, чтение.
 *
 * Что пришло с клиента при выпуске, то и печатается: номер, условия, подпись,
 * описание изделия и состав. Всё это ложится в слепок (`EstimateSnapshot`,
 * поля `kpNumber` и `kpJson`) рядом с ценой — документ обязан воспроизводиться
 * слово в слово, а опросный лист и умолчания к моменту повторной печати уже
 * могут быть другими.
 *
 * Даты в JSON хранятся строкой ISO и оживают при чтении: `Date` переживает
 * `JSON.stringify`, но обратно приходит строкой, и вёрстка получала бы
 * «[object String]» вместо срока действия.
 *
 * @module utils/kp-payload
 */

import { z } from 'zod'
import type { KpPositionOverride } from './kp-document'
import type { KpSignature, KpTerms } from './kp-terms'

/** Узел состава: имя, количество, единица. */
const kitItemSchema = z.object({
  name: z.string().trim().min(1).max(2000),
  qty: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(32),
})

/** Правки позиции: описание изделия и его состав. */
export const positionOverrideSchema = z
  .object({
    tag: z.string().trim().max(120).nullish(),
    mark: z.string().trim().max(200).nullish(),
    tu: z.string().trim().max(200).nullish(),
    description: z.string().trim().max(20000).nullish(),
    unit: z.string().trim().max(32).nullish(),
    kit: z.array(kitItemSchema).max(300).nullish(),
  })
  .strict()

/** Условия: подстановки девяти пунктов. */
export const termsSchema = z
  .object({
    vatRatePct: z.number().min(0).max(100),
    deliveryTo: z.string().trim().max(500).nullish(),
    shipmentFrom: z.string().trim().max(500).nullish(),
    // ISO-строка или null: дату шлёт клиент, часовой пояс печати — наш.
    validUntil: z.string().datetime({ offset: true }).nullish(),
    prepaymentPct: z.number().min(0).max(100),
    paymentDays: z.number().int().min(0).max(365),
    leadTimeDays: z.string().trim().max(64),
    euroThresholdPct: z.number().min(0).max(100),
    excluded: z.array(z.string().trim().max(1000)).max(20),
  })
  .partial()
  .strict()

/** Подпись и исполнитель. */
export const signatureSchema = z
  .object({
    signerTitle: z.string().trim().max(200),
    signerName: z.string().trim().max(200).nullish(),
    executorName: z.string().trim().max(200).nullish(),
    executorPosition: z.string().trim().max(200).nullish(),
    executorPhone: z.string().trim().max(100).nullish(),
    executorEmail: z.string().trim().max(200).nullish(),
  })
  .partial()
  .strict()

/** Тело выпуска КП: всё необязательно — без него печатаются умолчания. */
export const kpIssueSchema = z
  .object({
    /** Исходящий номер; пусто — выдаст сквозной счётчик. */
    number: z.string().trim().max(64).nullish(),
    position: positionOverrideSchema.nullish(),
    terms: termsSchema.nullish(),
    signature: signatureSchema.nullish(),
  })
  .strict()

export type KpIssuePayload = z.infer<typeof kpIssueSchema>

/** Шапка в том виде, в каком она лежит в слепке. */
export interface KpStoredHeader {
  position?: KpPositionOverride
  terms?: Partial<KpTerms>
  signature?: Partial<KpSignature>
}

/**
 * Прочитать шапку из слепка.
 *
 * Слепки, снятые до появления поля, и любое неожиданное содержимое дают
 * пустую шапку: печать обязана состояться и по старому снапшоту, просто с
 * умолчаниями.
 */
export function parseKpHeader(json: unknown): KpStoredHeader {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return {}
  const raw = json as Record<string, unknown>
  const out: KpStoredHeader = {}

  const position = positionOverrideSchema.safeParse(raw.position)
  if (position.success) out.position = position.data as KpPositionOverride

  const terms = termsSchema.safeParse(raw.terms)
  if (terms.success) {
    const { validUntil, ...rest } = terms.data
    out.terms = {
      ...rest,
      ...(validUntil !== undefined
        ? { validUntil: validUntil ? new Date(validUntil) : null }
        : {}),
    } as Partial<KpTerms>
  }

  const signature = signatureSchema.safeParse(raw.signature)
  if (signature.success) out.signature = signature.data as Partial<KpSignature>

  return out
}

/** Тело выпуска → то, что ляжет в `kpJson`. Пустые части не хранятся. */
export function headerToJson(payload: KpIssuePayload): KpStoredHeader | null {
  const out: KpStoredHeader = {}
  if (payload.position) out.position = payload.position as KpPositionOverride
  if (payload.terms) {
    const { validUntil, ...rest } = payload.terms
    out.terms = {
      ...rest,
      ...(validUntil !== undefined
        ? { validUntil: validUntil ? new Date(validUntil) : null }
        : {}),
    } as Partial<KpTerms>
  }
  if (payload.signature) out.signature = payload.signature as Partial<KpSignature>
  return Object.keys(out).length > 0 ? out : null
}

/** Приставка сквозного номера: у каждой установки своя. */
const DEFAULT_PREFIX = 'КП-'
/** Знаков в номере: «КП-0042». */
const DIGITS = 4

/**
 * Номер по порядковому: «КП-0042».
 *
 * Формат — предложение программы, а не правило завода: в образце на этом
 * месте номер журнала исходящей корреспонденции, и менеджер вправе вписать
 * свой (`doc/Эталон_КП_разбор.md` §12).
 */
export function formatKpNumber(seq: number, env: NodeJS.ProcessEnv = process.env): string {
  const prefix = env.KP_NUMBER_PREFIX ?? DEFAULT_PREFIX
  return `${prefix}${String(Math.max(1, Math.trunc(seq))).padStart(DIGITS, '0')}`
}
