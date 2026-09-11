import { api } from './client'
import type { UserRole } from '@/stores/auth'

export interface AdminUser {
  id:        string
  email:     string
  name:      string
  role:      UserRole
  isActive:  boolean
  /** Пароль задан не им — сменит при входе (План_устранения 2.1). */
  mustChangePassword?: boolean
  createdAt: string
}

export interface CreateUserDto {
  email:    string
  name:     string
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
  user:       { name: string; email: string } | null
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
}

export const adminApi = {
  listUsers(): Promise<AdminUser[]> {
    return api.get<AdminUser[]>('/admin/users').then((r) => r.data)
  },

  createUser(dto: CreateUserDto): Promise<AdminUser> {
    return api.post<AdminUser>('/admin/users', dto).then((r) => r.data)
  },

  patchUser(id: string, dto: { role?: UserRole; isActive?: boolean; name?: string }): Promise<AdminUser> {
    return api.patch<AdminUser>(`/admin/users/${id}`, dto).then((r) => r.data)
  },

  /**
   * Сбросить пароль пользователю: сервер выдаёт временный пароль ОДИН раз,
   * при входе пользователь обязан его сменить (План_устранения 2.1).
   */
  resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    return api.post<{ temporaryPassword: string }>(`/admin/users/${id}/password-reset`).then((r) => r.data)
  },

  listAudit(): Promise<AuditEntry[]> {
    return api.get<AuditEntry[]>('/admin/audit').then((r) => r.data)
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
