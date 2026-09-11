// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'

const { post } = vi.hoisted(() => ({ post: vi.fn() }))

// Окно ходит на сервер через стор авторизации, а тот — через общий клиент.
vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return { ...actual, api: { post, get: vi.fn(), delete: vi.fn() } }
})

import ChangePasswordModal from './ChangePasswordModal.vue'

/** Ошибка клиента с ответом сервера — как её бросает axios. */
function httpError(status: number, data: unknown) {
  const config = { headers: {} } as InternalAxiosRequestConfig
  const response = { status, statusText: String(status), data, headers: {}, config } as AxiosResponse
  return new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, null, response)
}

async function fill(w: VueWrapper, current: string, next: string, repeat: string) {
  await w.get('#pw-current').setValue(current)
  await w.get('#pw-next').setValue(next)
  await w.get('#pw-repeat').setValue(repeat)
}

async function submit(w: VueWrapper) {
  await w.findAll('button').find((b) => b.text() === 'Сменить пароль')!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  post.mockReset()
})

// План_устранения, 0.5: смены пароля в интерфейсе не было — только запрос к API.
describe('окно смены пароля', () => {
  it('верная форма — запрос на сервер, окно закрывается', async () => {
    post.mockResolvedValue({ status: 204 })
    const w = mount(ChangePasswordModal, { props: { show: true } })

    await fill(w, 'старый-пароль', 'новый-пароль', 'новый-пароль')
    await submit(w)

    expect(post).toHaveBeenCalledWith('/auth/password', { currentPassword: 'старый-пароль', newPassword: 'новый-пароль' })
    expect(w.emitted('close')).toHaveLength(1)
  })

  it('повтор не совпал — запроса нет, ошибка на форме', async () => {
    const w = mount(ChangePasswordModal, { props: { show: true } })

    await fill(w, 'старый-пароль', 'новый-пароль', 'новый-парол')
    await submit(w)

    expect(post).not.toHaveBeenCalled()
    expect(w.get('[role="alert"]').text()).toBe('Новый пароль и повтор не совпадают')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('сервер отверг текущий пароль — понятный текст, окно открыто', async () => {
    post.mockRejectedValue(httpError(422, { message: 'Текущий пароль неверен', code: 'WRONG_PASSWORD' }))
    const w = mount(ChangePasswordModal, { props: { show: true } })

    await fill(w, 'не-тот-пароль', 'новый-пароль', 'новый-пароль')
    await submit(w)

    expect(w.get('[role="alert"]').text()).toBe('Текущий пароль неверен')
    expect(w.emitted('close')).toBeUndefined()
  })

  it('«Отмена» закрывает окно и забывает введённое', async () => {
    const w = mount(ChangePasswordModal, { props: { show: true } })
    await fill(w, 'старый-пароль', 'новый-пароль', 'новый-пароль')

    await w.findAll('button').find((b) => b.text() === 'Отмена')!.trigger('click')

    expect(w.emitted('close')).toHaveLength(1)
    expect((w.get('#pw-current').element as HTMLInputElement).value).toBe('')
  })
})
