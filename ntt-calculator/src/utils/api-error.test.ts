/**
 * Ошибка запроса глазами сотрудника: причина от сервера, а не код ответа.
 *
 * Удаление проекта показывало «Request failed with status code 422», хотя
 * сервер объяснил отказ по-русски. Тесты держат порядок: объяснение сервера,
 * потом «сервер недоступен», потом запасной текст экрана.
 */
import { describe, expect, it } from 'vitest'
import { apiErrorMessage } from './api-error'

/** Ошибка, какой её отдаёт axios: `Error` с `isAxiosError` и, может быть, ответом. */
function axiosError(status: number | null, data?: unknown): Error {
  const e = new Error(status ? `Request failed with status code ${status}` : 'Network Error') as Error & {
    isAxiosError: boolean
    response?: { status: number; data?: unknown }
  }
  e.isAxiosError = true
  if (status) e.response = { status, data }
  return e
}

describe('текст ошибки запроса', () => {
  it('объяснение сервера — вместо кода ответа', () => {
    const e = axiosError(422, { message: 'Проект не удалён: «КНС-1» — выпущено КП', code: 'PROJECT_UNITS_PROTECTED' })
    expect(apiErrorMessage(e, 'Ошибка удаления')).toBe('Проект не удалён: «КНС-1» — выпущено КП')
  })

  it('ответ без объяснения — запасной текст экрана, а не «Request failed…»', () => {
    expect(apiErrorMessage(axiosError(502, '<html>Bad Gateway</html>'), 'Ошибка удаления')).toBe('Ошибка удаления')
    expect(apiErrorMessage(axiosError(500, { message: '   ' }), 'Не удалось сохранить')).toBe('Не удалось сохранить')
  })

  it('запроса не случилось — сервер недоступен', () => {
    expect(apiErrorMessage(axiosError(null), 'Ошибка загрузки')).toContain('Сервер недоступен')
  })

  it('обычная ошибка кода — её собственный текст', () => {
    // Так стор расчёта сообщает о конфликте версий: текст уже для человека.
    expect(apiErrorMessage(new Error('Расчёт изменили в другой вкладке'), 'x')).toBe('Расчёт изменили в другой вкладке')
  })

  it('мусор вместо ошибки не роняет экран', () => {
    expect(apiErrorMessage(null, 'Ошибка')).toBe('Ошибка')
    expect(apiErrorMessage(undefined, 'Ошибка')).toBe('Ошибка')
    expect(apiErrorMessage('строка', 'Ошибка')).toBe('Ошибка')
    // Отказ в тестах экранов имитируют простым объектом с ответом.
    expect(apiErrorMessage({ response: { data: { message: 'Нет доступа' } } }, 'Ошибка')).toBe('Нет доступа')
  })
})
