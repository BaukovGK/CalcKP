/**
 * Кнопка, переставшая работать после выкладки.
 *
 * Экраны грузятся отдельными бандлами с хешем в имени; выкладка меняет имена,
 * а вкладка, открытая до неё, помнит старые. Переход на такой экран падал
 * молча — ни ошибки, ни подсказки. Тесты держат две вещи: сорвавшуюся загрузку
 * бандла отличаем от обычной ошибки экрана, и перезагрузку по одному адресу не
 * повторяем, иначе страница зациклится.
 */
import { describe, expect, it } from 'vitest'
import { RELOAD_WINDOW_MS, isStaleChunkError, shouldReload, type ReloadMemory } from './stale-chunk'

/** Хранилище в памяти — вместо sessionStorage браузера. */
function memory(initial: Record<string, string> = {}): ReloadMemory & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v },
  }
}

describe('сорвавшаяся загрузка экрана', () => {
  it('узнаётся по сообщению любого из браузеров', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true)
  })

  it('обычная ошибка экрана перезагрузкой не лечится', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isStaleChunkError(new Error('Network Error'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
  })
})

describe('перезагрузка на нужный адрес', () => {
  it('первый раз — перезагружаем и запоминаем адрес', () => {
    const m = memory()

    expect(shouldReload('/calculator/e1/purchase', 1_000, m)).toBe(true)
    expect(m.data['ntt_stale_chunk_reload']).toBe('/calculator/e1/purchase|1000')
  })

  it('тот же адрес сразу следом — значит не помогло, второй раз не идём', () => {
    const m = memory()
    shouldReload('/calculator/e1/purchase', 1_000, m)

    expect(shouldReload('/calculator/e1/purchase', 1_000 + RELOAD_WINDOW_MS / 2, m)).toBe(false)
  })

  it('другой адрес и тот же адрес спустя время — перезагружаем', () => {
    const m = memory()
    shouldReload('/calculator/e1/purchase', 1_000, m)

    expect(shouldReload('/calculator/e1/kp', 1_500, m)).toBe(true)
    expect(shouldReload('/calculator/e1/purchase', 1_000 + RELOAD_WINDOW_MS + 1, m)).toBe(true)
  })

  it('без хранилища и при запрете на него перезагружаем всё равно', () => {
    expect(shouldReload('/prices', 1_000, null)).toBe(true)

    const blocked: ReloadMemory = {
      getItem: () => { throw new Error('доступ к хранилищу запрещён') },
      setItem: () => { throw new Error('доступ к хранилищу запрещён') },
    }
    expect(shouldReload('/prices', 1_000, blocked)).toBe(true)
  })
})
