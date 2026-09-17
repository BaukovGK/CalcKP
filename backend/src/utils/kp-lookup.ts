/**
 * Данные для КП, которых нет в опросном листе, — из базы.
 *
 * Пока такая одна: толщина стенки корпуса. В наименовании изделия она стоит
 * обязательной характеристикой («с толщиной стенки не менее 55,1 мм»), а лист
 * её не спрашивает — она следует из трубы, подобранной по DN, PN и SN.
 *
 * @module utils/kp-lookup
 */

import { shellPipeKey } from './kp-kit'
import { prisma } from './prisma'

/**
 * Толщина стенки корпуса, мм, по трубе из опросного листа.
 *
 * Трубы нет в таблице (нетиповой диаметр, лист без SN) — null: характеристика
 * просто не печатается. Обещать заказчику толщину, которой нет в справочнике,
 * нельзя.
 */
export async function shellWallMm(survey: unknown): Promise<number | null> {
  const key = shellPipeKey(survey)
  if (!key) return null

  const pipe = await prisma.pipeWeight.findUnique({
    where: { dn_pn_sn: { dn: key.dn, pn: key.pn, sn: key.sn } },
    select: { wallMm: true },
  })
  return pipe?.wallMm ?? null
}
