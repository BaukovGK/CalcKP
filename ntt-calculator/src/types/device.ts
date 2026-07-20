/**
 * Тип изделия — единственное определение на фронте.
 *
 * `api/estimates.ts` и `engines/template-kns.ts` реэкспортируют отсюда;
 * третья копия — enum в `backend/prisma/schema.prisma` (граница систем).
 */
export type DeviceType = 'KNS' | 'EMK' | 'KOL'
