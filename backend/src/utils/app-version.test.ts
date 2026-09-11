/**
 * Версия приложения в /api/health (План_устранения 3.8): контейнер запускает
 * `node dist/app.js`, без npm, — версия берётся из package.json, коммит — из
 * аргумента сборки APP_BUILD.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAppVersion } from './app-version'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { version: string }

describe('версия приложения', () => {
  it('без npm — из package.json бэкенда', () => {
    expect(readAppVersion({})).toEqual({ version: pkg.version, build: null })
  })

  it('коммит сборки — из APP_BUILD, пустой — как не заданный', () => {
    expect(readAppVersion({ APP_BUILD: ' de8f59b\n' }).build).toBe('de8f59b')
    expect(readAppVersion({ APP_BUILD: '' }).build).toBeNull()
  })

  it('нет package.json — версия из npm или неизвестна, но не падает', () => {
    expect(readAppVersion({ npm_package_version: '9.9.9' }, '/нет/такого/package.json').version).toBe('9.9.9')
    expect(readAppVersion({}, '/нет/такого/package.json')).toEqual({ version: null, build: null })
  })
})
