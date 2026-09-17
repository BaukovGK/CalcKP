/**
 * Вкладка, открытая до выкладки, теряет экраны — и это чинится перезагрузкой.
 *
 * Экраны грузятся лениво, отдельными бандлами с хешем в имени
 * (`PurchaseRequestView-C3vdNBfL.js`). Выкладка пересобирает фронт: имена
 * меняются, старых файлов на сервере больше нет, а `index.html` отдаётся с
 * `no-cache` — то есть новая вкладка всё получит верно, а открытая до выкладки
 * продолжает помнить старые имена.
 *
 * Дальше это выглядело как сломанная кнопка: переход на ещё не загруженный
 * экран — «Экспорт», «Сформировать КП», «Шаблоны» — просил у сервера
 * исчезнувший бандл, получал 404, `router.push` отклонялся, и НИЧЕГО не
 * происходило. Ни ошибки, ни подсказки: пользователь жмёт и жмёт.
 *
 * Лечение — перезагрузить страницу по тому же адресу: `index.html` придёт
 * свежий, за ним новые бандлы, и пользователь окажется там, куда шёл. Чтобы
 * это не превратилось в вечную перезагрузку, если бандла нет по другой причине
 * (сервер лежит, адрес битый), повтор по тому же адресу в окне `RELOAD_WINDOW_MS`
 * не делается.
 *
 * @module router/stale-chunk
 */

/** Окно, в котором повторная перезагрузка того же адреса считается зацикливанием. */
export const RELOAD_WINDOW_MS = 20_000

/** Ключ отметки о перезагрузке. Сеансовый: другой вкладке он не мешает. */
export const RELOAD_KEY = 'ntt_stale_chunk_reload'

/**
 * Это сорвавшаяся загрузка бандла, а не ошибка самого экрана?
 *
 * Текст сообщения у браузеров разный, общего кода ошибки нет — сверяемся по
 * приметам всех троих: Chrome, Firefox, Safari.
 */
export function isStaleChunkError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /dynamically imported module.*(404|not found)/i.test(message)
  )
}

/** Хранилище отметки — `sessionStorage` браузера либо любая его замена в тестах. */
export interface ReloadMemory {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * Перезагружать ли страницу ради этого адреса.
 *
 * Отметка запоминает адрес и время: тот же адрес в пределах окна — значит
 * перезагрузка не помогла, и повторять её бессмысленно.
 */
export function shouldReload(path: string, now: number, memory: ReloadMemory | null): boolean {
  if (!memory) return true
  try {
    const raw = memory.getItem(RELOAD_KEY)
    const [lastPath, lastAt] = (raw ?? '').split('|')
    if (lastPath === path && Number(lastAt) > now - RELOAD_WINDOW_MS) return false
    memory.setItem(RELOAD_KEY, `${path}|${now}`)
    return true
  } catch {
    // Приватный режим или запрет на хранилище: перезагрузить важнее, чем
    // подстраховаться от повтора.
    return true
  }
}
