/**
 * Подпись данных для сравнения «изменилось ли» — у автосохранения опросного
 * листа и экрана расчёта одна.
 *
 * @module utils/stable-stringify
 */

/**
 * JSON с упорядоченными ключами — подпись нагрузки для сравнения.
 *
 * Обычный JSON.stringify зависит от порядка ключей, а PostgreSQL хранит jsonb
 * со своим порядком: сохранённое и то же самое, собранное формой, давали бы
 * разные строки, и лист сохранялся бы без единой правки.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
