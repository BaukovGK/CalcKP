export interface CtxItem {
  head?: string
  sep?: boolean
  label?: string
  danger?: boolean
  action?: () => void
}

export interface DragData {
  type: string
  id: string
  parentId?: string
}

export interface CalcDragState {
  dropTarget: string | null
  data: DragData | null
}
