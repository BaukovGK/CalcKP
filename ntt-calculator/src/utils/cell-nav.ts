/**
 * Клавиатура в таблице расчёта — как в Excel: Enter и ↓ — на строку ниже,
 * ↑ — выше, ←/→ — между количеством и ценой, Esc — выйти из ячейки.
 *
 * Ввод ячейки фиксируется событием change, а оно приходит, когда ячейка
 * теряет фокус. Отсюда главное правило: Enter обязан увести фокус из ячейки,
 * даже если идти ниже некуда — последняя строка таблицы или фильтра, а ниже
 * только выключенные строки. Тогда он просто снимает фокус, как Esc.
 *
 * Раньше Enter там гасился вхолостую: переход на несуществующую ячейку не
 * происходил, а стандартное действие клавиши было отменено — введённая в
 * последнюю строку цена так и оставалась в поле неприменённой, строка —
 * «красной», а выпуск КП — заблокированным.
 *
 * @module utils/cell-nav
 */

/** Ячеек в строке таблицы: количество и цена. */
export const CELLS_PER_ROW = 2

/** Что нужно ячейке для навигации — доступна ли она для ввода. */
export interface NavCell {
  disabled: boolean
}

/** Столбец ячейки, из которой нажата клавиша. */
export type NavColumn = 'qty' | 'price'

/** Итог нажатия: перейти в ячейку, снять фокус (зафиксировать ввод) или ничего. */
export type NavAction<T> = { kind: 'focus'; cell: T } | { kind: 'blur' } | { kind: 'none' }

/**
 * Куда ведёт клавиша из ячейки `index`.
 *
 * По вертикали выключенные ячейки (строки выключенных узлов) пропускаются:
 * фокус на них не встаёт, и переход «в никуда» оставил бы ввод
 * незафиксированным. По горизонтали — только соседняя ячейка той же строки.
 */
export function cellNavAction<T extends NavCell>(
  cells: readonly T[],
  index: number,
  key: string,
  col: NavColumn,
): NavAction<T> {
  const vertical = (by: number): T | null => {
    for (let j = index + by; j >= 0 && j < cells.length; j += by) {
      const cell = cells[j]!
      if (!cell.disabled) return cell
    }
    return null
  }
  const adjacent = (j: number): T | null => {
    const cell = cells[j]
    return cell && !cell.disabled ? cell : null
  }
  const focus = (cell: T | null): NavAction<T> => (cell ? { kind: 'focus', cell } : { kind: 'none' })

  switch (key) {
    case 'Enter': {
      const next = vertical(CELLS_PER_ROW)
      return next ? { kind: 'focus', cell: next } : { kind: 'blur' }
    }
    case 'ArrowDown':
      return focus(vertical(CELLS_PER_ROW))
    case 'ArrowUp':
      return focus(vertical(-CELLS_PER_ROW))
    case 'ArrowRight':
      return col === 'qty' ? focus(adjacent(index + 1)) : { kind: 'none' }
    case 'ArrowLeft':
      return col === 'price' ? focus(adjacent(index - 1)) : { kind: 'none' }
    case 'Escape':
      return { kind: 'blur' }
    default:
      return { kind: 'none' }
  }
}

/**
 * Выполнить нажатие в DOM: перевести фокус или снять его.
 *
 * Стандартное действие клавиши отменяется только когда клавиша обработана:
 * фокус ушёл — ячейка, которую покинули, сама отдаёт change.
 */
export function handleCellNav(ev: KeyboardEvent, cells: readonly HTMLInputElement[], col: NavColumn): void {
  const el = ev.target as HTMLInputElement
  const i = cells.indexOf(el)
  if (i < 0) return
  const action = cellNavAction(cells, i, ev.key, col)
  if (action.kind === 'focus') {
    action.cell.focus()
    ev.preventDefault()
  } else if (action.kind === 'blur') {
    el.blur()
    ev.preventDefault()
  }
}
