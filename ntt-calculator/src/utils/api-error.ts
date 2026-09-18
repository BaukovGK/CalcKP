/**
 * Текст ошибки запроса для человека.
 *
 * Экраны писали `e instanceof Error ? e.message : '…'`. Но ошибка axios — тоже
 * `Error`, и её `message` — «Request failed with status code 422»: сервер
 * объяснил, почему отказал («в проекте единица с выпущенным КП»), а экран
 * показал код. Так выглядела, например, неудача удаления проекта.
 *
 * Порядок: объяснение сервера (`response.data.message`) → для ошибки запроса
 * без ответа — «сервер недоступен» → для ответа без объяснения (502 от прокси,
 * пустое тело) — запасной текст экрана → для обычной ошибки кода — её текст.
 *
 * @module utils/api-error
 */

/** Текст для сотрудника: что пошло не так, без кодов и английского. */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const err = (e ?? null) as {
    response?: { data?: unknown }
    isAxiosError?: boolean
  } | null

  const data = err?.response?.data as { message?: unknown } | undefined
  if (data && typeof data.message === 'string' && data.message.trim() !== '') {
    return data.message
  }
  if (err?.isAxiosError) {
    return err.response ? fallback : 'Сервер недоступен — проверьте соединение и повторите'
  }
  if (e instanceof Error && e.message) return e.message
  return fallback
}
