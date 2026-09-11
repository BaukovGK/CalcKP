import { verifyAccess } from './jwt'

/** Пользователь, каким его видит проверка доступа: роль и активность — из БД. */
export interface AuthUser {
  id: string
  role: string
  isActive: boolean
}

export type FindAuthUser = (id: string) => Promise<AuthUser | null>

/** Запрос не пропущен: сообщение — текст ответа 401. */
export class AuthError extends Error {}

/**
 * Кто делает запрос.
 *
 * Токен — только доступа: refresh-токен сюда не проходит (План_реализации
 * §4.2 №2). Роль и активность берутся из БД при каждом запросе, а не из
 * токена: отзыв роли и блокировка учётной записи действуют с первого же
 * запроса, а не когда истечёт токен (№3).
 */
export async function authenticate(token: string, findUser: FindAuthUser): Promise<{ userId: string; role: string }> {
  let userId: string
  try {
    userId = (await verifyAccess(token)).userId
  } catch {
    throw new AuthError('Недействительный или истёкший токен')
  }
  const user = await findUser(userId)
  if (!user || !user.isActive) throw new AuthError('Пользователь не найден или заблокирован')
  return { userId: user.id, role: user.role }
}
