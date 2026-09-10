/**
 * Импорт прайса из консоли — тот же путь, что у кнопки «Импорт» на экране
 * прайса (utils/price-import.ts), без браузера и без входа в систему.
 *
 *   node dist/tools/import-prices.js <книга.xlsx> [--dry-run] [--sheet НН] [--label "НН от 10.09"]
 *
 * В контейнере: скопировать книгу внутрь (`docker compose cp`) и запустить
 * `docker compose exec backend node dist/tools/import-prices.js /tmp/книга.xlsx`.
 * С `--dry-run` только печатает, что изменится.
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { audit } from '../utils/audit'
import { parseNnSheet } from '../utils/nn-sheet'
import { applyImport, importSummary, loadExisting, planImport } from '../utils/price-import'
import { prisma } from '../utils/prisma'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const fmt = (n: number | null) => (n == null ? '—' : n.toLocaleString('ru-RU', { maximumFractionDigits: 2 }))

async function main() {
  const file = process.argv[2]
  if (!file || file.startsWith('--')) {
    console.error('Использование: import-prices <книга.xlsx> [--dry-run] [--sheet НН] [--label "подпись версии"]')
    process.exit(2)
  }
  const dryRun = process.argv.includes('--dry-run')
  const sheetName = arg('--sheet') ?? 'НН'

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.getWorksheet(sheetName)
  if (!ws) throw new Error(`Лист «${sheetName}» не найден. Листы книги: ${wb.worksheets.map((w) => w.name).join(', ')}`)

  const parsed = parseNnSheet(ws)
  const existing = await loadExisting(prisma)
  const plan = planImport(parsed, existing)

  let version: number | null = null
  if (!dryRun) {
    const base = file.split(/[\\/]/).pop()
    version = await applyImport(prisma, plan, existing, {
      userId: null,
      label: arg('--label'),
      note: `Импорт из консоли: «${base}», лист «${sheetName}»`,
    })
    await audit(null, 'prices.import', 'PriceListVersion', version != null ? String(version) : undefined, {
      file: base ?? file,
      sheet: sheetName,
      source: 'cli',
      created: plan.created.length,
      updated: plan.changed.length,
      touched: plan.touched,
      unchanged: plan.unchanged,
    })
  }

  const s = importSummary(plan, version, dryRun)
  console.log(dryRun ? 'ПРЕДПРОСМОТР — в базу ничего не записано' : `ИМПОРТ ПРИМЕНЁН · версия прайса ${version ?? 'не менялась'}`)
  console.log(`  колонки найдены: ${parsed.columns === 'header' ? 'по заголовкам' : 'по номерам листа мастер-шаблона'}`)
  console.log(`  новых позиций ${s.created}, цен изменится ${s.updated}, прочих правок ${s.touched}, без изменений ${s.unchanged}`)
  console.log(`  пустая цена в файле, оставлена цена базы: ${s.keptPrice}; нет в файле, остаются: ${s.missingInFile}`)
  console.log(`  исправлено наименований: ${s.nameFixes}; пропущено строк: ${s.skipped}`)
  for (const c of s.changes) console.log(`  цена · стр.${c.sheetRow} ${c.name} [${c.unit}]: ${fmt(c.oldPrice)} → ${fmt(c.newPrice)}`)
  for (const c of s.createdItems) console.log(`  новая · стр.${c.sheetRow} ${c.category} | ${c.name} [${c.unit}]: ${fmt(c.priceRub)}`)
  for (const d of s.duplicates) {
    const conflict = d.price !== d.firstPrice ? ` — ЦЕНЫ РАЗНЫЕ: ${fmt(d.firstPrice)} (взята) и ${fmt(d.price)}` : ''
    console.log(`  повтор · стр.${d.sheetRow} = стр.${d.firstRow}: ${d.key}${conflict}`)
  }
  for (const k of s.skippedRows) console.log(`  пропуск · стр.${k.sheetRow}: ${k.reason}`)
}

main()
  .catch((e) => {
    console.error('ОШИБКА:', e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
