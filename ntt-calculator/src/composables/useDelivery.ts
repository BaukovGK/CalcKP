import { computed, onMounted, ref, type Ref } from 'vue'
import { deliveryRatesApi, type DeliveryRateItem } from '@/api/deliveryRates'
import { findRate, knsDelivery, type DeliveryResult } from '@/engines/delivery'
import { tryEvalExpr } from '@/engines/expr'
import { apiErrorMessage } from '@/utils/api-error'

/** Поля раздела «Доставка» в форме ОЛ. */
export interface DeliveryFormFields {
  /** id маршрута в тарифах; пусто — город не выбран. */
  deliveryRateId: string
  /** Название маршрута — по нему город находится, если импорт пересоздал строки. */
  deliveryCity: string
  /** Стоимость доставки вручную, ₽; пусто — расчётная по тарифам. */
  deliveryCost: string
}

/** Длиннее — подпись в списке обрезается многоточием (полное название — в тарифах). */
const OPTION_MAX = 70

/**
 * Подпись маршрута в списке: без ссылок (в книге встречается ссылка на
 * Яндекс.Навигатор) и не длиннее {@link OPTION_MAX} знаков.
 */
export function optionCity(city: string): string {
  const s = city.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  return s.length > OPTION_MAX ? `${s.slice(0, OPTION_MAX - 1).trimEnd()}…` : s
}

/**
 * Раздел «Доставка» опросного листа КНС: тарифы, выбранный маршрут, расчёт
 * по таблице ограничений (engines/delivery.ts) и итог с учётом ручного ввода.
 *
 * Итог — ручная стоимость, если она введена, иначе расчётная.
 */
export function useDelivery(
  form: Ref<DeliveryFormFields>,
  product: { dnMm: () => number | null; lengthMm: () => number | null },
) {
  const rates = ref<DeliveryRateItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      rates.value = await deliveryRatesApi.list()
    } catch (e) {
      error.value = apiErrorMessage(e, 'Не удалось загрузить тарифы доставки')
    } finally {
      loading.value = false
    }
  }
  onMounted(load)

  /** Одинаковые названия маршрутов в книге различаем номером строки. */
  const options = computed(() => {
    const seen = new Map<string, number>()
    for (const r of rates.value) seen.set(r.city, (seen.get(r.city) ?? 0) + 1)
    return rates.value.map((r) => {
      const city = optionCity(r.city)
      return { id: r.id, label: (seen.get(r.city) ?? 0) > 1 && r.num != null ? `${city} (№${r.num})` : city }
    })
  })

  const rate = computed(() => findRate(rates.value, form.value.deliveryRateId, form.value.deliveryCity))

  /** Город сохранён в листе, а в тарифах его уже нет. */
  const lostCity = computed(() =>
    !loading.value && !rate.value && form.value.deliveryCity ? form.value.deliveryCity : null,
  )

  function selectRate(id: string) {
    const r = rates.value.find((x) => x.id === id)
    form.value.deliveryRateId = r?.id ?? ''
    form.value.deliveryCity = r?.city ?? ''
  }

  const result = computed<DeliveryResult | null>(() => {
    const dn = product.dnMm()
    const length = product.lengthMm()
    if (!rate.value || dn == null || length == null) return null
    return knsDelivery(dn, length, rate.value)
  })

  const manualRub = computed(() => tryEvalExpr(form.value.deliveryCost))
  const calcRub = computed(() => result.value?.totalRub ?? null)

  /** Стоимость доставки, которая идёт в итог: ручная или расчётная. */
  const costRub = computed<number | null>(() => manualRub.value ?? calcRub.value)

  return { rates, options, loading, error, load, rate, lostCity, selectRate, result, manualRub, calcRub, costRub }
}
