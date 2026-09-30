// @vitest-environment jsdom
/**
 * «Сообщить об ошибке» — окно на каждом экране: пояснение, текст, скриншоты
 * (файлом, из буфера, перетаскиванием) и «Отправить». Экран и размер окна
 * прикладываются сами.
 */
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { send, route } = vi.hoisted(() => ({
  send: vi.fn(),
  route: { fullPath: '/calculator/abc', name: 'calculator' as string },
}))
const currentRoute = reactive(route)

vi.mock('vue-router', () => ({ useRoute: () => currentRoute }))
vi.mock('@/api/bugReports', () => ({ bugReportsApi: { send: (r: unknown) => send(r) } }))

import BugReportWidget from './BugReportWidget.vue'

const png = (name = 'shot.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })

async function openWidget(): Promise<VueWrapper> {
  const w = mount(BugReportWidget, { attachTo: document.body })
  await w.get('.bug-fab').trigger('click')
  return w
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
  document.body.innerHTML = ''
})

describe('окно «Сообщить об ошибке»', () => {
  it('кнопка открывает окно с пояснением, полем и «Отправить»', async () => {
    const w = await openWidget()

    expect(w.find('.mo').exists()).toBe(true)
    expect(w.get('.bug-lead').text()).toContain('Опишите, что вы делали')
    expect(w.find('#bug-text').exists()).toBe(true)
    expect(button(w, 'Отправить').exists()).toBe(true)
    // Пока окно открыто, кнопку в углу не видно — она не мешает окну.
    expect(w.find('.bug-fab').exists()).toBe(false)
  })

  it('экран и размер окна прикладываются сами — и видно, что именно', async () => {
    const w = await openWidget()
    expect(w.get('.bug-ctx').text()).toContain('«Расчёт» (/calculator/abc)')
    expect(w.get('.bug-ctx').text()).toContain(`${window.innerWidth}×${window.innerHeight}`)
  })

  it('без текста отправить нельзя', async () => {
    const w = await openWidget()
    expect(button(w, 'Отправить').attributes('disabled')).toBeDefined()
    await w.get('#bug-text').setValue('   ')
    expect(button(w, 'Отправить').attributes('disabled')).toBeDefined()
    await w.get('#bug-text').setValue('Не сохраняется лист')
    expect(button(w, 'Отправить').attributes('disabled')).toBeUndefined()
  })

  it('скриншот файлом — превью с именем и размером, убирается крестиком', async () => {
    const w = await openWidget()
    await attach(w, [png('Снимок.png')])

    expect(w.findAll('.bug-shot')).toHaveLength(1)
    expect(w.get('.bug-shot figcaption').text()).toContain('Снимок.png')
    await w.get('.bug-shot-x').trigger('click')
    expect(w.findAll('.bug-shot')).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('не картинка — не прикрепляется, причина видна', async () => {
    const w = await openWidget()
    await attach(w, [new File(['x'], 'смета.xlsx', { type: 'application/vnd.ms-excel' })])

    expect(w.findAll('.bug-shot')).toHaveLength(0)
    expect(w.get('.bug-problems').text()).toContain('«смета.xlsx» — не картинка')
  })

  it('картинка из буфера вставляется и получает своё имя', async () => {
    const w = await openWidget()
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
    const w = await openWidget()
    await w.get('.mo').trigger('drop', { dataTransfer: { files: [png('drop.png')] } })
    await flushPromises()
    expect(w.get('.bug-shot figcaption').text()).toContain('drop.png')
  })

  it('«Отправить» уносит текст, экран и скриншоты; черновик очищается', async () => {
    send.mockResolvedValue({ id: 'br-20260930-081502-a1b2c3', createdAt: '2026-09-30T08:15:02Z' })
    const w = await openWidget()
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
    await w.get('.bug-fab').trigger('click')
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('')
    expect(w.findAll('.bug-shot')).toHaveLength(0)
  })

  it('Ctrl+Enter в поле — отправить', async () => {
    send.mockResolvedValue({ id: 'br-20260930-081502-a1b2c3', createdAt: '' })
    const w = await openWidget()
    await w.get('#bug-text').setValue('Ошибка')
    await w.get('#bug-text').trigger('keydown', { key: 'Enter', ctrlKey: true })
    await flushPromises()
    expect(send).toHaveBeenCalledTimes(1)
  })

  // Закрыть окно, снять нужное место экрана и вернуться — обычный порядок.
  it('закрытое без отправки окно хранит черновик', async () => {
    const w = await openWidget()
    await w.get('#bug-text').setValue('Черновик')
    await button(w, 'Отмена').trigger('click')
    await w.get('.bug-fab').trigger('click')
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('Черновик')
  })

  it('отказ сервера — объяснением, текст остаётся', async () => {
    send.mockRejectedValue({ response: { data: { message: 'Слишком много отчётов подряд — следующий можно отправить через 12 мин' } } })
    const w = await openWidget()
    await w.get('#bug-text').setValue('Ошибка')
    await button(w, 'Отправить').trigger('click')
    await flushPromises()

    expect(w.get('.bug-err').text()).toContain('Слишком много отчётов подряд')
    expect((w.get('#bug-text').element as HTMLTextAreaElement).value).toBe('Ошибка')
  })

  it('в опросном листе кнопка поднята над «Создать расчёт»', async () => {
    currentRoute.name = 'survey'
    const w = mount(BugReportWidget, { attachTo: document.body })
    expect(w.get('.bug-fab').classes()).toContain('bug-fab--raised')
  })
})
