import { describe, expect, it } from 'vitest'
import {
  countByCategory,
  haystack,
  matches,
  orderCategories,
  sortItems,
  withGroups,
  type RegistryFilter,
  type RegistryItem,
} from './price-registry'

const item = (over: Partial<RegistryItem> & Pick<RegistryItem, 'id' | 'category' | 'name'>): RegistryItem => ({
  unit: 'шт',
  priceRub: 100,
  supplier: null,
  comment: null,
  updatedAt: '2026-09-01T00:00:00Z',
  issue: null,
  ...over,
})

const ITEMS: RegistryItem[] = [
  item({ id: '1', category: 'Метизы', name: 'Болт М16-6gх100.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)', priceRub: 165 }),
  item({ id: '2', category: 'Метизы', name: 'Болт М6-6gх20.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)', priceRub: 6 }),
  item({ id: '3', category: 'Метизы', name: 'Болт М10-6gх20.58.12Х18Н10Т ГОСТ 7798-70 (DIN 931, DIN 933)', priceRub: null }),
  item({ id: '4', category: 'ФОТ', name: 'ФОТ', unit: 'чел. ч', priceRub: 1207.8 }),
  item({ id: '5', category: 'Металлопрокат', name: 'Лист г/к 4,0х1500х3000', unit: 'м²', priceRub: 310.28, issue: 'лист за штуку против цены за м²' }),
  item({ id: '6', category: 'Собственное производство', name: 'Формовка гильз', unit: 'кг', priceRub: 310.2, supplier: 'Своё производство' }),
]

const none: RegistryFilter = { query: '', categories: new Set(), noPrice: false, issues: false }
const pass = (f: Partial<RegistryFilter>, opts = {}) =>
  ITEMS.filter((i) => matches(i, haystack(i), { ...none, ...f }, opts)).map((i) => i.id)

describe('реестр цен: фильтры', () => {
  it('категории в порядке листа «НН»: ставки и своё производство сверху', () => {
    expect(orderCategories(ITEMS.map((i) => i.category))).toEqual(['ФОТ', 'Собственное производство', 'Металлопрокат', 'Метизы'])
  })

  it('поиск — все слова, в любом порядке, без учёта регистра', () => {
    expect(pass({ query: 'din болт м16' })).toEqual(['1'])
    expect(pass({ query: 'ГИЛЬЗ' })).toEqual(['6'])
  })

  it('поиск идёт и по поставщику', () => {
    expect(pass({ query: 'своё' })).toEqual(['6'])
  })

  it('несколько категорий сразу; ни одной — все', () => {
    expect(pass({ categories: new Set(['ФОТ', 'Металлопрокат']) })).toEqual(['4', '5'])
    expect(pass({})).toHaveLength(ITEMS.length)
  })

  it('«без цены» и «с замечаниями»', () => {
    expect(pass({ noPrice: true })).toEqual(['3'])
    expect(pass({ issues: true })).toEqual(['5'])
  })

  // Счётчики категорий — по остальным фильтрам: сколько найдётся, если
  // категорию добавить к выбору.
  it('счётчики категорий не зависят от выбранных категорий', () => {
    const f = { ...none, query: 'болт', categories: new Set(['ФОТ']) }
    const base = ITEMS.filter((i) => matches(i, haystack(i), f, { ignoreCategories: true }))
    expect(countByCategory(base).get('Метизы')).toBe(3)
  })
})

describe('реестр цен: порядок и вывод', () => {
  it('внутри категории — по наименованию с учётом чисел: М6, М10, М16', () => {
    const names = sortItems(ITEMS, { key: 'name', dir: 1 }).filter((i) => i.category === 'Метизы').map((i) => i.id)
    expect(names).toEqual(['2', '3', '1'])
  })

  it('по цене: строки без цены — в конце в обоих направлениях', () => {
    const up = sortItems(ITEMS, { key: 'price', dir: 1 }).filter((i) => i.category === 'Метизы').map((i) => i.id)
    const down = sortItems(ITEMS, { key: 'price', dir: -1 }).filter((i) => i.category === 'Метизы').map((i) => i.id)
    expect(up).toEqual(['2', '1', '3'])
    expect(down).toEqual(['1', '2', '3'])
  })

  it('заголовки категорий со счётчиками; лишнее сверх лимита не выводится', () => {
    const lines = withGroups(sortItems(ITEMS, { key: 'name', dir: 1 }), 3)
    expect(lines.map((l) => (l.kind === 'group' ? `# ${l.category} ${l.total}` : l.item.id))).toEqual([
      '# ФОТ 1', '4', '# Собственное производство 1', '6', '# Металлопрокат 1', '5',
    ])
  })
})
