import { api } from './client'

export type { DeviceType } from '@/types/device'
import type { DeviceType } from '@/types/device'
export type EstimateStatus = 'DRAFT' | 'CALC' | 'REVIEW' | 'APPROVED' | 'REJECTED'

export interface SurveyMeta {
  address?:  string
  customer?: string
  notes?:    string
}

export interface EstimateListItem {
  id: string
  title: string
  deviceType: DeviceType
  status: EstimateStatus
  totalRub: number | null
  updatedAt: string
  surveyData: SurveyMeta & Record<string, unknown>
  author: { name: string }
  /**
   * Версия расчёта: растёт с каждой записью ОЛ и дерева. Запись шлёт версию,
   * с которой работала; не совпала — 409 ESTIMATE_CHANGED (План_устранения 3.1).
   */
  version?: number
}

export interface EstimateDetail extends EstimateListItem {
  authorId: string
  projectId: string | null
  surveyData: Record<string, unknown>
  snapshots: Array<{ id: string; version: number; createdAt: string }>
}

/** Снапшот расчёта — строка истории версий (ТЗ §7). */
export interface EstimateSnapshotInfo {
  id: string
  version: number
  priceListVersion: number
  totalRub: number
  createdAt: string
  /**
   * Зачем снят слепок: CREATE — при создании единицы (исходное состояние,
   * КП по нему не печатается), MANUAL — ручная фиксация, KP — выпуск КП.
   */
  reason?: SnapshotReason
  /**
   * Версия шаблона изделия, по которой собран состав: 0 — встроенный, N —
   * опубликованная технологом. `null` — слепок снят до появления отметки.
   */
  templateVersion?: number | null
  /**
   * Редакция встроенного шаблона изделия — версия кода, которым собран
   * состав (engines/builtin-revisions.ts). `null` — слепок снят до учёта редакций.
   */
  builtinRevision?: number | null
}

export type SnapshotReason = 'CREATE' | 'MANUAL' | 'KP'

/** Ответ выпуска КП: что зафиксировано и каким снапшотом. */
export interface KpResult {
  estimate: { id: string; title: string; deviceType: DeviceType; totalRub: number | null }
  project: { title: string; customer: string | null; address: string | null } | null
  snapshot: { version: number; priceListVersion: number; createdAt: string }
}

export const estimatesApi = {
  list(): Promise<EstimateListItem[]> {
    return api.get<EstimateListItem[]>('/estimates').then((r) => r.data)
  },

  get(id: string): Promise<EstimateDetail> {
    return api.get<EstimateDetail>(`/estimates/${id}`).then((r) => r.data)
  },

  // Создания здесь нет намеренно: единица создаётся в проекте
  // (`projectsApi.addEstimate`) — расчёт вне проекта не виден нигде в
  // интерфейсе (План_устранения 3.8).

  patchSurvey(id: string, surveyData: Record<string, unknown>): Promise<EstimateDetail> {
    return api.patch<EstimateDetail>(`/estimates/${id}/survey`, surveyData).then((r) => r.data)
  },

  patchStatus(id: string, status: EstimateStatus): Promise<EstimateDetail> {
    return api.patch<EstimateDetail>(`/estimates/${id}/status`, { status }).then((r) => r.data)
  },

  delete(id: string): Promise<void> {
    return api.delete(`/estimates/${id}`).then(() => undefined)
  },

  /** История версий (без содержимого деревьев — они тяжёлые). */
  snapshots(id: string): Promise<EstimateSnapshotInfo[]> {
    return api.get<EstimateSnapshotInfo[]>(`/estimates/${id}/snapshots`).then((r) => r.data)
  },

  /**
   * Слепок текущего состояния расчёта на сервере: ручная фиксация из окна
   * «Версии» (MANUAL) или слепок при создании единицы (CREATE).
   */
  createSnapshot(id: string, reason: Exclude<SnapshotReason, 'KP'> = 'MANUAL'): Promise<EstimateSnapshotInfo> {
    return api.post<EstimateSnapshotInfo>(`/estimates/${id}/snapshot`, { reason }).then((r) => r.data)
  },

  /** Выпуск КП: серверный гейт «нет строк без цены» + снапшот. */
  kp(id: string): Promise<KpResult> {
    return api.post<KpResult>(`/estimates/${id}/kp`).then((r) => r.data)
  },

  /**
   * Печатная форма выпущенного КП.
   *
   * Строится из снапшота, а не из текущего дерева: расчёт после выпуска КП
   * продолжает правиться, а документ обязан воспроизводить согласованную
   * редакцию. Без `version` берётся последняя.
   */
  kpExport(id: string, format: 'docx' | 'pdf', version?: number): Promise<Blob> {
    return api
      .get(`/estimates/${id}/kp/export`, {
        params: { format, ...(version != null ? { version } : {}) },
        responseType: 'blob',
      })
      .then((r) => r.data as Blob)
  },
}
