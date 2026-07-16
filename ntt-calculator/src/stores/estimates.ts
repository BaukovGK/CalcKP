import { defineStore } from 'pinia'
import { ref } from 'vue'
import { estimatesApi, type EstimateListItem, type EstimateDetail, type CreateEstimateDto } from '@/api/estimates'

export const useEstimatesStore = defineStore('estimates', () => {
  const list      = ref<EstimateListItem[]>([])
  const current   = ref<EstimateDetail | null>(null)
  const loading   = ref(false)
  const error     = ref<string | null>(null)

  async function fetchAll() {
    loading.value = true
    error.value   = null
    try {
      list.value = await estimatesApi.list()
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Ошибка загрузки'
    } finally {
      loading.value = false
    }
  }

  async function fetchOne(id: string) {
    loading.value = true
    error.value   = null
    try {
      current.value = await estimatesApi.get(id)
    } catch (e: unknown) {
      error.value = e instanceof Error ? e.message : 'Ошибка загрузки'
    } finally {
      loading.value = false
    }
  }

  async function create(dto: CreateEstimateDto): Promise<EstimateDetail> {
    const estimate = await estimatesApi.create(dto)
    list.value.unshift({
      id: estimate.id,
      title: estimate.title,
      deviceType: estimate.deviceType,
      status: estimate.status,
      totalRub: estimate.totalRub,
      updatedAt: estimate.updatedAt,
      author: estimate.author,
    })
    return estimate
  }

  function clear() {
    list.value    = []
    current.value = null
    error.value   = null
  }

  return { list, current, loading, error, fetchAll, fetchOne, create, clear }
})
