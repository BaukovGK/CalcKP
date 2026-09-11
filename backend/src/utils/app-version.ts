import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Версия приложения для `/api/health` (План_устранения 3.8).
 *
 * Прежде она бралась из `npm_package_version`, а эту переменную задаёт только
 * запуск через npm: контейнер стартует `node dist/app.js`
 * (docker-entrypoint.sh), и health отвечал без версии. Теперь — из
 * package.json: он лежит на уровень выше и сборки (`dist/`), и исходников
 * (`src/`).
 *
 * `build` — коммит, из которого собран образ: аргумент сборки `APP_BUILD`
 * (docker-compose.yml, деплой в ci-cd.yml). Номер в package.json с каждым
 * изменением не растёт, коммит — да: по нему видно, что развёрнуто. Не
 * задан — `null`.
 *
 * @module utils/app-version
 */

export interface AppVersion {
  version: string | null
  build: string | null
}

/** package.json бэкенда: `utils/` → `src/` или `dist/` → корень пакета. */
const PACKAGE_JSON = resolve(__dirname, '..', '..', 'package.json')

export function readAppVersion(env: NodeJS.ProcessEnv = process.env, packageJson = PACKAGE_JSON): AppVersion {
  let version: string | null = null
  try {
    const pkg = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown }
    if (typeof pkg.version === 'string' && pkg.version) version = pkg.version
  } catch {
    // Нет файла — версия неизвестна; health от этого не должен падать.
  }
  const build = env.APP_BUILD?.trim()
  return { version: version ?? env.npm_package_version ?? null, build: build || null }
}
