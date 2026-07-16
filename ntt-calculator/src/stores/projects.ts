import { defineStore } from 'pinia'
import { ref } from 'vue'
import { projectsApi, type ProjectListItem, type ProjectDetail, type CreateProjectDto, type CreateEstimateInProjectDto } from '@/api/projects'

export const useProjectsStore = defineStore('projects', () => {
  const list    = ref<ProjectListItem[]>([])
  const current = ref<ProjectDetail | null>(null)
  const loading = ref(false)
  const error   = ref<string | null>(null)

  async function fetchAll() {
    loading.value = true; error.value = null
    try { list.value = await projectsApi.list() }
    catch (e: unknown) { error.value = e instanceof Error ? e.message : 'Ошибка загрузки' }
    finally { loading.value = false }
  }

  async function fetchOne(id: string) {
    loading.value = true; error.value = null
    try { current.value = await projectsApi.get(id) }
    catch (e: unknown) { error.value = e instanceof Error ? e.message : 'Ошибка загрузки' }
    finally { loading.value = false }
  }

  async function create(dto: CreateProjectDto): Promise<ProjectDetail> {
    const project = await projectsApi.create(dto)
    list.value.unshift(project)
    return project
  }

  async function addEstimate(projectId: string, dto: CreateEstimateInProjectDto) {
    const estimate = await projectsApi.addEstimate(projectId, dto)
    if (current.value?.id === projectId) {
      current.value.estimates.push(estimate)
    }
    const proj = list.value.find(p => p.id === projectId)
    if (proj) proj.estimates.push({ id: estimate.id, title: estimate.title, deviceType: estimate.deviceType, status: estimate.status, totalRub: estimate.totalRub })
    return estimate
  }

  function clear() { list.value = []; current.value = null; error.value = null }

  return { list, current, loading, error, fetchAll, fetchOne, create, addEstimate, clear }
})
