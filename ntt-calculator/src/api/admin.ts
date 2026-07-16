import { api } from './client'
import type { UserRole } from '@/stores/auth'

export interface AdminUser {
  id:        string
  email:     string
  name:      string
  role:      UserRole
  isActive:  boolean
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

  listAudit(): Promise<AuditEntry[]> {
    return api.get<AuditEntry[]>('/admin/audit').then((r) => r.data)
  },
}
