/**
 * Извлечение справочников из мастер-шаблона «Шаблон 3.0.xlsx» в JSON-сиды.
 *
 * Инструмент постоянный, не одноразовый: справочники завода обновляются
 * (прайс НН версионируется, таблица весов дополняется), и повторяемость
 * важнее разовой выгрузки. Формулы Excel здесь НЕ вычисляются — берутся
 * закешированные результаты, поэтому книга должна быть сохранена Excel'ем
 * с пересчитанными формулами.
 *
 * Запуск:  npm run refs:extract
 * Выход:   prisma/seed-data/*.json
 *
 * Источник: doc/Реверс_калькуляторов.md §9, ТЗ §3 (модель PriceItem).
 */
import ExcelJS from 'exceljs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Бэкенд собирается в CommonJS (tsconfig module=commonjs), поэтому __dirname,
// а не import.meta.url.
const WORKBOOK = resolve(__dirname, '../../ntt-calculator/doc/Шаблон 3.0.xlsx')
const OUT_DIR = resolve(__dirname, '../prisma/seed-data')

// ─── Чтение ячеек ────────────────────────────────────────────────────────────
// ExcelJS отдаёт формульные ячейки объектом {formula, result}; нас интересует
// только закешированный result.

type Cell = ExcelJS.Cell

function raw(cell: Cell): unknown {
  const v = cell?.value
  if (v == null) return null
  if (typeof v === 'object') {
    if ('result' in v) return (v as { result: unknown }).result
    if ('richText' in v) return (v as ExcelJS.RichText[] & { richText: { text: string }[] }).richText.map((t) => t.text).join('')
    if ('text' in v) return (v as { text: string }).text
    return null
  }
  return v
}

function str(cell: Cell): string {
  const v = raw(cell)
  return v == null ? '' : String(v).trim()
}

function num(cell: Cell): number | null {
  const v = raw(cell)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    // В книге встречаются числа строкой с запятой-разделителем («0,193 »).
    const parsed = Number(v.replace(/\s/g, '').replace(',', '.'))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

// ─── Прайс НН ────────────────────────────────────────────────────────────────
// Колонки (проверено по шапке листа): B=Группа, D=Номенклатура, F=ЕИ,
// G=Цена без скидки, H=Валюта, I=Скидка %, J=Цена руб (её тянет VLOOKUP),
// K=Комментарий. Колонки «Поставщик» в НН нет — при импорте не заполняется.

export interface PriceSeed {
  category: string
  name: string
  unit: string
  priceBaseRub: number | null
  discountPct: number | null
  currency: string
  priceRub: number | null
  comment: string | null
}

function extractPrices(ws: ExcelJS.Worksheet): PriceSeed[] {
  const out: PriceSeed[] = []
  const seen = new Set<string>()
  let skipped = 0
  let dupes = 0

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const category = str(row.getCell(2))
    const name = str(row.getCell(4))
    const unit = str(row.getCell(6))

    // Ключ прайса — тройка (категория, наименование, ЕИ): VLOOKUP(C&D&K,...).
    if (!category || !name || !unit) {
      skipped++
      continue
    }

    // Символ «~» запрещён в наименованиях (наследие VLOOKUP, ТЗ §9.8).
    if (name.includes('~')) {
      console.warn(`  ⚠ НН строка ${r}: «~» в наименовании — пропущена: ${name}`)
      skipped++
      continue
    }

    const key = `${category}:${name}:${unit}`
    if (seen.has(key)) {
      dupes++
      continue
    }
    seen.add(key)

    out.push({
      category,
      name,
      unit,
      priceBaseRub: num(row.getCell(7)),
      discountPct: num(row.getCell(9)),
      currency: str(row.getCell(8)) || 'руб',
      priceRub: num(row.getCell(10)),
      comment: str(row.getCell(11)) || null,
    })
  }

  console.log(`  прайс: ${out.length} позиций, пропущено ${skipped}, дублей ключа ${dupes}`)
  return out
}

// ─── Веса труб ───────────────────────────────────────────────────────────────
// GRP: B=DN, C=SN, D=PN, F=толщина стенки, G=вес кг/пм.
// ПЭ:  S=DN, T=наименование, U=DNнар, V=толщина, W=вес кг/м.

export interface PipeWeightSeed {
  dn: number
  pn: number
  sn: number
  wallMm: number | null
  kgPerM: number
}

/// Ключ ПЭ-трубы — наружный диаметр `odMm`, а не `dn`: колонка «DN» листа
/// не уникальна (DN 125 указан и для ⌀125, и для ⌀140) и нерегулярна.
export interface PePipeSeed {
  dn: number
  name: string
  odMm: number
  wallMm: string | null
  kgPerM: number
}

function extractPipeWeights(ws: ExcelJS.Worksheet): { grp: PipeWeightSeed[]; pe: PePipeSeed[] } {
  const grp: PipeWeightSeed[] = []
  const pe: PePipeSeed[] = []

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)

    const dn = num(row.getCell(2))
    const sn = num(row.getCell(3))
    const pn = num(row.getCell(4))
    const kgPerM = num(row.getCell(7))
    if (dn != null && pn != null && sn != null && kgPerM != null) {
      grp.push({ dn, pn, sn, wallMm: num(row.getCell(6)), kgPerM })
    }

    const peDn = num(row.getCell(19))
    const peName = str(row.getCell(20))
    const peKg = num(row.getCell(23))
    const peOd = num(row.getCell(21))
    if (peDn != null && peName && peKg != null && peOd != null) {
      pe.push({
        dn: peDn,
        name: peName,
        odMm: peOd,
        wallMm: str(row.getCell(22)) || null,
        kgPerM: peKg,
      })
    }
  }

  console.log(`  веса труб: GRP ${grp.length}, ПЭ ${pe.length}`)
  return { grp, pe }
}

// ─── Матрицы листа «Для расчетов» ────────────────────────────────────────────
// Три таблицы (Реверс §9.3):
//   строки  2–14  вес и толщина корпуса      = f(Dу, L)
//   строки 18–31  формовка эллиптических днищ = f(Dн, L)
//   строки 36–62  формовка простых патрубков  = f(DN)
//
// Первые две устроены одинаково: в шапке пары колонок «{D}» (кг) и «{D}-b» (мм),
// в строках — длина L. Значения снимаются по пересечению.

/** Ячейка матрицы f(D, L): масса формовки и толщина. */
export interface MatrixCell {
  /** Dу (корпус) или Dн (днище), мм. */
  d: number
  /** Длина изделия, мм. */
  lengthMm: number
  massKg: number
  thicknessMm: number | null
}

/** Нормы простого патрубка = f(DN) — на них считается формовка гильз. */
export interface NozzleNorm {
  /** Диаметр номинальный, мм. */
  dn: number
  /** Диаметр наружный, мм. */
  odMm: number | null
  /** Минимальная длина патрубка, мм. */
  minLengthMm: number | null
  /** Мф общая — масса формовки, кг. */
  moldingMassKg: number
  /** Н1, мм. */
  h1Mm: number | null
  /** S1, мм. */
  s1Mm: number | null
  /** Мф фланца, кг. */
  flangeMassKg: number | null
  /** Болтовое соединение для фланца, напр. «М24х100». */
  bolt: string | null
  /** Количество отверстий. */
  boltCount: number | null
}

/**
 * Разбирает матрицу вида f(D, L) с парными колонками «{D}» (кг) / «{D}-b» (мм).
 *
 * @param headerRow строка с диаметрами
 * @param firstRow  первая строка данных
 * @param lastRow   последняя строка данных
 */
function parseDxLMatrix(
  ws: ExcelJS.Worksheet,
  headerRow: number,
  firstRow: number,
  lastRow: number,
): MatrixCell[] {
  // Колонки диаметров: «1000» → масса, следом «1000-b» → толщина.
  const cols: Array<{ d: number; massCol: number; thickCol: number }> = []
  for (let c = 3; c <= ws.columnCount; c++) {
    const h = str(ws.getRow(headerRow).getCell(c))
    if (!h || h.includes('-b')) continue
    const d = Number(h)
    if (!Number.isFinite(d)) continue
    const next = str(ws.getRow(headerRow).getCell(c + 1))
    cols.push({ d, massCol: c, thickCol: next === `${h}-b` ? c + 1 : -1 })
  }

  const out: MatrixCell[] = []
  for (let r = firstRow; r <= lastRow; r++) {
    // Колонка 2 — длина в мм («До 3м» → 3000).
    const lengthMm = num(ws.getRow(r).getCell(2))
    if (lengthMm == null) continue
    for (const col of cols) {
      const massKg = num(ws.getRow(r).getCell(col.massCol))
      if (massKg == null) continue
      out.push({
        d: col.d,
        lengthMm,
        massKg,
        thicknessMm: col.thickCol > 0 ? num(ws.getRow(r).getCell(col.thickCol)) : null,
      })
    }
  }
  return out
}

/** Нормы патрубков: колонки 1–9 листа, строки 37…62. */
function parseNozzleNorms(ws: ExcelJS.Worksheet): NozzleNorm[] {
  const out: NozzleNorm[] = []
  for (let r = 37; r <= 62; r++) {
    const row = ws.getRow(r)
    const dn = num(row.getCell(1))
    const moldingMassKg = num(row.getCell(4))
    // Без DN или массы формовки строка бесполезна: ради неё таблица и нужна.
    if (dn == null || moldingMassKg == null) continue

    out.push({
      dn,
      odMm: num(row.getCell(2)),
      minLengthMm: num(row.getCell(3)),
      moldingMassKg,
      h1Mm: num(row.getCell(5)),
      s1Mm: num(row.getCell(6)),
      flangeMassKg: num(row.getCell(7)),
      bolt: str(row.getCell(8)) || null,
      boltCount: num(row.getCell(9)),
    })
  }
  return out
}

export interface EngineeringRefs {
  /** Вес и толщина корпуса = f(Dу, L). */
  shell: MatrixCell[]
  /** Формовка эллиптических днищ = f(Dн, L). */
  ellipticBottom: MatrixCell[]
  /** Нормы простых патрубков = f(DN). */
  nozzles: NozzleNorm[]
}

function extractEngineering(ws: ExcelJS.Worksheet): EngineeringRefs {
  const shell = parseDxLMatrix(ws, 2, 5, 14)
  const ellipticBottom = parseDxLMatrix(ws, 20, 22, 31)
  const nozzles = parseNozzleNorms(ws)

  const dus = [...new Set(shell.map((c) => c.d))]
  console.log(
    `  инженерные матрицы: корпус ${shell.length} ячеек (Dу ${dus.length}), ` +
      `днища ${ellipticBottom.length}, патрубки ${nozzles.length}`,
  )
  return { shell, ellipticBottom, nozzles }
}

// ─── Списки (enum'ы) ─────────────────────────────────────────────────────────
// AG2:AG17 — 16 категорий строк; последние три (Собственное производство,
// Работы, ФОТ) — непокупные: F=IF(OR(C=AG15:AG17),"нет","да").
// S2:S7 — единицы измерения.

export interface ListsSeed {
  categories: string[]
  nonPurchaseCategories: string[]
  units: string[]
}

function extractLists(ws: ExcelJS.Worksheet): ListsSeed {
  const categories: string[] = []
  for (let r = 2; r <= 17; r++) {
    const v = str(ws.getRow(r).getCell(33))
    if (v) categories.push(v)
  }

  const units: string[] = []
  for (let r = 2; r <= 8; r++) {
    const v = str(ws.getRow(r).getCell(19))
    if (v) units.push(v)
  }

  // AG15:AG17 в терминах листа = последние три категории.
  const nonPurchaseCategories = categories.slice(-3)

  console.log(`  списки: ${categories.length} категорий (непокупных ${nonPurchaseCategories.length}), ${units.length} ЕИ`)
  return { categories, nonPurchaseCategories, units }
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Читаю ${WORKBOOK}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(WORKBOOK)

  const sheet = (name: string): ExcelJS.Worksheet => {
    const ws = wb.getWorksheet(name)
    if (!ws) throw new Error(`Лист «${name}» не найден в книге`)
    return ws
  }

  const prices = extractPrices(sheet('НН'))
  const { grp, pe } = extractPipeWeights(sheet('Вес трубы, ПЭ трубы'))
  const lists = extractLists(sheet('Списки'))
  const engineering = extractEngineering(sheet('Для расчетов'))

  // ─── Проверки целостности: лучше упасть здесь, чем засеять мусор в БД ───
  const errors: string[] = []

  if (prices.length < 900) errors.push(`прайс: ожидалось ~1044 позиции, получено ${prices.length}`)
  if (grp.length !== 162) errors.push(`GRP-трубы: ожидалось 162 строки (Реверс §9.2), получено ${grp.length}`)
  if (pe.length !== 26) errors.push(`ПЭ-трубы: ожидалось 26 позиций (Реверс §9.2), получено ${pe.length}`)
  if (lists.categories.length !== 16) errors.push(`категории: ожидалось 16, получено ${lists.categories.length}`)

  // Ключи, на которых стоят @unique в схеме, обязаны быть уникальными и здесь —
  // иначе createMany({skipDuplicates}) молча потеряет строки при сиде.
  const uniq = (arr: unknown[]) => new Set(arr).size
  if (uniq(pe.map((p) => p.odMm)) !== pe.length) errors.push('ПЭ-трубы: наружный диаметр odMm не уникален')
  if (uniq(pe.map((p) => p.name)) !== pe.length) errors.push('ПЭ-трубы: наименование не уникально')
  if (uniq(grp.map((g) => `${g.dn};${g.pn};${g.sn}`)) !== grp.length) errors.push('GRP-трубы: ключ (DN;PN;SN) не уникален')

  // Ставка ФОТ обязана находиться по тройному ключу — на ней стоит вся экономика.
  const fot = prices.find((p) => p.category === 'ФОТ' && p.name === 'ФОТ' && p.unit === 'чел. ч')
  if (!fot) errors.push('не найдена позиция прайса «ФОТ / ФОТ / чел. ч» (ставка ФОТ)')
  else console.log(`  ставка ФОТ: ${fot.priceRub} ₽/чел.ч`)

  // Контроль: вес трубы ОЛ3487 (DN3000, PN_трубы 0,6, SN 10000) = 970,2 кг/пм.
  const ref = grp.find((g) => g.dn === 3000 && g.pn === 0.6 && g.sn === 10000)
  if (!ref) errors.push('не найден контрольный вес DN3000 / PN0,6 / SN10000')
  else if (Math.abs(ref.kgPerM - 970.2) > 0.05) errors.push(`контрольный вес DN3000: ожидалось 970,2, получено ${ref.kgPerM}`)
  else console.log(`  контроль веса DN3000;0,6;10000 = ${ref.kgPerM} кг/пм ✓`)

  // ─── Инженерные матрицы ───
  if (engineering.nozzles.length !== 26) {
    errors.push(`нормы патрубков: ожидалось 26 DN, получено ${engineering.nozzles.length}`)
  }
  // Диаметров Dу в матрице корпуса — 14 (1000…3000), длин — 10 («До 3м»…«До 12»).
  const shellD = new Set(engineering.shell.map((c) => c.d))
  const shellL = new Set(engineering.shell.map((c) => c.lengthMm))
  if (shellD.size !== 14) errors.push(`матрица корпуса: ожидалось 14 значений Dу, получено ${shellD.size}`)
  if (shellL.size !== 10) errors.push(`матрица корпуса: ожидалось 10 длин, получено ${shellL.size}`)
  if (engineering.ellipticBottom.length === 0) errors.push('матрица эллиптических днищ пуста')

  // Контрольные нормы патрубков (сверено с листом): DN250 -> 0,6 кг,
  // DN400 -> 1,1 кг и фланец 4,6 кг.
  const n250 = engineering.nozzles.find((n) => n.dn === 250)
  const n400 = engineering.nozzles.find((n) => n.dn === 400)
  if (!n250 || Math.abs(n250.moldingMassKg - 0.6) > 0.001) {
    errors.push(`норма патрубка DN250: ожидалось 0,6 кг, получено ${n250?.moldingMassKg}`)
  }
  if (!n400 || Math.abs(n400.moldingMassKg - 1.1) > 0.001 || Math.abs((n400.flangeMassKg ?? 0) - 4.6) > 0.001) {
    errors.push(`норма патрубка DN400: ожидалось 1,1 кг / фланец 4,6 кг, получено ${n400?.moldingMassKg} / ${n400?.flangeMassKg}`)
  }
  if (n250 && n400) console.log(`  контроль норм патрубков: DN250 = ${n250.moldingMassKg} кг, DN400 = ${n400.moldingMassKg} кг ✓`)

  // Контроль матрицы корпуса: Dу 3000, L «До 12» — сверено с листом.
  const shellRef = engineering.shell.find((c) => c.d === 3000 && c.lengthMm === 12000)
  if (!shellRef) errors.push('не найдена контрольная ячейка корпуса Dу3000 / L12000')
  else console.log(`  контроль корпуса Dу3000 / L12000 = ${shellRef.massKg} кг, ${shellRef.thicknessMm} мм ✓`)

  if (errors.length) {
    console.error('\nПРОВЕРКИ НЕ ПРОЙДЕНЫ:')
    errors.forEach((e) => console.error(`  ✗ ${e}`))
    process.exit(1)
  }

  await mkdir(OUT_DIR, { recursive: true })
  const write = async (file: string, data: unknown) => {
    await writeFile(resolve(OUT_DIR, file), JSON.stringify(data, null, 2) + '\n', 'utf8')
    console.log(`  → prisma/seed-data/${file}`)
  }

  await write('prices.json', prices)
  await write('pipe-weights-grp.json', grp)
  await write('pipe-weights-pe.json', pe)
  await write('lists.json', lists)
  await write('engineering.json', engineering)

  console.log('\nГотово.')
}

main().catch((e: unknown) => {
  console.error('ОШИБКА:', e instanceof Error ? e.message : e)
  process.exit(1)
})
