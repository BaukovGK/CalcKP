import { api } from './client'
import type { UserRole } from '@/stores/auth'

export interface AdminUser {
  id:        string
  email:     string
  /** ФИО целиком: «Иванов Сергей Владимирович» — в КП из него берут инициалы. */
  name:      string
  /** Должность сотрудника; печатается в блоке исполнителя КП. */
  position?: string | null
  /** Рабочий телефон с добавочным — туда же. */
  phone?:    string | null
  role:      UserRole
  isActive:  boolean
  /** Пароль задан не им — сменит при входе (План_устранения 2.1). */
  mustChangePassword?: boolean
  createdAt: string
}

export interface CreateUserDto {
  email:    string
  name:     string
  position?: string | null
  phone?:    string | null
  role:     UserRole
  password: string
}

export interface AuditEntry {
  id:         string
  action:     string
  entityType: string | null
  entityId:   string | null
  meta:       unknown
  createdAt:  string
  user:       { id: string; name: string; email: string; position?: string | null } | null
}

/** Отбор записей журнала — то же, что поля фильтра на экране. */
export interface AuditFilter {
  /** Сотрудник — id учётной записи. */
  user?: string
  /** Раздел («estimate») или точное действие («estimate.kp»). */
  action?: string
  /** Объект: id расчёта, проекта, сотрудника. */
  entity?: string
  /** Период — полными моментами: их считает браузер, по часам пользователя. */
  from?: string
  to?: string
  q?: string
  limit?: number
  offset?: number
}

/** Страница журнала: записи и сколько их всего по этому отбору. */
export interface AuditPage {
  items: AuditEntry[]
  total: number
  limit: number
  offset: number
}

/** Какие события встречаются в журнале — для выбора в отборе. */
export interface AuditActionCount {
  action: string
  count: number
}

/** Файл дампа в каталоге бэкапов. */
export interface DumpInfo {
  name: string
  sizeBytes: number
  createdAt: string
  /** manual · pre-migrate · pre-restore · uploaded */
  label: string
}

export interface RestoreResult {
  restored: string
  /** Дамп состояния, снятый ПЕРЕД заменой, — точка возврата. */
  safetyDump: string
  /** Миграции, которых в дампе нет: применятся при перезапуске (План_устранения 3.3). */
  missingMigrations?: string[]
  /** Бэкенд перезапускается, чтобы применить их. */
  restarting?: boolean
}

export const adminApi = {
  listUsers(): Promise<AdminUser[]> {
    return api.get<AdminUser[]>('/admin/users').then((r) => r.data)
  },

  createUser(dto: CreateUserDto): Promise<AdminUser> {
    return api.post<AdminUser>('/admin/users', dto).then((r) => r.data)
  },

  patchUser(
    id: string,
    dto: { role?: UserRole; isActive?: boolean; name?: string; position?: string | null; phone?: string | null },
  ): Promise<AdminUser> {
    return api.patch<AdminUser>(`/admin/users/${id}`, dto).then((r) => r.data)
  },

  /**
   * Сбросить пароль пользователю: сервер выдаёт временный пароль ОДИН раз,
   * при входе пользователь обязан его сменить (План_устранения 2.1).
   */
  resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    return api.post<{ temporaryPassword: string }>(`/admin/users/${id}/password-reset`).then((r) => r.data)
  },

  /** Страница журнала действий по отбору. */
  listAudit(filter: AuditFilter = {}): Promise<AuditPage> {
    const params = Object.fromEntries(
      Object.entries(filter).filter(([, v]) => v !== undefined && v !== '' && v !== null),
    )
    return api.get<AuditPage>('/admin/audit', { params }).then((r) => r.data)
  },

  /** Встречающиеся в журнале события — список для отбора. */
  auditActions(): Promise<AuditActionCount[]> {
    return api.get<AuditActionCount[]>('/admin/audit/actions').then((r) => r.data)
  },

  // ── Дампы базы ───────────────────────────────────────────────────────────
  // Тот же каталог, что у скриптов и у дампа перед миграциями: админка даёт
  // доступ к общему механизму, а не заводит свой.

  listBackups(): Promise<DumpInfo[]> {
    return api.get<DumpInfo[]>('/admin/backups').then((r) => r.data)
  },

  createBackup(): Promise<DumpInfo> {
    return api.post<DumpInfo>('/admin/backups').then((r) => r.data)
  },

  downloadBackup(name: string): Promise<Blob> {
    return api
      .get(`/admin/backups/${encodeURIComponent(name)}`, { responseType: 'blob' })
      .then((r) => r.data as Blob)
  },

  deleteBackup(name: string): Promise<void> {
    return api.delete(`/admin/backups/${encodeURIComponent(name)}`).then(() => undefined)
  },

  /** Загрузка кладёт файл в каталог, но НЕ применяет его — это отдельное действие. */
  uploadBackup(file: File): Promise<DumpInfo> {
    const form = new FormData()
    form.append('file', file)
    return api.post<DumpInfo>('/admin/backups/upload', form).then((r) => r.data)
  },

  /**
   * Заменить базу содержимым дампа. `confirm` обязан повторять имя файла —
   * сервер сверяет, чтобы случайный клик не заменил базу.
   */
  restoreBackup(name: string): Promise<RestoreResult> {
    return api
      .post<RestoreResult>(`/admin/backups/${encodeURIComponent(name)}/restore`, { confirm: name })
      .then((r) => r.data)
  },
}
