import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

/**
 * Правила переходов, которые проверяются без самого роутера — отдельно от
 * `router/index.ts`, чтобы тест не поднимал экраны.
 *
 * @module router/guards
 */

/**
 * Заслон обязательной смены пароля (План_устранения 2.1): пароль задан не
 * самим пользователем — любой экран ведёт на смену, а экран смены без
 * повода — на главный. `null` — пропустить.
 */
export function passwordGate(mustChangePassword: boolean, to: Pick<RouteLocationNormalized, 'name' | 'fullPath'>): RouteLocationRaw | null {
  if (mustChangePassword && to.name !== 'password') {
    return { name: 'password', query: to.fullPath && to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  if (!mustChangePassword && to.name === 'password') return { name: 'dashboard' }
  return null
}
