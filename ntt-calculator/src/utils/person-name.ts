/**
 * ФИО в документах: «Иванов Сергей Владимирович» → «Иванов С.В.».
 *
 * Правило то же, что на сервере (`backend/src/utils/person.ts`, `shortName`):
 * документ собирает бэкенд, а экран настроек показывает сотруднику, как его
 * имя будет напечатано. Общего пакета у фронта и бэка нет, поэтому правило
 * записано дважды — как у правила SN.
 *
 * @module utils/person-name
 */

/** Уже сокращённое имя («Иванов С.В.») и не-ФИО («Администратор») не трогаем. */
function asIs(words: string[]): boolean {
  return words.length < 2 || words.some((w) => w.includes('.'))
}

/** Фамилия и инициалы; пустое имя — `null`. */
export function shortName(full: string | null | undefined): string | null {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  if (asIs(words)) return words.join(' ')
  return `${words[0]} ${words.slice(1).map((w) => `${w[0]?.toUpperCase() ?? ''}.`).join('')}`
}
