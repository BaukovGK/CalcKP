import { prisma } from './prisma'
import { bitrixConfig, fetchBitrixRest, type BitrixConfig, type LaunchTokens } from './bitrix-auth'
import { createB24Client, fetchOAuthRefresh, type B24Client, type TokenStore } from './b24-client'

/**
 * Клиент REST портала из настроек окружения и B24Token в базе. Один на
 * процесс: в нём очередь продлений ключей. null — Битрикс24 не настроен.
 */
const store: TokenStore = {
  async get(userId) {
    return prisma.b24Token.findUnique({
      where: { userId },
      select: { bitrixUserId: true, accessToken: true, refreshToken: true, expiresAt: true },
    })
  },
  async save(userId, t) {
    await prisma.b24Token.upsert({ where: { userId }, create: { userId, ...t }, update: t })
  },
  async remove(userId) {
    await prisma.b24Token.deleteMany({ where: { userId } })
  },
}

let cached: { key: string; client: B24Client } | null = null

export function b24Client(cfg: BitrixConfig | null = bitrixConfig()): B24Client | null {
  if (!cfg) return null
  const key = `${cfg.portal}|${cfg.clientId ?? ''}|${cfg.clientSecret ? 1 : 0}`
  if (cached?.key !== key) {
    cached = {
      key,
      client: createB24Client({
        rest: fetchBitrixRest(cfg.portal),
        store,
        refresh: cfg.clientId && cfg.clientSecret ? fetchOAuthRefresh(cfg.clientId, cfg.clientSecret) : null,
      }),
    }
  }
  return cached.client
}

/**
 * Ключи из запуска — в B24Token. Портал не прислал ключ продления — старый
 * не затираем: он может быть ещё жив.
 */
export async function saveLaunchTokens(userId: string, bitrixUserId: string, t: LaunchTokens): Promise<void> {
  const data = { bitrixUserId, accessToken: t.accessToken, expiresAt: t.expiresAt, ...(t.refreshToken ? { refreshToken: t.refreshToken } : {}) }
  await prisma.b24Token.upsert({
    where: { userId },
    create: { userId, refreshToken: t.refreshToken, ...data },
    update: data,
  })
}
