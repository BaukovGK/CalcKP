/**
 * Проверка подключения к PostgreSQL по DATABASE_URL из backend/.env.
 *
 * Используется verify.ps1 до тяжёлых шагов: упасть здесь дешевле, чем после
 * сборки фронта. Отдельным файлом, а не `node -e`: inline-JS в PowerShell
 * разбирается ненадёжно (кавычки, регулярки, here-string).
 *
 * Печатает «пользователь@база» и выходит с 0, либо причину и 1.
 */
const fs = require('node:fs')
const path = require('node:path')
const { Pool } = require('pg')

const envPath = path.resolve(__dirname, '../.env')

let url
try {
  const text = fs
    .readFileSync(envPath, 'utf8')
    // Снимаем BOM: редакторы Windows (и Set-Content -Encoding utf8 в
    // PowerShell 5.1) пишут UTF-8 с BOM, и первая строка превращается в
    // «﻿DATABASE_URL=» — сравнение по префиксу молча промахивается, а
    // сообщение выходит вводящим в заблуждение («переменной нет», хотя она есть).
    .replace(/^﻿/, '')

  const line = text.split(/\r?\n/).find((l) => l.trimStart().startsWith('DATABASE_URL='))
  if (!line) {
    console.error('DATABASE_URL отсутствует в backend/.env')
    process.exit(1)
  }
  url = line.trim().slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '')
  if (!url) {
    console.error('DATABASE_URL в backend/.env пуст')
    process.exit(1)
  }
} catch (e) {
  console.error(`Не удалось прочитать ${envPath}: ${e.message}`)
  process.exit(1)
}

const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 5000 })
pool
  .query('select current_user, current_database()')
  .then((r) => {
    process.stdout.write(`${r.rows[0].current_user}@${r.rows[0].current_database}`)
    return pool.end()
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
