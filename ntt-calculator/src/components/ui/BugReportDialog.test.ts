// @vitest-environment jsdom
/**
 * Окно «Сообщить о проблеме»: пояснение, текст, скриншоты (файлом, из
 * буфера, перетаскиванием) и «Отправить». Открывается кнопкой в оболочке
 * любого экрана; экран и размер окна прикладываются сами.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { send, route } = vi.hoisted(() => ({
  send: vi.fn(),
  route: { fullPath: '/calculator/abc', name: 'calculator' as string },
}))
const currentRoute = reactive(route)

vi.mock('vue-router', () => ({ useRoute: () => currentRoute }))
vi.mock('@/api/bugReports', () => ({ bugReportsApi: { send: (r: unknown) => send(r) } }))

import BugReportDialog from './BugReportDialog.vue'
import { bugReportOpen, closeBugReport, openBugReport } from '@/composables/useBugReport'

const png = (name = 'shot.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })

let mounted: VueWrapper | null = null

async function openDialog(): Promise<VueWrapper> {
  mounted = mount(BugReportDialog, { attachTo: document.body })
  openBugReport()
  await nextTick()
  return mounted
}

async function reopen() {
  openBugReport()
  await nextTick()
}

function button(w: VueWrapper, text: string) {
  const b = w.findAll('button').find((x) => x.text() === text)
  if (!b) throw new Error(`нет кнопки «${text}»`)
  return b
}

async function attach(w: VueWrapper, files: File[]) {
  const input = w.get('.bug-tools input[type=file]')
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

beforeEach(() => {
  send.mockReset()
  currentRoute.fullPath = '/calculator/abc'
  currentRoute.name = 'calculator'
  // В jsdom blob-ссылок нет — превью скриншотов без них не собрать.
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  mounted?.unmount()
  mounted = null
  closeBugReport()
  document.body.innerHTML = ''
})

describe('окно «Сообщить о проблеме»', () => {
  it('закрыто, пока его не открыли кнопкой', () => {
    mounted = mount(BugReportDialog, { attachTo: document.body })
    expect(mounted.find('.mo').exists()).toBe(false)
  })

  it('открытое — пояснение, поле и «Отправить»', async () => {
    const w = await openDialog()

    expect(w.get('.mo-tt').text()).toBe('Сообщить о проблеме')
    expect(w.get('.bug-lead').text()).toContain('Опишите, что вы делали')
    expect(w.find('#bug-text').exists()).toBe(true)
    expect(button(w, 'Отправить').exists()).toBe(true)
  })

  it('экран и размер окна прикладываются сами — и видно, что именно', async () => {
    const w = await openDialog()
    expect(w.get('.bug-ctx').text()).toContain('«Расчёт» (/calculator/abc)')
    expect(w.get('.bug-ctx').text()).toContain(`${window.innerWidth}×${window.innerHeight}`)
  })

  // Черновик переживает переход, а экран в отчёте — тот, откуда открыли сейчас.
  it('открыли на другом экране — в отчёте уже он', async () => {
    const w = await openDialog()
    await button(w, 'Отмена').trigger('click')
    currentRoute.fullPath = '/prices'
    currentRoute.name = 'prices'
    await reopen()
    expect(w.get('.bug-ctx').text()).toContain('«Прайс» (/prices)')
  })

  it('без текста отправить нельзя', async () => {
    const w = await openDialog()
    expect(button(w, 'Отправить').attributes('disabled')).toBeDefined()
    await w.get('#bug-text').setValue('   ')
    expect(button(w, 'Отправить').attributes('disabled')).toBeDefined()
    await w.get('#bug-text').setValue('Не сохраняется лист')
    expect(button(w, 'Отправить').attributes('disabled')).toBeUndefined()
  })

  it('скриншот файлом — превью с именем и размером, убирается крестиком', async () => {
    const w = await openDialog()
    await attach(w, [png('Снимок.png')])

    expect(w.findAll('.bug-shot')).toHaveLength(1)
    expect(w.get('.bug-shot figcaption').text()).toContain('Снимок.png')
    await w.get('.bug-shot-x').trigger('click')
    expect(w.findAll('.bug-shot')).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('не картинка — не прикрепляется, причина видна', async () => {
    const w = await openDialog()
    await attach(w, [new File(['x'], 'смета.xlsx', { type: 'application/vnd.ms-excel' })])

    expect(w.findAll('.bug-shot')).toHaveLength(0)
    expect(w.get('.bug-problems').text()).toContain('«смета.xlsx» — не картинка')
  })

  it('картинка из буфера вставляется и получает своё имя', async () => {
    const w = await openDialog()
    const clipboardData = {
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => png('image.png') }],
      files: [],
    }
    await w.get('#bug-text').trigger('paste', { clipboardData })
    await flushPromises()

    expect(w.findAll('.bug-shot')).toHaveLength(1)
    expect(w.get('.bug-shot figcaption').text()).toContain('Скриншот 1.png')
  })

  it('перетаскивание на окно — тоже скриншот', async () => {
    const w = await openDialog()
    await w.get('.mo').trigger('drop', { dataTransfer: { files: [png('drop.png')] } })
    await flushPromises()
    expect(w.get('.bug-shot figcaption').text()).toContain('drop.png')
  })

  it('«Отправить» уносит текст, экран и скриншоты; черновик очищается', async () => {
    send.mockResolvedValue({ id: 'br-20260930-081502-a1b2c3', createdAt: '2026-09-30T08:15:02Z' })
    const w = await openDialog()
    await w.get('#bug-text').setValue('  Итог не сходится с суммой строк  ')
    const shot = png()
    await attach(w, [shot])
    await button(w, 'Отправить').trigger('click')
    await flushPromises()

    expect(send).toHaveBeenCalledWith({
      text: 'Итог не сходится с суммой строк',
      pageUrl: '/calculator/abc',
      pageTitle: 'Расчёт',
      viewport: `${window.innerWidth}×${window.innerHeight}`,
      screenshots: [shot],
    })
    expect(w.get('.mo-bd').text()).toContain('br-20260930-081502-a1b2c3 отправлен')

    await button(w, 'Готово').trigger('click')
    expect(bugReportOpen.value).toBe(false)
    await reopen()
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('')
    expect(w.findAll('.bug-shot')).toHaveLength(0)
  })

  it('Ctrl+Enter в поле — отправить', async () => {
    send.mockResolvedValue({ id: 'br-20260930-081502-a1b2c3', createdAt: '' })
    const w = await openDialog()
    await w.get('#bug-text').setValue('Ошибка')
    await w.get('#bug-text').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
  })

  // Закрыть окно, снять нужное место экрана и вернуться — обычный порядок.
  it('закрытое без отправки окно хранит черновик', async () => {
    const w = await openDialog()
    await w.get('#bug-text').setValue('Черновик')
    await button(w, 'Отмена').trigger('click')
    expect(bugReportOpen.value).toBe(false)
    await reopen()
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('Черновик')
  })

  it('отказ сервера — объяснением, текст остаётся', async () => {
    send.mockRejectedValue({ response: { data: { message: 'Слишком много отчётов подряд — следующий можно отправить через 12 мин' } } })
    const w = await openDialog()
    await w.get('#bug-text').setValue('Ошибка')
    await button(w, 'Отправить').trigger('click')
    await flushPromises()

    expect(w.get('.bug-err').text()).toContain('Слишком много отчётов подряд')
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('Ошибка')
  })

  // Выход из системы снимает окно: следующий сотрудник не увидит чужой текст.
  it('окно убрали (выход) — оно закрыто, черновик забыт', async () => {
    const w = await openDialog()
    await w.get('#bug-text').setValue('Чужой черновик')
    w.unmount()
    mounted = null
    expect(bugReportOpen.value).toBe(false)

    const again = await openDialog()
    expect((again.get('#bug-text').element as HTMLTextAreaElement).value).toBe('')
  })
})
