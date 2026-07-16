export type RowType = 'МАТ' | 'РАБ' | 'ФОТ' | 'ЗАК'
export type BuyState = 'нет' | 'да' | '-'

export interface CalcRow {
  id: string
  rtype: RowType
  category: string
  name: string
  purchase: BuyState
  qty: string
  unit: string
  price: string
  note: string
  isAuto: boolean
  autoParentId: string | null
  autoCoeff: number | null
}

export interface CalcSubgroup {
  id: string
  title: string
  collapsed: boolean
  rows: CalcRow[]
}

export interface CalcGroup {
  id: string
  title: string
  collapsed: boolean
  subgroups: CalcSubgroup[]
}

export interface CalcBundle {
  id: string
  title: string
  color: string
  collapsed: boolean
  groups: CalcGroup[]
}

export interface NomItem {
  n: string   // наименование
  u: string   // единица измерения
  p: string   // цена
  note: string
}
