/**
 * ФИО сотрудника в документах.
 *
 * В учётной записи имя хранится целиком («Иванов Сергей Владимирович»), а
 * печатается в двух видах: у подписи — инициалы перед фамилией («С.В. Иванов»),
 * у исполнителя — фамилия перед инициалами («Иванов С.В.»). Так в эталоне
 * коммерческого предложения (`doc/Эталон_КП_разбор.md` §8).
 *
 * Имя из одного слова («Администратор») остаётся как есть: сокращать нечего.
 *
 * @module utils/person
 */

/** Слова имени без лишних пробелов. */
function parts(full: string): string[] {
  return full.trim().split(/\s+/).filter(Boolean)
}

/** Инициалы имени и отчества: «Сергей Владимирович» → «С.В.». */
function initials(rest: string[]): string {
  return rest
    .map((word) => `${word[0]?.toUpperCase() ?? ''}.`)
    .join('')
}

/**
 * Имя уже сокращено («Иванов С.В.», «С.В. Иванов») или это не ФИО, а подпись
 * вроде «Администратор» — такое не трогаем: перестановка сломала бы его.
 */
function asIs(words: string[]): boolean {
  return words.length < 2 || words.some((w) => w.includes('.'))
}

/** Фамилия и инициалы — блок исполнителя: «Иванов С.В.». */
export function shortName(full: string | null | undefined): string | null {
  const words = parts(full ?? '')
  if (words.length === 0) return null
  if (asIs(words)) return words.join(' ')
  return `${words[0]} ${initials(words.slice(1))}`
}

/** Инициалы и фамилия — подпись: «С.В. Иванов». */
export function signatureName(full: string | null | undefined): string | null {
  const words = parts(full ?? '')
  if (words.length === 0) return null
  if (asIs(words)) return words.join(' ')
  return `${initials(words.slice(1))} ${words[0]}`
}
