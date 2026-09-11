// @vitest-environment jsdom
/**
 * Автосохранение экрана расчёта (План_устранения 3.2): правки не живут в
 * памяти до кнопки — пауза, одна запись, статус; закрыть вкладку с
 * несохранённым браузер не даст без вопроса.
 */
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { TREE_AUTOSAVE_DELAY_MS, useTreeAutosave, type AutosaveStore } from './useTreeAutosave'

function fakeStore() {
  const s: AutosaveStore & { tree: { qty: number } } = reactive({
    tree: { qty: 1 },
    markup: 0.43,
    tirage: 1,
    savedSignature: null as string | null,
    stateSignature: () => JSON.stringify({ tree: s.tree, markup: s.markup, tirage: s.tirage }),
    save: vi.fn(async () => {
      s.savedSignature = s.stateSignature()
    }),
  })
  s.savedSignature = s.stateSignature()
  return s
}

function mountWith(store: AutosaveStore, enabled = () => true) {
  let api!: ReturnType<typeof useTreeAutosave>
  const Host = defineComponent({
    setup() {
      api = useTreeAutosave(store, { enabled })
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  mounted.push(wrapper)
  return { wrapper, api }
}

/** Смонтированные хозяева: их слушатели beforeunload снимаются после теста. */
const mounted: VueWrapper[] = []

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  vi.useRealTimers()
})

describe('автосохранение экрана расчёта', () => {
  it('правка — пауза — одна запись; статус «изменения» → «сохранено»', async () => {
    const store = fakeStore()
    const { api } = mountWith(store)

    store.tree.qty = 2
    await nextTick()
    store.tree.qty = 3
    await nextTick()
    expect(api.status.value).toBe('pending')
    expect(store.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)
    expect(store.save).toHaveBeenCalledTimes(1)
    expect(api.status.value).toBe('saved')
    expect(api.dirty()).toBe(false)
  })

  it('вернули как было — записывать нечего', async () => {
    const store = fakeStore()
    const { api } = mountWith(store)

    store.markup = 0.5
    await nextTick()
    store.markup = 0.43
    await nextTick()
    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)

    expect(store.save).not.toHaveBeenCalled()
    expect(api.status.value).toBe('idle')
  })

  it('только просмотр — не пишет', async () => {
    const store = fakeStore()
    mountWith(store, () => false)

    store.tree.qty = 2
    await nextTick()
    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)

    expect(store.save).not.toHaveBeenCalled()
  })

  it('правка, пока запись в пути, — ещё одна запись после неё', async () => {
    const store = fakeStore()
    let release!: () => void
    ;(store.save as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      const sent = store.stateSignature()
      return new Promise<void>((resolve) => {
        release = () => {
          store.savedSignature = sent
          resolve()
        }
      })
    })
    const { api } = mountWith(store)

    store.tree.qty = 2
    await nextTick()
    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)
    expect(api.status.value).toBe('saving')
    store.tree.qty = 3
    await nextTick()
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(api.status.value).toBe('pending')

    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)
    expect(store.save).toHaveBeenCalledTimes(2)
    expect(api.dirty()).toBe(false)
  })

  it('запись не удалась — статус и текст ошибки; «Сохранить» получает ошибку', async () => {
    const store = fakeStore()
    ;(store.save as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('сервер недоступен'))
    const { api } = mountWith(store)

    store.tree.qty = 2
    await nextTick()
    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)
    expect(api.status.value).toBe('error')
    expect(api.error.value).toBe('сервер недоступен')

    await expect(api.flush()).rejects.toThrow('сервер недоступен')
  })

  it('расчёт загрузился пересобранным — он ещё не сохранён, запись без правок', async () => {
    const store = fakeStore()
    const state = reactive({ loading: true })
    mountWith(store, () => !state.loading)

    store.savedSignature = null
    state.loading = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(TREE_AUTOSAVE_DELAY_MS + 10)

    expect(store.save).toHaveBeenCalledTimes(1)
  })

  it('закрыть вкладку с несохранённым — браузер спросит; всё сохранено — нет', async () => {
    const store = fakeStore()
    mountWith(store)
    const ask = () => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    }

    expect(ask()).toBe(false)
    store.tree.qty = 2
    await nextTick()
    expect(ask()).toBe(true)
  })
})
