// @vitest-environment jsdom
/**
 * Клавиатура таблицы расчёта (utils/cell-nav.ts).
 *
 * Дефект, ради которого написано: Enter в последней строке таблицы или
 * фильтра гасился вхолостую — фокус оставался в ячейке, и введённая цена не
 * применялась (строка шкафа управления оставалась «красной»). Ввод
 * фиксируется уходом из ячейки, поэтому Enter обязан из неё уйти.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cellNavAction, handleCellNav, type NavCell } from './cell-nav'

/** Таблица из строк: у каждой — ячейка количества и ячейка цены. */
function grid(rows: boolean[]): NavCell[] {
  return rows.flatMap((disabled) => [{ disabled }, { disabled }])
}

describe('куда ведёт клавиша', () => {
  // Три включённые строки: индексы 0/1, 2/3, 4/5 — количество/цена.
  const cells = grid([false, false, false])

  it('Enter и ↓ — та же колонка строкой ниже', () => {
    expect(cellNavAction(cells, 1, 'Enter', 'price')).toEqual({ kind: 'focus', cell: cells[3] })
    expect(cellNavAction(cells, 2, 'ArrowDown', 'qty')).toEqual({ kind: 'focus', cell: cells[4] })
  })

  it('Enter в последней строке снимает фокус — ввод фиксируется, а не гаснет', () => {
    expect(cellNavAction(cells, 5, 'Enter', 'price')).toEqual({ kind: 'blur' })
    expect(cellNavAction(cells, 4, 'Enter', 'qty')).toEqual({ kind: 'blur' })
  })

  it('↓ в последней строке и ↑ в первой — ничего', () => {
    expect(cellNavAction(cells, 5, 'ArrowDown', 'price')).toEqual({ kind: 'none' })
    expect(cellNavAction(cells, 1, 'ArrowUp', 'price')).toEqual({ kind: 'none' })
  })

  it('↑ — та же колонка строкой выше', () => {
    expect(cellNavAction(cells, 5, 'ArrowUp', 'price')).toEqual({ kind: 'focus', cell: cells[3] })
  })

  it('← и → — между количеством и ценой одной строки', () => {
    expect(cellNavAction(cells, 2, 'ArrowRight', 'qty')).toEqual({ kind: 'focus', cell: cells[3] })
    expect(cellNavAction(cells, 3, 'ArrowLeft', 'price')).toEqual({ kind: 'focus', cell: cells[2] })
    // Из цены вправо и из количества влево — некуда.
    expect(cellNavAction(cells, 3, 'ArrowRight', 'price')).toEqual({ kind: 'none' })
    expect(cellNavAction(cells, 2, 'ArrowLeft', 'qty')).toEqual({ kind: 'none' })
  })

  it('Esc снимает фокус, прочие клавиши не трогаются', () => {
    expect(cellNavAction(cells, 3, 'Escape', 'price')).toEqual({ kind: 'blur' })
    expect(cellNavAction(cells, 3, 'a', 'price')).toEqual({ kind: 'none' })
    expect(cellNavAction(cells, 3, 'Tab', 'price')).toEqual({ kind: 'none' })
  })

  // Строки выключенного узла видны с фильтром «выключенные», но их ячейки
  // недоступны: фокус на них не встаёт.
  it('выключенные строки пропускаются по вертикали', () => {
    const withGhost = grid([false, true, false])
    expect(cellNavAction(withGhost, 1, 'Enter', 'price')).toEqual({ kind: 'focus', cell: withGhost[5] })
    expect(cellNavAction(withGhost, 5, 'ArrowUp', 'price')).toEqual({ kind: 'focus', cell: withGhost[1] })
  })

  it('ниже только выключенные строки — Enter снимает фокус', () => {
    const tail = grid([false, true, true])
    expect(cellNavAction(tail, 1, 'Enter', 'price')).toEqual({ kind: 'blur' })
    expect(cellNavAction(tail, 1, 'ArrowDown', 'price')).toEqual({ kind: 'none' })
  })
})

describe('нажатие в DOM', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /** Таблица из полей ввода, как в конфигураторе: по две ячейки на строку. */
  function mountGrid(rows: boolean[]): HTMLInputElement[] {
    const cells = rows.flatMap((disabled) =>
      [0, 1].map(() => {
        const el = document.createElement('input')
        el.className = 'cell num'
        el.disabled = disabled
        document.body.appendChild(el)
        return el
      }),
    )
    return cells
  }

  function press(el: HTMLInputElement, key: string, cells: HTMLInputElement[], col: 'qty' | 'price') {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'target', { value: el })
    handleCellNav(ev, cells, col)
    return ev
  }

  it('Enter в последней строке уводит фокус из ячейки', () => {
    const cells = mountGrid([false, false])
    const last = cells[3]!
    last.focus()
    last.value = '1200000'
    const ev = press(last, 'Enter', cells, 'price')
    expect(document.activeElement).not.toBe(last)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Enter в середине переводит фокус в ту же колонку строки ниже', () => {
    const cells = mountGrid([false, false, false])
    cells[1]!.focus()
    const ev = press(cells[1]!, 'Enter', cells, 'price')
    expect(document.activeElement).toBe(cells[3])
    expect(ev.defaultPrevented).toBe(true)
  })

  it('Enter через выключенную строку попадает в следующую включённую', () => {
    const cells = mountGrid([false, true, false])
    cells[1]!.focus()
    press(cells[1]!, 'Enter', cells, 'price')
    expect(document.activeElement).toBe(cells[5])
  })

  it('необработанная клавиша не отменяет стандартное действие', () => {
    const cells = mountGrid([false, false])
    cells[3]!.focus()
    const ev = press(cells[3]!, 'ArrowDown', cells, 'price')
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(cells[3])
  })
})
