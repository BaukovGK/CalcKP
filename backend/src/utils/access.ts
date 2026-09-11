/**
 * Кто что видит и правит — правила ролей (ТЗ §2) одним модулем для маршрутов
 * расчётов, проектов и заявки на закупку.
 *
 * @module utils/access
 */

/**
 * Правка расчёта.
 *
 * ADMIN — все расчёты; MANAGER — расчёты команды (проверяет и правит чужие);
 * остальные — только свои.
 *
 * Раньше здесь стояло `role !== 'ADMIN' && authorId !== userId`, то есть
 * MANAGER не имел доступа к чужим расчётам: расчёт инженера он не мог даже
 * открыть, и тогдашнее согласование CALC→REVIEW→APPROVED (§4.3) было
 * неисполнимо. Согласование через статусы с тех пор отменено — точка
 * фиксации теперь выпуск КП, — а проверять чужие расчёты MANAGER должен
 * по-прежнему.
 */
export function canAccessEstimate(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  if (role === 'ADMIN' || role === 'MANAGER') return true
  return authorId === userId
}

/**
 * Чтение расчёта — шире правки. VIEWER — наблюдатель (ТЗ §2): видит расчёты и
 * их версии, но не меняет ничего; роль нужна вкладке «Расчёт» в Битрикс24.
 * BUYER ведёт закупку по любому расчёту (решение Р8, План_устранения 3.7):
 * заявке нужен расчёт на чтение — прежде на чужой он получал 403.
 */
export function canReadEstimate(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  if (role === 'VIEWER' || role === 'BUYER') return true
  return canAccessEstimate(role, authorId, userId)
}

/** Роли, которым виден весь список расчётов, а не только свои. */
export function seesAllEstimates(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER' || role === 'BUYER'
}

/**
 * Кто видит все проекты: ADMIN и MANAGER ведут их, VIEWER наблюдает, BUYER
 * ищет в них единицы для заявок на закупку (решение Р8, План_устранения 3.7).
 * Менять проекты BUYER и VIEWER не могут — это держит requireRole маршрутов.
 */
export function seesAllProjects(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER' || role === 'BUYER'
}
