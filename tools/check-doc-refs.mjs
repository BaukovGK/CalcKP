#!/usr/bin/env node
/**
 * Документы ссылаются на код по имени, а не по номеру строки
 * (doc/План_устранения.md, 4.2).
 *
 * Номера строк гниют молча: к 11.09.2026 из 77 ссылок «файл:строка», которые
 * можно было проверить, 45 указывали туда, где названного рядом символа уже
 * не было. Проверка падает на любой ссылке с номером строки — «файл.ts:123»,
 * «`:123`», «там же :123» — в README.md, РАЗВЁРТЫВАНИЕ.md, doc/*.md и
 * ntt-calculator/doc/*.md. Ссылаться нужно на файл и имя: функцию, константу,
 * маршрут, шаг CI.
 *
 * Не проверяются первоисточник doc/Реверс_калькуляторов.md и исторические
 * doc/План_реализации.md и doc/Промт_ОЛ_и_редактор.md — их не правят.
 *
 * Запуск из корня репозитория: node tools/check-doc-refs.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const EXCLUDED = new Set([
  'doc/Реверс_калькуляторов.md',
  'doc/План_реализации.md',
  'doc/Промт_ОЛ_и_редактор.md',
])

/** «Express :3000» — порт, а не строка: у короткой ссылки его не спутать иначе. */
const PORTS = new Set(['80', '443', '3000', '5173', '5432', '8080'])

const EXT = 'ts|tsx|vue|js|cjs|mjs|json|sh|ps1|yml|yaml|prisma|conf|css|html|sql|py|md'

const RULES = [
  { re: new RegExp(`[\\p{L}\\p{N}_./…-]+\\.(?:${EXT}):\\d+(?:[-–,]\\d+)*`, 'gu'), what: 'файл:строка' },
  { re: /`:\d+(?:[-–,]\d+)*`?/gu, what: 'номер строки в кавычках' },
  // Продолжение прежней ссылки: «и :418», «— :341», «(там же :197)», «(:353, :355)».
  { re: /(?<=^|[\s(,;—])(?:там же\s+)?:(\d{1,4})(?:[-–,]\d+)*(?=[\s),.;]|$)/gmu, what: 'номер строки', skipPorts: true },
]

function markdownIn(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `${dir}/${name}`)
}

const files = ['README.md', 'РАЗВЁРТЫВАНИЕ.md', ...markdownIn('doc'), ...markdownIn('ntt-calculator/doc')]
  .filter((file) => !EXCLUDED.has(file))

const problems = []
for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.re)) {
        if (rule.skipPorts && PORTS.has(m[1])) continue
        problems.push(`${file}:${i + 1}: ${rule.what} — «${m[0].trim()}»`)
      }
    }
  })
}

if (problems.length) {
  console.error(problems.join('\n'))
  console.error(
    `\nНомера строк в документах (${problems.length}): ссылайтесь на файл и имя — ` +
      '«`engines/row.ts`, `resolveQty`», а не «`engines/row.ts:34`» (doc/План_устранения.md, 4.2).',
  )
  process.exit(1)
}
console.log(`Ссылки на код в ${files.length} документах — без номеров строк.`)
