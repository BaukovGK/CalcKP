import { api } from './client'

/**
 * Отчёты об ошибках (`/api/bug-reports`).
 *
 * Отправляет любой вошедший сотрудник — кнопка «Сообщить о проблеме» есть на
 * каждом экране (`composables/useBugReport.ts`). Читает, меняет статус и
 * удаляет администратор: раздел «Отчёты об ошибках» в администрировании.
 * Хранятся отчёты на сервере в своём каталоге, папкой на отчёт.
 */

/** Новый → в работе → закрыт. */
export type BugReportStatus = 'new' | 'in_progress' | 'resolved'

export const BUG_REPORT_STATUS_LABELS: Readonly<Record<BugReportStatus, string>> = {
  new: 'Новый',
  in_progress: 'В работе',
  resolved: 'Закрыт',
}

export interface BugReportScreenshot {
  /** Имя файла на сервере: `shot-1.png`. */
  name: string
  /** Как файл назывался у сотрудника; у вставленного из буфера — пусто. */
  originalName: string | null
  type: string
  sizeBytes: number
}

export interface BugReport {
  id: string
  createdAt: string
  updatedAt: string
  status: BugReportStatus
  text: string
  /** Где был сотрудник, когда открыл окно отчёта. */
  page: { url: string | null; title: string | null }
  /** Учётная запись на момент отправки. */
  author: { id: string; name: string; email: string; role: string } | null
  client: { userAgent: string | null; viewport: string | null; appBuild: string | null }
  screenshots: BugReportScreenshot[]
  /** Пометка администратора: что сделано, где исправлено. */
  adminNote: string | null
}

/** Строка списка. */
export interface BugReportSummary {
  id: string
  createdAt: string
  updatedAt: string
  status: BugReportStatus
  /** Начало текста, до двухсот знаков. */
  excerpt: string
  pageUrl: string | null
  authorName: string | null
  screenshots: number
  hasNote: boolean
}

export interface NewBugReport {
  text: string
  pageUrl: string
  pageTitle: string
  viewport: string
  screenshots: File[]
}

export const bugReportsApi = {
  /** Отправить отчёт; ответ — его номер. */
  send(r: NewBugReport): Promise<{ id: string; createdAt: string }> {
    const form = new FormData()
    form.append('text', r.text)
    form.append('pageUrl', r.pageUrl)
    form.append('pageTitle', r.pageTitle)
    form.append('viewport', r.viewport)
    for (const f of r.screenshots) form.append('screenshots', f, f.name)
    return api.post<{ id: string; createdAt: string }>('/bug-reports', form).then((res) => res.data)
  },

  /** Все отчёты, свежие первыми, и сколько из них новых. */
  list(): Promise<{ items: BugReportSummary[]; newCount: number }> {
    return api.get<{ items: BugReportSummary[]; newCount: number }>('/bug-reports').then((r) => r.data)
  },

  get(id: string): Promise<BugReport> {
    return api.get<BugReport>(`/bug-reports/${encodeURIComponent(id)}`).then((r) => r.data)
  },

  /**
   * Скриншот — файлом, а не адресом: картинка отдаётся только с токеном в
   * заголовке, а `<img src>` его не отправит.
   */
  file(id: string, name: string): Promise<Blob> {
    return api
      .get(`/bug-reports/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, { responseType: 'blob' })
      .then((r) => r.data as Blob)
  },

  update(id: string, patch: { status?: BugReportStatus; adminNote?: string | null }): Promise<BugReport> {
    return api.patch<BugReport>(`/bug-reports/${encodeURIComponent(id)}`, patch).then((r) => r.data)
  },

  remove(id: string): Promise<void> {
    return api.delete(`/bug-reports/${encodeURIComponent(id)}`).then(() => undefined)
  },
}
