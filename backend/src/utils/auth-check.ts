import { tokenVersionOf, verifyAccess } from './jwt'

/** Пользователь, каким его видит проверка доступа: роль и активность — из БД. */
export interface AuthUser {
  id: string
  role: string
  isActive: boolean
  /** Пароль задан не им самим — до смены открыта только смена пароля. */
  mustChangePassword?: boolean
  /** Версия токенов (План_устранения 2.3); нет — 0. */
  tokenVersion?: number
}

export type FindAuthUser = (id: string) => Promise<AuthUser | null>

/** Запрос не пропущен: сообщение — текст ответа 401. */
export class AuthError extends Error {}

/**
 * Пароль нужно сменить, прежде чем работать дальше (План_устранения 2.1):
 * он задан не самим пользователем — первый администратор, создание или
 * сброс администратором. Ответ — 403 `PASSWORD_CHANGE_REQUIRED`.
 */
export class PasswordChangeRequired extends Error {}

/**
 * Кто делает запрос.
 *
 * Токен — только доступа: refresh-токен сюда не проходит (План_реализации
 * §4.2 №2). Роль и активность берутся из БД при каждом запросе, а не из
 * токена: отзыв роли и блокировка учётной записи действуют с первого же
 * запроса, а не когда истечёт токен (№3).
 */
export async function authenticate(
  token: string,
  findUser: FindAuthUser,
  opts: { allowPasswordChange?: boolean } = {},
): Promise<{ userId: string; role: string }> {
  let userId: string
  let version: number
  try {
    const payload = await verifyAccess(token)
    userId = payload.userId
    version = tokenVersionOf(payload)
  } catch {
    throw new AuthError('Недействительный или истёкший токен')
  }
  const user = await findUser(userId)
  if (!user || !user.isActive) throw new AuthError('Пользователь не найден или заблокирован')
  // Версия выросла — пароль сменили или сбросили, учётку блокировали, либо
  // вышли на всех устройствах: токен отозван (План_устранения 2.3).
  if (version !== (user.tokenVersion ?? 0)) throw new AuthError('Сессия завершена — войдите снова')
  // Пароль задан не им — открыты только маршруты смены пароля (и «кто я»,
  // и выход): так обязательную смену не обойти запросами мимо экрана.
  if (user.mustChangePassword && !opts.allowPasswordChange) {
    throw new PasswordChangeRequired('Сначала смените пароль: он задан не вами')
  }
  return { userId: user.id, role: user.role }
}
