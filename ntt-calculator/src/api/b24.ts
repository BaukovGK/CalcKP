import { api } from './client'

/**
 * Сделка Битрикс24 во вкладке «Калькулятор» (doc/План_Б24_сделка.md).
 * Сервер спрашивает портал ключом вошедшего сотрудника — backend
 * routes/b24.routes.ts.
 */

/** GET /api/b24/deals/:id (backend utils/b24-deal.ts). */
export interface DealSummary {
  id: string
  title: string
  stageId: string | null
  opportunity: number | null
  currency: string | null
  companyId: string | null
  contactId: string | null
  /** Заказчик: компания сделки, нет её — контакт. */
  customer: string | null
  assignedName: string | null
  /** Адрес компании — черновик адреса объекта. */
  address: string | null
  url: string
}

export interface DealKp {
  version: number
  kpNumber: string | null
  totalRub: number
  createdAt: string
}

export interface DealProject {
  id: string
  title: string
  customer: string | null
  address: string | null
  createdAt: string
  updatedAt: string
  author: { name: string }
  estimates: {
    id: string
    title: string
    deviceType: string
    status: string
    totalRub: number | null
    /** Выпущенные КП по единице, новые первыми. */
    snapshots: DealKp[]
  }[]
}

export interface DealProjects {
  projects: DealProject[]
  /** Проекты по сделке, которые этому сотруднику не видны. */
  hidden: number
}

export const b24Api = {
  deal(id: string): Promise<DealSummary> {
    return api.get<DealSummary>(`/b24/deals/${encodeURIComponent(id)}`).then((r) => r.data)
  },
  dealProjects(id: string): Promise<DealProjects> {
    return api.get<DealProjects>(`/b24/deals/${encodeURIComponent(id)}/projects`).then((r) => r.data)
  },
  createProject(id: string, body: { title: string; customer?: string; address?: string }): Promise<{ id: string }> {
    return api.post<{ id: string }>(`/b24/deals/${encodeURIComponent(id)}/projects`, body).then((r) => r.data)
  },
}
