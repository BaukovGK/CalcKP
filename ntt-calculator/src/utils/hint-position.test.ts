import { describe, expect, it } from 'vitest'
import { HINT_EDGE_PX, HINT_GAP_PX, placeHint } from './hint-position'

const viewport = { width: 1280, height: 800 }
const box = { width: 300, height: 120 }
const anchor = (top: number, left: number, height = 20, width = 120) => ({ top, left, right: left + width, bottom: top + height })

describe('место окна сноски', () => {
  it('под пунктом, от его левого края', () => {
    expect(placeHint({ anchor: anchor(100, 200), box, viewport, mode: 'item', pointerX: 0 })).toEqual({
      top: 120 + HINT_GAP_PX,
      left: 200,
    })
  })

  it('снизу нет места — над пунктом', () => {
    const p = placeHint({ anchor: anchor(740, 200), box, viewport, mode: 'item', pointerX: 0 })
    expect(p.top).toBe(740 - HINT_GAP_PX - box.height)
  })

  it('у правого края окно сдвигается влево, не выходя за экран', () => {
    const p = placeHint({ anchor: anchor(100, 1200), box, viewport, mode: 'item', pointerX: 0 })
    expect(p.left).toBe(viewport.width - HINT_EDGE_PX - box.width)
  })

  // Строка таблицы шире окна: сноска встаёт у указателя, а не у начала строки.
  it('строка — у указателя, чуть левее него', () => {
    const p = placeHint({ anchor: anchor(300, 0, 32, 1200), box, viewport, mode: 'row', pointerX: 640 })
    expect(p.left).toBe(616)
    expect(p.top).toBe(332 + HINT_GAP_PX)
  })

  it('окно выше экрана прижимается к верхнему краю', () => {
    const p = placeHint({ anchor: anchor(400, 100), box: { width: 300, height: 900 }, viewport, mode: 'item', pointerX: 0 })
    expect(p.top).toBe(HINT_EDGE_PX)
  })
})
