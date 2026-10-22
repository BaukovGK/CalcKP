/**
 * Фильтры и сортировка списка проектов на главном экране: поиск, «Все/Свои»,
 * тип оборудования, статус единиц, автор. Отдельно от экрана — чтобы тест не
 * поднимал компонент.
 *
 * @module utils/project-filter
 */
import type { ProjectListItem } from '@/api/projects'
import type { DeviceType, EstimateStatus } from '@/api/estimates'

/** «Все» — проекты всей команды, «Свои» — заведённые мной. */
export type ProjectScope = 'all' | 'mine'

export interface ProjectFilter {
  search: string
  scope: ProjectScope
  /** Пусто — любой тип; иначе в проекте есть единица этого типа. */
  deviceType: DeviceType | ''
  /** Пусто — любой статус; иначе в проекте есть единица в этом статусе. */
  status: EstimateStatus | ''
  /** Пусто — любой автор. */
  authorId: string
}

export const EMPTY_FILTER: ProjectFilter = { search: '', scope: 'all', deviceType: '', status: '', authorId: '' }

/** Колонки таблицы проектов, по которым можно сортировать. */
export type ProjectSortKey = 'title' | 'customer' | 'units' | 'total' | 'author' | 'updatedAt'

export interface ProjectSort {
  key: ProjectSortKey
  dir: 'asc' | 'desc'
}

/** Сумма проекта — итоги единиц; у единицы без расчёта итога нет. */
export function projectTotal(p: Pick<ProjectListItem, 'estimates'>): number {
  return p.estimates.reduce((s, e) => s + (e.totalRub ?? 0), 0)
}

/** Отбор по фильтру; `userId` — кто смотрит, для «Свои». */
export function filterProjects(list: ProjectListItem[], f: ProjectFilter, userId: string | undefined): ProjectListItem[] {
  const q = f.search.trim().toLowerCase()
  return list.filter((p) => {
    if (f.scope === 'mine' && p.authorId !== userId) return false
    if (f.authorId && p.authorId !== f.authorId) return false
    if (f.deviceType && !p.estimates.some((e) => e.deviceType === f.deviceType)) return false
    if (f.status && !p.estimates.some((e) => e.status === f.status)) return false
    if (q && ![p.title, p.customer ?? '', p.address ?? ''].join(' ').toLowerCase().includes(q)) return false
    return true
  })
}

/** Авторы проектов списка — для выпадающего фильтра, по алфавиту. */
export function projectAuthors(list: ProjectListItem[]): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>()
  for (const p of list) if (p.authorId) byId.set(p.authorId, p.author?.name ?? '—')
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

/** Хоть один фильтр, кроме «Все/Свои», задан — для кнопки «Сбросить». */
export function hasActiveFilter(f: ProjectFilter): boolean {
  return !!(f.search.trim() || f.deviceType || f.status || f.authorId)
}

/** Сортировка таблицы; пустые значения — в конце при любом направлении. */
export function sortProjects(list: ProjectListItem[], s: ProjectSort): ProjectListItem[] {
  const value = (p: ProjectListItem): string | number | null => {
    switch (s.key) {
      case 'title': return p.title
      case 'customer': return p.customer || null
      case 'units': return p.estimates.length
      case 'total': return projectTotal(p) || null
      case 'author': return p.author?.name || null
      case 'updatedAt': return Date.parse(p.updatedAt)
    }
  }
  const sign = s.dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va == null || vb == null) return va == null ? (vb == null ? 0 : 1) : -1
    const c = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'ru', { numeric: true })
    return c * sign
  })
}
