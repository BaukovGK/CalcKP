// @vitest-environment jsdom
/**
 * Кнопка «Сообщить о проблеме» в оболочке экрана: подписана словами,
 * открывает общее окно и отмечается, чтобы запасная в углу не появлялась.
 */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import BugReportButton from './BugReportButton.vue'
import { bugReportOpen, closeBugReport, hasShellButton, useDialogPresence } from '@/composables/useBugReport'

/** Окно отчёта в приложении — без него кнопкам нечего открывать. */
const DialogPresence = defineComponent({
  setup() {
    useDialogPresence()
    return () => null
  },
})

let dialog: ReturnType<typeof mount> | null = null
function withDialog() {
  dialog = mount(DialogPresence)
}

afterEach(() => {
  dialog?.unmount()
  dialog = null
  closeBugReport()
})

describe('кнопка «Сообщить о проблеме»', () => {
  it('подписана словами — один знак «!» за неё не принимали', () => {
    withDialog()
    const w = mount(BugReportButton)
    expect(w.text()).toContain('Сообщить о проблеме')
    expect(w.get('button').attributes('aria-label')).toBe('Сообщить о проблеме')
    w.unmount()
  })

  it('открывает окно отчёта', async () => {
    withDialog()
    const w = mount(BugReportButton)
    expect(bugReportOpen.value).toBe(false)
    await w.get('button').trigger('click')
    expect(bugReportOpen.value).toBe(true)
    w.unmount()
  })

  it('в шапке рабочего экрана — рамкой, в подвале панели — во всю ширину', () => {
    withDialog()
    const top = mount(BugReportButton, { props: { compact: true } })
    const side = mount(BugReportButton)
    expect(top.get('button').classes()).toContain('bug-btn--compact')
    expect(side.get('button').classes()).not.toContain('bug-btn--compact')
    top.unmount()
    side.unmount()
  })

  // Пока кнопка на экране, запасной в углу не нужно — она закрывала бы содержимое.
  it('отмечается на экране, пока стоит, и снимается вместе с ним', () => {
    withDialog()
    expect(hasShellButton.value).toBe(false)
    const a = mount(BugReportButton)
    const b = mount(BugReportButton, { props: { compact: true } })
    expect(hasShellButton.value).toBe(true)
    a.unmount()
    expect(hasShellButton.value).toBe(true)
    b.unmount()
    expect(hasShellButton.value).toBe(false)
  })

  // Окно монтирует App.vue только вошедшему и не на демо-входе.
  it('окна отчёта нет — кнопки тоже нет', async () => {
    const w = mount(BugReportButton)
    expect(w.find('button').exists()).toBe(false)
    withDialog()
    await w.vm.$nextTick()
    expect(w.find('button').exists()).toBe(true)
    w.unmount()
  })
})
