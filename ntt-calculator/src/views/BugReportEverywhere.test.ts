/**
 * «Сообщить о проблеме» — в оболочке каждого экрана, кроме входа.
 *
 * Кнопка ставится в разметку экрана рядом с переключателем темы, и новый
 * экран без неё остался бы только с запасной кнопкой в углу — той, что
 * закрывала содержимое. Тест держит правило: экран либо ставит кнопку, либо
 * значится ниже с причиной.
 */
import { describe, expect, it } from 'vitest'

const views = import.meta.glob('./*.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const shell = import.meta.glob('../components/survey/SurveyShell.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Экраны без своей кнопки — и почему. */
const WITHOUT_BUTTON: Readonly<Record<string, string>> = {
  './LoginView.vue': 'вход — отчёт отправляет только вошедший сотрудник',
  './PasswordView.vue': 'обязательная смена пароля — карточка без оболочки, кнопка запасная, в углу',
  './SurveyView.vue': 'обёртка опросного листа: кнопка — в листе нужного изделия, у загрузки и ошибки — запасная',
  './SurveyEmkView.vue': 'лист ёмкости стоит в SurveyShell — кнопка в его шапке',
  './SurveyKolView.vue': 'лист колодца стоит в SurveyShell — кнопка в его шапке',
}

const hasButton = (src: string) => /<BugReportButton[\s/>]/.test(src)

describe('кнопка «Сообщить о проблеме» на каждом экране', () => {
  it('экраны ставят её в свою оболочку', () => {
    const missing = Object.entries(views)
      .filter(([path, src]) => !(path in WITHOUT_BUTTON) && !hasButton(src))
      .map(([path]) => path)
    expect(missing).toEqual([])
  })

  it('листы ёмкости и колодца — через SurveyShell, а в его шапке кнопка есть', () => {
    expect(views['./SurveyEmkView.vue']).toMatch(/<SurveyShell[\s>]/)
    expect(views['./SurveyKolView.vue']).toMatch(/<SurveyShell[\s>]/)
    expect(hasButton(Object.values(shell)[0]!)).toBe(true)
  })

  it('на экране входа её нет', () => {
    expect(hasButton(views['./LoginView.vue']!)).toBe(false)
  })

  it('список исключений не устарел: каждый из них — существующий экран', () => {
    for (const path of Object.keys(WITHOUT_BUTTON)) expect(views[path], path).toBeDefined()
  })
})
