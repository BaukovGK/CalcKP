import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import { prisma } from '../utils/prisma'

export const refsRouter = Router()
refsRouter.use('/', requireAuth)

/**
 * GET /api/refs/nomenclature — прайс, сгруппированный по категориям (ТЗ §7).
 *
 * Заменяет статику `ntt-calculator/src/data/nomenclature.ts`: та содержала
 * ~17 позиций с пустой ценой и была вторым, конкурирующим источником цен.
 */
refsRouter.get('/nomenclature', async (_req, res, next) => {
  try {
    const items = await prisma.priceItem.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      select: { id: true, category: true, name: true, unit: true, priceRub: true, comment: true },
    })

    const byCategory: Record<string, typeof items> = {}
    for (const item of items) {
      ;(byCategory[item.category] ??= []).push(item)
    }

    res.json(byCategory)
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/refs/templates — действующие шаблоны изделий и опубликованные узлы
 * каталога (редактор шаблонов, этап 2; Библиотека §6.2).
 *
 * Калькулятор материализует изделие по действующему шаблону его типа, а без
 * него — встроенным (код, версия 0). Узлы — действующие версии всех узлов
 * вне архива: их читают шаблоны и вставка «Компонент из каталога».
 * Черновики сюда не попадают — расчёты видят только опубликованное.
 */
refsRouter.get('/templates', async (_req, res, next) => {
  try {
    const [templates, nodes] = await Promise.all([
      prisma.productTemplate.findMany({ where: { activeVersion: { not: null } }, include: { versions: true } }),
      prisma.nodeDef.findMany({ where: { activeVersion: { not: null }, archived: false }, include: { versions: true } }),
    ])
    const products: Record<string, { version: number; body: unknown }> = {}
    for (const t of templates) {
      const v = t.versions.find((x) => x.version === t.activeVersion)
      if (v) products[t.deviceType] = { version: v.version, body: v.body }
    }
    const catalog = nodes.flatMap((n) => {
      const v = n.versions.find((x) => x.version === n.activeVersion)
      return v ? [{ code: n.code, version: v.version, body: v.body }] : []
    })
    res.json({ products, nodes: catalog })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/refs/price-version — активная версия прайса (ТЗ §3).
 *
 * «Прайс версионируется целиком… активная версия фиксируется в snapshot
 * расчёта». Активная = MAX(version); новую создают импорт прайса и ручная
 * правка цены (`prices.routes.ts`, utils/price-version.ts). `note` — чем
 * версия создана: импорт какого файла или правка какой позиции.
 *
 * Нужен калькулятору: до этого фронт держал `priceListVersion = ref(1)`
 * захардкоженной константой, поэтому топбар всегда показывал «НН v1», какой бы
 * прайс ни был импортирован. Снапшот при этом писал настоящую версию — и
 * расходился с тем, что видел инженер.
 *
 * Пустая таблица (БД засеяна до появления версий) → version 1: то же значение,
 * что подставляет снапшот (`estimates.routes.ts`, createSnapshot).
 */
refsRouter.get('/price-version', async (_req, res, next) => {
  try {
    const active = await prisma.priceListVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true, label: true, note: true, createdAt: true },
    })

    res.json({
      version: active?.version ?? 1,
      label: active?.label ?? 'НН v1',
      note: active?.note ?? null,
      createdAt: active?.createdAt ?? null,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/refs/engineering — инженерные матрицы листа «Для расчетов»
 * (ТЗ §7, приоритет высокий; Реверс §9.3).
 *
 * `shell`          вес и толщина корпуса      = f(Dу, L) — 140 ячеек
 * `ellipticBottom` формовка эллиптических днищ = f(Dн, L) — 140 ячеек
 * `nozzles`        нормы простых патрубков     = f(DN)    — 26 позиций
 * `jointLayers`    Мс, масса слоёв на стыке    = f(Dу, PN) — 105 строк
 *
 * Нормы патрубков — источник массы формовки гильз (Библиотека A5): без них
 * количество приходилось вводить вручную. Мс — источник «Ламинирования частей
 * корпуса» (КНС) и «Ламинации днища» (ЕМК).
 */
refsRouter.get('/engineering', async (_req, res, next) => {
  try {
    const [matrix, nozzles, jointLayers] = await Promise.all([
      prisma.engineeringMatrix.findMany({
        orderBy: [{ kind: 'asc' }, { d: 'asc' }, { lengthMm: 'asc' }],
        select: { kind: true, d: true, lengthMm: true, massKg: true, thicknessMm: true },
      }),
      prisma.nozzleNorm.findMany({
        orderBy: { dn: 'asc' },
        select: {
          dn: true, odMm: true, minLengthMm: true, moldingMassKg: true,
          h1Mm: true, s1Mm: true, flangeMassKg: true, bolt: true, boltCount: true,
        },
      }),
      prisma.jointLayerNorm.findMany({
        orderBy: [{ d: 'asc' }, { pn: 'asc' }],
        select: { d: true, pn: true, odMm: true, hMm: true, sMm: true, xMm: true, yMm: true, massKg: true },
      }),
    ])

    res.json({
      shell: matrix.filter((m) => m.kind === 'SHELL').map(({ kind: _kind, ...c }) => c),
      ellipticBottom: matrix.filter((m) => m.kind === 'ELLIPTIC_BOTTOM').map(({ kind: _kind, ...c }) => c),
      nozzles,
      jointLayers,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * GET /api/refs/pipe-weights — веса труб (ТЗ §7, приоритет высокий).
 *
 * GRP: ключ (DN; PN; SN) → толщина стенки, кг/пм — 162 позиции, DN 300…3000.
 * ПЭ: ПЭ-100 SDR17 — 26 позиций.
 *
 * ⚠️ PN здесь — это PN_ТРУБЫ (автоподбор, ячейка F7 эталона), а НЕ PN
 * опросного листа (ТЗ §9.4). Домены: PN {0,6; 1; 1,6}, SN {2500; 5000; 10000};
 * PN = 0,1 из ОЛ в справочнике отсутствует — искать по нему нельзя.
 *
 * SN 1250 здесь тоже нет, но с переходом на правило завода (`utils/ring-stiffness.ts`,
 * `engines/survey-kns.ts` → SN_BASE) опросный лист его больше не выдаёт: домен
 * подбора сузился до {5000; 10000}, обозначения 8000/12000 по ТТ МВК — та же
 * труба, вес берётся из строк 5000 и 10000.
 */
refsRouter.get('/pipe-weights', async (_req, res, next) => {
  try {
    const [grp, pe] = await Promise.all([
      prisma.pipeWeight.findMany({
        orderBy: [{ dn: 'asc' }, { sn: 'asc' }, { pn: 'asc' }],
        select: { dn: true, pn: true, sn: true, wallMm: true, kgPerM: true },
      }),
      prisma.pePipe.findMany({
        orderBy: { odMm: 'asc' },
        select: { dn: true, name: true, odMm: true, wallMm: true, kgPerM: true },
      }),
    ])

    res.json({ grp, pe })
  } catch (e) {
    next(e)
  }
})
