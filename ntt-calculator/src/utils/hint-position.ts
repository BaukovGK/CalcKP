/**
 * Место окна сноски — чистая функция, чтобы проверять её без браузера.
 *
 * Правила:
 *  - окно встаёт под пунктом, а если снизу не хватает места — над ним;
 *    не влезает ни там, ни там — туда, где места больше;
 *  - пункт — от его левого края; строка таблицы длинная, поэтому окно
 *    встаёт у указателя, чуть левее него;
 *  - окно не выходит за экран: по 8 px от краёв.
 */

export interface HintPlacementInput {
  anchor: { top: number; left: number; right: number; bottom: number }
  box: { width: number; height: number }
  viewport: { width: number; height: number }
  mode: 'item' | 'row'
  pointerX: number
}

/** Отступ от края экрана, px. */
export const HINT_EDGE_PX = 8
/** Зазор между пунктом и окном, px. */
export const HINT_GAP_PX = 6

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi))

export function placeHint({ anchor, box, viewport, mode, pointerX }: HintPlacementInput): { top: number; left: number } {
  const below = anchor.bottom + HINT_GAP_PX
  const above = anchor.top - HINT_GAP_PX - box.height
  let top: number
  if (below + box.height <= viewport.height - HINT_EDGE_PX) top = below
  else if (above >= HINT_EDGE_PX) top = above
  else top = viewport.height - anchor.bottom >= anchor.top ? below : above

  const wanted = mode === 'row' ? pointerX - 24 : anchor.left

  return {
    top: Math.round(clamp(top, HINT_EDGE_PX, viewport.height - HINT_EDGE_PX - box.height)),
    left: Math.round(clamp(wanted, HINT_EDGE_PX, viewport.width - HINT_EDGE_PX - box.width)),
  }
}
