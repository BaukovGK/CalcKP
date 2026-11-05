import { prisma } from './prisma'
import { logger } from './logger'
import { b24Client } from './b24-portal'
import { B24ClientError } from './b24-client'
import { estimateKpDocument } from './kp-estimate-doc'
import { documentFileName } from './kp-document'
import { renderKpPdf } from './kp-pdf'

/**
 * КП в ленту сделки Битрикс24 (doc/План_Б24_сделка.md, этап 6).
 *
 * Каждая выпущенная редакция КП — отдельный комментарий в ленте сделки с PDF
 * во вложении. Поля сделки (сумма и прочее) не трогаются: КП по сделке
 * бывает много, и какое станет итоговым, заранее не известно. Отправляет
 * ключом того, кто выпустил или нажал «Отправить повторно», — комментарий
 * от его имени. Сбой не мешает выпуску: причина пишется в версию.
 */

export interface KpCommentInput {
  number: string | null
  version: number
  estimateTitle: string
  projectTitle: string | null
  totalRub: number
  authorName: string | null
  /** Ссылка на расчёт в калькуляторе; null — PUBLIC_URL не задан. */
  url: string | null
}

function rub(v: number): string {
  return `${Math.round(v).toLocaleString('ru-RU')} ₽`
}

/** Текст комментария: BB-коды ленты Битрикс24 ([b], [url]). */
export function kpCommentText(k: KpCommentInput): string {
  const lines = [
    `[b]КП № ${k.number ?? 'б/н'}[/b] (версия ${k.version}) — ${k.estimateTitle}`,
    k.projectTitle ? `Проект: ${k.projectTitle}` : null,
    `Сумма: ${rub(k.totalRub)}`,
    k.authorName ? `Выпустил: ${k.authorName}` : null,
    k.url ? `[url=${k.url}]Открыть расчёт в калькуляторе[/url]` : null,
  ]
  return lines.filter((l): l is string => l != null).join('\n')
}

/** Ссылка на расчёт: адрес калькулятора из PUBLIC_URL. */
export function estimateUrl(publicUrl: string | undefined, estimateId: string): string | null {
  const base = publicUrl?.trim().replace(/\/+$/, '')
  if (!base || !/^https?:\/\//.test(base)) return null
  return `${base}/calculator/${encodeURIComponent(estimateId)}`
}

export type KpSendResult =
  | { status: 'sent'; sentAt: Date }
  | { status: 'failed'; error: string }
  /** Проект без сделки или Битрикс24 не настроен — отправлять некуда. */
  | { status: 'skipped' }

/** Понятная причина — в версию и на экран. */
function reason(e: unknown): string {
  if (e instanceof B24ClientError) {
    switch (e.code) {
      case 'no_token':
      case 'token_expired':
        return 'Нет действующего ключа Битрикс24 — откройте калькулятор из портала и отправьте повторно'
      case 'access_denied':
        return 'Битрикс24 отказал: у вас нет права комментировать эту сделку'
      case 'not_found':
        return 'Сделка не найдена в Битрикс24 — возможно, её удалили'
      default:
        return e.message
    }
  }
  return e instanceof Error ? e.message : String(e)
}

/**
 * Отправить редакцию `version` расчёта в ленту его сделки ключом `userId`.
 * Результат записывается в версию (b24SentAt / b24Error).
 */
export async function sendKpToDeal(userId: string, estimateId: string, version: number): Promise<KpSendResult> {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true, title: true, deviceType: true,
      project: { select: { title: true, customer: true, address: true, b24DealId: true } },
      author: { select: { name: true, position: true, phone: true, email: true } },
    },
  })
  const dealId = estimate?.project?.b24DealId
  const client = b24Client()
  if (!estimate || !dealId || !client) return { status: 'skipped' }

  const snapshot = await prisma.estimateSnapshot.findUnique({ where: { estimateId_version: { estimateId, version } } })
  if (!snapshot || snapshot.reason !== 'KP') return { status: 'skipped' }

  try {
    const doc = await estimateKpDocument(estimate, snapshot)
    const pdf = await renderKpPdf(doc)
    const sender = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    const comment = kpCommentText({
      number: snapshot.kpNumber,
      version: snapshot.version,
      estimateTitle: estimate.title,
      projectTitle: estimate.project?.title ?? null,
      totalRub: snapshot.totalRub,
      authorName: sender?.name ?? null,
      url: estimateUrl(process.env.PUBLIC_URL, estimate.id),
    })
    const commentId = await client.call<unknown>(userId, 'crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: Number(dealId),
        ENTITY_TYPE: 'deal',
        COMMENT: comment,
        FILES: [[documentFileName(doc, 'pdf'), pdf.toString('base64')]],
      },
    })
    const sentAt = new Date()
    await prisma.estimateSnapshot.update({
      where: { id: snapshot.id },
      data: { b24SentAt: sentAt, b24CommentId: commentId == null ? null : String(commentId), b24Error: null },
    })
    return { status: 'sent', sentAt }
  } catch (e) {
    const error = reason(e)
    logger.warn(`КП ${snapshot.kpNumber ?? ''} v${version} не ушло в сделку ${dealId}: ${e instanceof Error ? e.message : String(e)}`)
    await prisma.estimateSnapshot.update({ where: { id: snapshot.id }, data: { b24Error: error.slice(0, 500) } }).catch(() => undefined)
    return { status: 'failed', error }
  }
}
