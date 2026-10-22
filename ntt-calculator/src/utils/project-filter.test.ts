import { describe, expect, it } from 'vitest'
import type { ProjectListItem } from '@/api/projects'
import { EMPTY_FILTER, filterProjects, hasActiveFilter, projectAuthors, projectTotal, sortProjects } from './project-filter'

const unit = (deviceType: 'KNS' | 'EMK' | 'KOL', status: 'DRAFT' | 'APPROVED', totalRub: number | null) =>
  ({ id: `${deviceType}${status}`, title: deviceType, deviceType, status, totalRub })

const project = (id: string, authorId: string, name: string, extra: Partial<ProjectListItem> = {}): ProjectListItem => ({
  id, title: `Объект ${id}`, address: null, customer: null,
  updatedAt: '2026-10-01T00:00:00Z', createdAt: '2026-10-01T00:00:00Z',
  authorId, author: { name }, estimates: [], ...extra,
})

const a = project('1', 'u1', 'Иванов', { customer: 'Водоканал', estimates: [unit('KNS', 'DRAFT', 100), unit('EMK', 'APPROVED', 50)] })
const b = project('2', 'u2', 'Петров', { address: 'Краснодар', estimates: [unit('KOL', 'APPROVED', null)], updatedAt: '2026-10-05T00:00:00Z' })
const c = project('3', 'u1', 'Иванов', { title: 'Объект 10' })

describe('фильтры проектов', () => {
  it('без фильтра — все', () => {
    expect(filterProjects([a, b, c], EMPTY_FILTER, 'u1')).toEqual([a, b, c])
  })

  it('«Свои» — только заведённые мной', () => {
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, scope: 'mine' }, 'u1')).toEqual([a, c])
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, scope: 'mine' }, undefined)).toEqual([])
  })

  it('тип и статус — есть такая единица', () => {
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, deviceType: 'EMK' }, 'u1')).toEqual([a])
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, status: 'APPROVED' }, 'u1')).toEqual([a, b])
  })

  it('автор и поиск по заказчику и адресу', () => {
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, authorId: 'u2' }, 'u1')).toEqual([b])
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, search: 'водо' }, 'u1')).toEqual([a])
    expect(filterProjects([a, b, c], { ...EMPTY_FILTER, search: ' КРАСНОДАР ' }, 'u1')).toEqual([b])
  })

  it('авторы списка — без повторов, по алфавиту', () => {
    expect(projectAuthors([b, a, c])).toEqual([{ id: 'u1', name: 'Иванов' }, { id: 'u2', name: 'Петров' }])
  })

  it('«Все/Свои» не считается фильтром для «Сбросить»', () => {
    expect(hasActiveFilter({ ...EMPTY_FILTER, scope: 'mine' })).toBe(false)
    expect(hasActiveFilter({ ...EMPTY_FILTER, status: 'DRAFT' })).toBe(true)
  })
})

describe('сортировка таблицы проектов', () => {
  it('сумма проекта — итоги единиц, пустые как ноль', () => {
    expect(projectTotal(a)).toBe(150)
    expect(projectTotal(b)).toBe(0)
  })

  it('название — с числами по порядку', () => {
    expect(sortProjects([c, b, a], { key: 'title', dir: 'asc' }).map((p) => p.id)).toEqual(['1', '2', '3'])
  })

  it('пустые значения — в конце при любом направлении', () => {
    expect(sortProjects([b, c, a], { key: 'total', dir: 'desc' }).map((p) => p.id)).toEqual(['1', '2', '3'])
    expect(sortProjects([c, a, b], { key: 'customer', dir: 'asc' })[0]).toBe(a)
    expect(sortProjects([c, a, b], { key: 'customer', dir: 'desc' })[0]).toBe(a)
  })

  it('дата и число единиц', () => {
    expect(sortProjects([a, b], { key: 'updatedAt', dir: 'desc' })[0]).toBe(b)
    expect(sortProjects([a, b, c], { key: 'units', dir: 'asc' }).map((p) => p.id)).toEqual(['3', '2', '1'])
  })
})
