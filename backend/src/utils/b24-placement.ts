import { DEAL_TAB_PLACEMENT } from './bitrix-auth'

/**
 * Вкладка «Калькулятор» в карточке сделки (doc/План_Б24_сделка.md, этап 2).
 * Встраивание регистрирует приложение методом placement.bind — ключом
 * администратора портала. Обработчик — тот же адрес входа, что у пункта
 * меню: портал присылает туда PLACEMENT и ID сделки.
 */

export const DEAL_TAB_TITLE = 'Калькулятор'
export const DEAL_TAB_DESCRIPTION = 'Расчёты и КП НТТ Калькулятора по этой сделке'

/** Адрес обработчика встройки из PUBLIC_URL. null — адрес не задан или не https. */
export function launchHandlerUrl(publicUrl: string | undefined): string | null {
  const base = publicUrl?.trim().replace(/\/+$/, '')
  if (!base) return null
  let u: URL
  try { u = new URL(base) } catch { return null }
  // Портал открывает вкладку только по https.
  if (u.protocol !== 'https:') return null
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}/api/auth/bitrix/launch`
}

export interface DealTabState {
  /** Куда должна вести вкладка — адрес этого сервера. */
  handler: string | null
  /** Вкладка есть в карточке сделки. */
  bound: boolean
  /** Есть, и ведёт сюда. false при bound — старый адрес: переподключить. */
  current: boolean
  /** Адреса обработчиков вкладки, как их хранит портал. */
  handlers: string[]
}

function sameUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()
}

/** Ответ placement.get → состояние вкладки сделки. */
export function dealTabState(list: unknown, handler: string | null): DealTabState {
  const rows = Array.isArray(list) ? (list as Record<string, unknown>[]) : []
  const handlers = rows
    .filter(r => String(r.placement ?? r.PLACEMENT ?? '') === DEAL_TAB_PLACEMENT)
    .map(r => String(r.handler ?? r.HANDLER ?? ''))
    .filter(Boolean)
  return {
    handler,
    bound: handlers.length > 0,
    current: handler != null && handlers.some(h => sameUrl(h, handler)),
    handlers,
  }
}
