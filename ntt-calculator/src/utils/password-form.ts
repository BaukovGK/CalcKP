/**
 * Смена своего пароля — проверки формы до запроса и тексты ответов сервера.
 *
 * Сервер проверяет то же самое (`POST /api/auth/password`), но форма ловит
 * опечатки до запроса: пустое поле, короткий пароль, несовпавший повтор.
 */

/** Минимальная длина нового пароля — та же, что в схеме сервера. */
export const MIN_PASSWORD_LENGTH = 8

export interface PasswordForm {
  current: string
  next: string
  repeat: string
}

/** Что не так с формой; `null` — можно отправлять. */
export function passwordFormError(form: PasswordForm): string | null {
  if (!form.current) return 'Введите текущий пароль'
  if (form.next.length < MIN_PASSWORD_LENGTH) return `Новый пароль — не короче ${MIN_PASSWORD_LENGTH} символов`
  if (form.next !== form.repeat) return 'Новый пароль и повтор не совпадают'
  if (form.next === form.current) return 'Новый пароль совпадает с текущим'
  return null
}

/** Ответы сервера по коду — словами пользователя. */
const SERVER_CODES: Readonly<Record<string, string>> = {
  WRONG_PASSWORD: 'Текущий пароль неверен',
  SAME_PASSWORD: 'Новый пароль совпадает с текущим',
}

/** Текст ошибки смены пароля: по коду сервера, иначе его сообщение. */
export function passwordChangeErrorText(e: unknown): string {
  const data = (e as { response?: { data?: { code?: string; message?: string } } }).response?.data
  if (data?.code && SERVER_CODES[data.code]) return SERVER_CODES[data.code]!
  return data?.message ?? 'Не удалось сменить пароль — проверьте соединение и повторите'
}
