// @vitest-environment jsdom
/**
 * «Сообщить о проблеме» — на каждом экране и вкладке после входа, кроме
 * экрана входа. Кнопка стоит в оболочке экрана; где её нет — запасная в углу.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { route } = vi.hoisted(() => ({ route: { name: 'dashboard' as string | undefined } }))
const currentRoute = reactive(route)
vi.mock('vue-router', () => ({ useRoute: () => currentRoute }))

import App from './App.vue'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import { SESSION_KEYS } from '@/api/client'

function mountApp() {
  return mount(App, {
    global: {
      stubs: {
        RouterView: true,
        HintLayer: true,
        BugReportDialog: { template: '<div class="bug-dialog" />' },
        BugReportFab: { template: '<button class="bug-fab" />' },
      },
    },
  })
}

function signIn(token = 'access-token') {
  localStorage.setItem(SESSION_KEYS.user, JSON.stringify({ id: 'u1', name: 'Инженер', email: 'e@ntt.local', role: 'ENGINEER' }))
  localStorage.setItem(SESSION_KEYS.access, token)
}

beforeEach(() => {
  localStorage.clear()
  currentRoute.name = 'dashboard'
  setActivePinia(createPinia())
})

describe('«Сообщить о проблеме» в приложении', () => {
  it('после входа окно отчёта доступно на любом экране', () => {
    signIn()
    for (const name of ['dashboard', 'project', 'survey', 'calculator', 'kp-issue', 'purchase-request', 'prices', 'templates', 'settings', 'admin', 'password']) {
      currentRoute.name = name
      expect(mountApp().find('.bug-dialog').exists(), name).toBe(true)
    }
  })

  // Смена пароля, загрузка и ошибка опросного листа — оболочки нет, кнопка в углу.
  it('экран без своей кнопки получает запасную в углу', () => {
    signIn()
    currentRoute.name = 'password'
    expect(mountApp().find('.bug-fab').exists()).toBe(true)
  })

  // Плавающая кнопка закрывала содержимое — где кнопка в оболочке, её нет.
  it('кнопка в оболочке экрана — запасной нет', async () => {
    signIn()
    const app = mountApp()
    const shell = mount(BugReportButton)
    await nextTick()
    expect(app.find('.bug-fab').exists()).toBe(false)
    shell.unmount()
    await nextTick()
    expect(app.find('.bug-fab').exists()).toBe(true)
  })

  it('на экране входа ни кнопки, ни окна', () => {
    signIn()
    currentRoute.name = 'login'
    const app = mountApp()
    expect(app.find('.bug-fab').exists()).toBe(false)
    expect(app.find('.bug-dialog').exists()).toBe(false)
  })

  it('без входа — нигде', () => {
    for (const name of ['login', 'dashboard']) {
      currentRoute.name = name
      const app = mountApp()
      expect(app.find('.bug-fab').exists(), name).toBe(false)
      expect(app.find('.bug-dialog').exists(), name).toBe(false)
    }
  })

  it('демо-вход работает без сервера — отправлять некуда', () => {
    signIn('demo-token')
    const app = mountApp()
    expect(app.find('.bug-fab').exists()).toBe(false)
    expect(app.find('.bug-dialog').exists()).toBe(false)
  })
})
