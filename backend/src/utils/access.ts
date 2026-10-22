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
 *
 * BUYER сюда больше не входит: снабженцу закрыты проекты и цены продажи, а
 * расчёт, его версии и КП — это они и есть. Заявке на закупку он читает
 * расчёт через `canReadForPurchase`, урезанным `purchaseEstimateView`
 * (`utils/purchase-view.ts`).
 */
export function canReadEstimate(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  if (role === 'VIEWER') return true
  return canAccessEstimate(role, authorId, userId)
}

/**
 * Чтение расчёта для заявки на закупку: снабженец ведёт закупку по любому
 * расчёту (решение Р8), остальные — как при обычном чтении.
 */
export function canReadForPurchase(role: string | undefined, authorId: string, userId: string | undefined): boolean {
  return role === 'BUYER' || canReadEstimate(role, authorId, userId)
}

/** Роли, которым виден весь список расчётов, а не только свои. */
export function seesAllEstimates(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER' || role === 'BUYER'
}

/**
 * Кто видит все проекты: ADMIN и MANAGER ведут их, VIEWER наблюдает.
 * Менять проекты VIEWER не может — это держит requireRole маршрутов.
 */
export function seesAllProjects(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'MANAGER' || role === 'VIEWER'
}

/**
 * Проекты закрыты снабженцу целиком: в них заказчики и цены продажи. Заявки
 * на закупку он находит в своём списке расчётов, без проектов.
 */
export function canSeeProjects(role: string | undefined): boolean {
  return role !== 'BUYER'
}
