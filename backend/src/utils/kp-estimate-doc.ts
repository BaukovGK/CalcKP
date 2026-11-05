import type { DeviceType, Prisma } from '@prisma/client'
import { buildKpDocument, type KpDocument } from './kp-document'
import { shellWallMm } from './kp-lookup'
import { parseKpHeader } from './kp-payload'

/**
 * Модель КП по одной единице из её печатной редакции — одна на скачивание
 * (GET /estimates/:id/kp/export) и на отправку в ленту сделки Битрикс24
 * (utils/b24-kp.ts): документ в сделке тот же, что скачивается.
 *
 * Шапка — та, что сохранена выпуском; её нет (старый слепок или ручная
 * фиксация) — печатаются умолчания, собранные из опросного листа.
 */
export async function estimateKpDocument(
  estimate: {
    id: string
    title: string
    deviceType: DeviceType
    project: { title: string; customer: string | null; address: string | null } | null
    author: { name?: string | null; position?: string | null; phone?: string | null; email?: string | null } | null
  },
  snapshot: {
    version: number
    priceListVersion: number
    totalRub: number
    createdAt: Date
    bundlesJson: Prisma.JsonValue
    kpNumber: string | null
    kpJson: Prisma.JsonValue
  },
): Promise<KpDocument> {
  const header = parseKpHeader(snapshot.kpJson)
  return buildKpDocument({
    estimateId: estimate.id,
    estimateTitle: estimate.title,
    deviceType: estimate.deviceType,
    project: estimate.project,
    wallMm: await shellWallMm(snapshot.bundlesJson),
    number: snapshot.kpNumber,
    kp: header.position ?? null,
    terms: header.terms ?? null,
    signature: header.signature ?? null,
    executor: estimate.author ?? {},
    snapshot: {
      version: snapshot.version,
      priceListVersion: snapshot.priceListVersion,
      totalRub: snapshot.totalRub,
      createdAt: snapshot.createdAt,
      bundlesJson: snapshot.bundlesJson,
    },
  })
}
