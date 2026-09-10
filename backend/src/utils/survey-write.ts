/**
 * Защита расчёта от устаревшей записи.
 *
 * Дерево расчёта пишут два экрана: опросный лист (каждая правка пересобирает
 * дерево и шлёт новую ревизию ОЛ `surveyRev`) и сам расчёт (кнопка
 * «Сохранить» шлёт дерево и `treeSurveyRev` — ревизию ОЛ, из которой оно
 * построено). Если расчёт открыт в другой вкладке, а ОЛ тем временем
 * поправили, его «Сохранить» записало бы дерево, собранное из старого ОЛ, —
 * и вернуло бы в ОЛ старые цены трубы и насоса (связанные цены пишутся из
 * дерева обратно в форму). Цена, введённая в ОЛ, «не переносилась» бы, а
 * потом и пропадала бы из самого ОЛ.
 *
 * Такая запись отклоняется: экран расчёта перечитывает изделие.
 */

export const SURVEY_CHANGED = 'SURVEY_CHANGED'

/**
 * Запись дерева, собранного из ревизии ОЛ старше сохранённой.
 *
 * Запись самого ОЛ (с `surveyRev`) под проверку не попадает: она и есть
 * источник новой ревизии.
 */
export function isStaleTreeWrite(stored: unknown, body: Record<string, unknown>): boolean {
  if (body.surveyRev !== undefined) return false
  if (body.tree === undefined || typeof body.treeSurveyRev !== 'number') return false
  const saved = stored && typeof stored === 'object' ? (stored as Record<string, unknown>) : {}
  const storedRev = typeof saved.surveyRev === 'number' ? saved.surveyRev : 0
  return body.treeSurveyRev < storedRev
}
