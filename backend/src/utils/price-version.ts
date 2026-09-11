import type { Prisma } from '@prisma/client'

/**
 * Версии прайса: новая — на каждое изменение цен (ТЗ §3).
 *
 * Расчёт помнит версию прайса, по которой посчитаны его цены, и сверяет её с
 * действующей: так он узнаёт, что цены под ним сдвинулись, а выпуск КП
 * спрашивает, по каким ценам выпускать. Пока версию поднимал только импорт,
 * правка цены на экране прайса проходила мимо: два расчёта с подписью «НН v5»
 * могли стоять на разных ценах (План_устранения, 1.2). Теперь версию создаёт
 * и ручная правка — в той же транзакции, что и сама цена (`price-edit.ts`).
 *
 * @module utils/price-version
 */

/** Сколько раз повторять запись, если номер версии успели занять. */
export const PRICE_VERSION_RETRIES = 3

/**
 * Ключ advisory-блокировки Postgres, под которой выдаётся номер версии.
 * Транзакция держит её до конца: следующая дождётся коммита и прочитает уже
 * новый максимум.
 */
export const PRICE_VERSION_LOCK = 0x50524943 // «PRIC»

/**
 * Взять блокировку выдачи версий прайса до конца транзакции. Повторный вызов
 * в той же транзакции проходит сразу: блокировка Postgres повторно входима.
 */
export async function lockPriceVersions(tx: Pick<Prisma.TransactionClient, '$executeRaw'>): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRICE_VERSION_LOCK}::bigint)`
}

/** Подпись версии по умолчанию — её показывают экран прайса и КП. */
export function defaultPriceVersionLabel(version: number): string {
  return `НН v${version}`
}

/**
 * Создать следующую версию прайса — внутри транзакции, где меняются цены.
 *
 * Цены без версии или версия без цен хуже любого из двух состояний: расчёт
 * либо не узнает о новых ценах, либо предложит пересчёт, который ничего не
 * изменит.
 *
 * @returns номер новой версии
 */
export async function createPriceVersion(
  tx: Pick<Prisma.TransactionClient, 'priceListVersion' | '$executeRaw'>,
  opts: { label?: string; note: string; userId: string | null },
): Promise<number> {
  // Номер выдаётся одной транзакции за раз: иначе правки разных позиций в
  // одно мгновение прочитали бы один максимум (withPriceVersionRetry ниже —
  // страховка для записей мимо блокировки).
  await lockPriceVersions(tx)
  const last = await tx.priceListVersion.findFirst({ orderBy: { version: 'desc' }, select: { version: true } })
  const version = (last?.version ?? 0) + 1
  await tx.priceListVersion.create({
    data: {
      version,
      label: opts.label || defaultPriceVersionLabel(version),
      note: opts.note,
      createdById: opts.userId,
    },
  })
  return version
}

/**
 * Выполнить запись, создающую версию прайса, с повтором при гонке.
 *
 * Номер версии — максимум + 1. Выдаётся он под блокировкой
 * (`createPriceVersion`), но запись мимо неё — сид, восстановленный дамп —
 * может занять тот же номер, и вставка нарушит уникальность `version`
 * (P2002). Спор решает уникальный индекс, а проигравшему достаточно
 * повторить транзакцию и перечитать максимум — как у снапшотов расчёта
 * (`estimates.routes.ts`, createSnapshot).
 *
 * @param run транзакция целиком: повтор начинает её заново
 * @param onRetry вызывается перед каждым повтором — для лога
 */
export async function withPriceVersionRetry<T>(
  run: () => Promise<T>,
  onRetry?: (attempt: number) => void,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run()
    } catch (e) {
      const isRace = (e as { code?: string }).code === 'P2002'
      if (!isRace || attempt >= PRICE_VERSION_RETRIES) throw e
      onRetry?.(attempt)
    }
  }
}
