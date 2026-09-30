// @vitest-environment jsdom
/**
 * Отчёты об ошибках в администрировании: список с отбором по статусу, отчёт
 * со скриншотами, смена статуса, пометка и удаление.
 */
import { flushPromises, mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { list, get, file, update, remove } = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  file: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('@/api/bugReports', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/bugReports')>()
  return {
    ...actual,
    bugReportsApi: {
      list: () => list(),
      get: (id: string) => get(id),
      file: (id: string, name: string) => file(id, name),
      update: (id: string, dto: unknown) => update(id, dto),
      remove: (id: string) => remove(id),
    },
  }
})

import BugReportsPanel from './BugReportsPanel.vue'

const SUMMARIES = [
  { id: 'br-20260930-100000-aaaaaa', createdAt: '2026-09-30T10:00:00Z', updatedAt: '2026-09-30T10:00:00Z', status: 'new', excerpt: 'Не сохраняется опросный лист', pageUrl: '/survey/1', authorName: 'Иванов С.В.', screenshots: 2, hasNote: false },
  { id: 'br-20260929-100000-bbbbbb', createdAt: '2026-09-29T10:00:00Z', updatedAt: '2026-09-29T12:00:00Z', status: 'in_progress', excerpt: 'Итог не сходится', pageUrl: '/calculator/2', authorName: 'Петров П.П.', screenshots: 0, hasNote: true },
  { id: 'br-20260901-100000-cccccc', createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z', status: 'resolved', excerpt: 'Старая ошибка', pageUrl: null, authorName: null, screenshots: 0, hasNote: true },
]

const REPORT = {
  id: 'br-20260930-100000-aaaaaa',
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
  status: 'new',
  text: 'Не сохраняется опросный лист.\nПосле «Создать расчёт» пустой экран.',
  page: { url: '/survey/1?type=KNS', title: 'Опросный лист' },
  author: { id: 'u1', name: 'Иванов С.В.', email: 'ivanov@ntt.local', role: 'ENGINEER' },
  client: { userAgent: 'Mozilla/5.0 Chrome/141', viewport: '1920×1080', appBuild: null },
  screenshots: [
    { name: 'shot-1.png', originalName: 'Снимок экрана.png', type: 'image/png', sizeBytes: 250_000 },
    { name: 'shot-2.jpg', originalName: null, type: 'image/jpeg', sizeBytes: 900_000 },
  ],
  adminNote: null,
}

async function mountPanel(): Promise<VueWrapper> {
  const w = mount(BugReportsPanel, {
    props: { roleLabels: { ENGINEER: 'Инженер' } },
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  await flushPromises()
  return w
}

const chip = (w: VueWrapper, label: string) => w.findAll('.chip-f').find((b) => b.text().startsWith(label))!

beforeEach(() => {
  vi.clearAllMocks()
  list.mockResolvedValue({ items: SUMMARIES.map((s) => ({ ...s })), newCount: 1 })
  get.mockResolvedValue({ ...REPORT })
  file.mockResolvedValue(new Blob(['png']))
  update.mockImplementation((_id: string, dto: Record<string, unknown>) =>
    Promise.resolve({ ...REPORT, ...dto, updatedAt: '2026-09-30T11:00:00Z' }),
  )
  remove.mockResolvedValue(undefined)
  URL.createObjectURL = vi.fn((b: Blob) => `blob:${(b as Blob).size}`)
  URL.revokeObjectURL = vi.fn()
})

describe('отчёты об ошибках — список', () => {
  it('по умолчанию — открытые, свежие первыми; закрытые — своим отбором', async () => {
    const w = await mountPanel()

    expect(w.findAll('.bgr-row').map((r) => r.find('.bgr-ex').text())).toEqual([
      'Не сохраняется опросный лист',
      'Итог не сходится',
    ])
    expect(chip(w, 'Открытые').text()).toBe('Открытые 2')
    expect(chip(w, 'Закрытые').text()).toBe('Закрытые 1')

    await chip(w, 'Закрытые').trigger('click')
    expect(w.findAll('.bgr-row').map((r) => r.find('.bgr-ex').text())).toEqual(['Старая ошибка'])
  })

  it('сообщает число новых — для счётчика у пункта меню', async () => {
    const w = await mountPanel()
    expect(w.emitted('new-count')?.[0]).toEqual([1])
  })

  it('пусто — так и сказано', async () => {
    list.mockResolvedValue({ items: [], newCount: 0 })
    const w = await mountPanel()
    expect(w.text()).toContain('Отчётов об ошибках пока нет')
  })

  it('отказ сервера — объяснение и «Повторить»', async () => {
    list.mockRejectedValue({ response: { data: { message: 'Недостаточно прав' } } })
    const w = await mountPanel()
    expect(w.text()).toContain('Недостаточно прав')
    expect(w.findAll('button').some((b) => b.text() === 'Повторить')).toBe(true)
  })
})

describe('отчёт', () => {
  it('текст, автор, экран ссылкой, окно и браузер', async () => {
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()

    expect(get).toHaveBeenCalledWith('br-20260930-100000-aaaaaa')
    expect(w.get('.bgr-text').text()).toBe(REPORT.text)
    const dl = w.get('.bgr-dl').text()
    expect(dl).toContain('Иванов С.В. · ivanov@ntt.local · Инженер')
    expect(dl).toContain('Опросный лист')
    expect(dl).toContain('1920×1080')
    // Адрес экрана — ссылка внутри приложения: открывает то самое место.
    expect(w.getComponent(RouterLinkStub).props('to')).toBe('/survey/1?type=KNS')
    // Просмотр статус не меняет: разбирает отчёт человек.
    expect(update).not.toHaveBeenCalled()
  })

  it('скриншоты грузятся файлами и открываются во весь размер', async () => {
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()

    expect(file).toHaveBeenCalledWith(REPORT.id, 'shot-1.png')
    expect(file).toHaveBeenCalledWith(REPORT.id, 'shot-2.jpg')
    expect(w.findAll('.bgr-shot img')).toHaveLength(2)

    await w.findAll('.bgr-shot')[0]!.trigger('click')
    expect(w.get('.bgr-viewer-h').text()).toContain('Снимок экрана.png')
  })

  it('чужая ссылка экрана ссылкой не становится', async () => {
    get.mockResolvedValue({ ...REPORT, page: { url: '//evil.example/x', title: null } })
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()
    expect(w.findComponent(RouterLinkStub).exists()).toBe(false)
    expect(w.get('.bgr-dl').text()).toContain('//evil.example/x')
  })

  it('смена статуса уходит на сервер, строка и счётчик новых — следом', async () => {
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()

    await w.get('.bgr-status').setValue('in_progress')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(REPORT.id, { status: 'in_progress' })
    expect(w.findAll('.bgr-row')[0]!.get('.bgr-st').text()).toBe('В работе')
    const counts = w.emitted('new-count') ?? []
    expect(counts[counts.length - 1]).toEqual([0])
  })

  it('пометка сохраняется; пустая — стирается', async () => {
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()

    await w.get('.bgr-note').setValue('  Исправлено в 84a104b  ')
    await w.findAll('button').find((b) => b.text() === 'Сохранить пометку')!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(REPORT.id, { adminNote: 'Исправлено в 84a104b' })

    await w.get('.bgr-note').setValue('   ')
    await w.findAll('button').find((b) => b.text() === 'Сохранить пометку')!.trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(REPORT.id, { adminNote: null })
  })

  it('удаление — после подтверждения; отчёт пропадает из списка', async () => {
    const w = await mountPanel()
    await w.findAll('.bgr-row')[0]!.trigger('click')
    await flushPromises()

    await w.findAll('button').find((b) => b.text() === 'Удалить отчёт')!.trigger('click')
    expect(remove).not.toHaveBeenCalled()
    await w.findAll('.mo-ft button').find((b) => b.text() === 'Удалить')!.trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(REPORT.id)
    expect(w.findAll('.bgr-row').map((r) => r.find('.bgr-ex').text())).toEqual(['Итог не сходится'])
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })
})
