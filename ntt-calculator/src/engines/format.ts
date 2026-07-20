/**
 * Форматирование чисел для отображения (разряды пробелами, ru-RU).
 *
 * Вынесено из engines/cost.ts при удалении legacy-ветки калькулятора:
 * fmt — единственное, что из неё использовали живые экраны.
 */

/** «12 345,67», ноль и NaN — «—». */
export const fmt = (n: number): string =>
  n ? n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : '—'
