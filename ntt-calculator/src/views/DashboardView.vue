<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <div class="logo">НТТ · Калькулятор</div>
        <div class="logo-sub">{{ auth.user?.name }}</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Навигация</div>
        <button class="nav-link nav-link--active">Проекты</button>
        <button class="nav-link" v-if="auth.role === 'ADMIN' || auth.role === 'BUYER'" @click="router.push('/prices')">Прайс-лист</button>
        <button class="nav-link" v-if="auth.role === 'ADMIN' || auth.role === 'TECHNOLOG'" @click="router.push('/templates')">Шаблоны</button>
        <button class="nav-link" v-if="auth.role === 'ADMIN'" @click="router.push('/admin')">Администрирование</button>
      </div>
      <div class="sidebar-footer">
        <BugReportButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Проекты</div>
        <div class="tb-spacer"></div>
        <!-- «Все/Свои» — тем, кому виден весь список; инженер и так видит
             только свои проекты. -->
        <div v-if="canSeeAll" class="seg" role="group" aria-label="Чьи проекты показать">
          <button class="chip-f" :class="{ on: filter.scope === 'all' }" @click="filter.scope = 'all'">Все</button>
          <button class="chip-f" :class="{ on: filter.scope === 'mine' }" @click="filter.scope = 'mine'">Свои</button>
        </div>
        <!-- Главное действие экрана — акцентной кнопкой, как «Добавить
             единицу» в проекте: серой она теряется среди служебных. -->
        <button v-if="canCreate" class="btn btn-am" @click="newOpen = true">＋ Новый проект</button>
      </div>

      <div class="dash-filters">
        <input class="fi dash-search" v-model="filter.search" placeholder="Поиск по объекту, заказчику, адресу…" />
        <select class="fi dash-sel" v-model="filter.deviceType" aria-label="Тип оборудования">
          <option value="">Любое оборудование</option>
          <option v-for="(label, t) in DEVICE_LABELS" :key="t" :value="t">{{ label }}</option>
        </select>
        <select class="fi dash-sel" v-model="filter.status" aria-label="Статус единиц">
          <option value="">Любой статус</option>
          <option v-for="(label, st) in STATUS_LABELS" :key="st" :value="st">{{ label }}</option>
        </select>
        <select v-if="authors.length > 1" class="fi dash-sel" v-model="filter.authorId" aria-label="Автор">
          <option value="">Все авторы</option>
          <option v-for="a in authors" :key="a.id" :value="a.id">{{ a.name }}</option>
        </select>
        <button class="btn btn-g" :disabled="!hasActiveFilter(filter)" @click="resetFilter">Сбросить</button>
        <div class="seg dash-view" role="group" aria-label="Вид списка">
          <button class="chip-f" :class="{ on: view === 'cards' }" @click="view = 'cards'">Карточки</button>
          <button class="chip-f" :class="{ on: view === 'table' }" @click="view = 'table'">Таблица</button>
        </div>
      </div>

      <div class="calc-area">
        <div v-if="projects.loading" class="dash-state">
          <div class="dash-state-txt">Загрузка проектов…</div>
        </div>
        <div v-else-if="projects.error" class="dash-state">
          <div class="dash-state-txt dash-err">{{ projects.error }}</div>
          <button class="btn btn-g" @click="projects.fetchAll()">Повторить</button>
        </div>
        <div v-else-if="filtered.length === 0" class="dash-state">
          <div class="dash-state-txt">{{ projects.list.length === 0 ? 'Проектов пока нет. Создайте первый!' : 'Ничего не найдено.' }}</div>
          <button v-if="projects.list.length === 0 && canCreate" class="btn btn-am" @click="newOpen = true">＋ Создать проект</button>
        </div>
        <ProjectsTable
          v-else-if="view === 'table'"
          :projects="filtered"
          :can-delete="auth.role === 'ADMIN'"
          show-totals
          @open="router.push(`/projects/${$event}`)"
          @delete="askDeleteProject($event, projects.list.find((p) => p.id === $event)?.title ?? '')"
        />
        <div v-else class="dash-grid">
          <ProjectCard
            v-for="p in filtered" :key="p.id"
            :project="p"
            :can-delete="auth.role === 'ADMIN'"
            @open="router.push(`/projects/${$event}`)"
            @delete="askDeleteProject($event, p.title)"
          />

          <!-- «Новый проект» на виду и когда проекты уже есть — плиткой в
               конце сетки, как «Добавить оборудование» на экране проекта.
               В шапке кнопка теряется среди служебных, а в пустом состоянии
               исчезает после первого же проекта. При поиске плитки нет:
               там сетка показывает найденное, а не предлагает завести новое. -->
          <button v-if="canCreate && !hasActiveFilter(filter)" class="dash-add" @click="newOpen = true">
            ＋ Новый проект
          </button>
        </div>
      </div>
    </div>

    <!-- Подтверждение удаления проекта -->
    <BaseModal :show="!!deleteProjectId" title="Удалить проект?" @close="deleteProjectId = null">
      <p class="del-q">
        Удалить <strong>{{ deleteProjectTitle }}</strong><template v-if="deleteUnits > 0">
        вместе с {{ deleteUnits }} {{ unitsWord(deleteUnits) }} оборудования</template>? Действие необратимо.
      </p>
      <p v-if="deleteUnits > 0 && !deleteProtected" class="mo-sub">
        Если по единице выпущено КП или зафиксирована версия, здесь будет сказано, какая, —
        и проект можно будет удалить вместе с ними отдельным подтверждением.
      </p>
      <div v-if="deleteError" class="auth-err del-err">{{ deleteError }}</div>
      <p v-if="deleteProtected" class="mo-sub del-force">
        Вместе с проектом удалятся выпущенные КП и зафиксированные версии этих единиц.
        Вернуть их будет нельзя; в журнале аудита останется запись, что и кем удалено.
      </p>
      <template #footer>
        <button class="btn btn-g" @click="deleteProjectId = null">Отмена</button>
        <button v-if="deleteProtected" class="btn btn-danger" :disabled="deleting" @click="confirmDeleteProject(true)">
          {{ deleting ? 'Удаление…' : 'Удалить вместе с КП' }}
        </button>
        <button v-else class="btn btn-danger" :disabled="deleting" @click="confirmDeleteProject(false)">
          {{ deleting ? 'Удаление…' : 'Удалить' }}
        </button>
      </template>
    </BaseModal>

    <!-- Новый проект -->
    <BaseModal :show="newOpen" title="Новый проект" @close="closeNew">
      <div class="ff">
        <label class="fl">Объект <span style="color:var(--danger)">*</span></label>
        <input class="fi" v-model="form.title" placeholder="КНС DN3000 · ОЛ-2025-047" />
      </div>
      <div class="ff">
        <label class="fl">Заказчик</label>
        <input class="fi" v-model="form.customer" placeholder="ООО «Водоканал»" />
      </div>
      <div class="ff">
        <label class="fl">Адрес объекта</label>
        <input class="fi" v-model="form.address" placeholder="г. Краснодар, ул. Промышленная, 12" />
      </div>
      <div class="ff">
        <label class="fl">Примечание</label>
        <textarea class="fi" v-model="form.notes" rows="2" style="resize:vertical"></textarea>
      </div>
      <div v-if="formError" class="auth-err" style="margin-top:8px">{{ formError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="closeNew">Отмена</button>
        <button class="btn btn-am" :disabled="creating" @click="createProject">
          {{ creating ? 'Создание…' : 'Создать проект' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { apiErrorMessage } from '@/utils/api-error'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import { projectsApi } from '@/api/projects'
import { toast } from '@/composables/useToast'
import type { DeviceType, EstimateStatus } from '@/api/estimates'
import {
  EMPTY_FILTER, filterProjects, hasActiveFilter, projectAuthors,
  type ProjectFilter, type ProjectScope,
} from '@/utils/project-filter'
import ProjectCard  from '@/components/dashboard/ProjectCard.vue'
import ProjectsTable from '@/components/dashboard/ProjectsTable.vue'
import BaseModal    from '@/components/ui/BaseModal.vue'
import ThemeToggle  from '@/components/ui/ThemeToggle.vue'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import UserMenu     from '@/components/ui/UserMenu.vue'

const router   = useRouter()
const auth     = useAuthStore()
/** Заводят проекты те, кто считает: наблюдатель и снабженец только смотрят (План_устранения 3.7). */
const canCreate = computed(() => auth.role !== 'VIEWER' && auth.role !== 'BUYER')
const projects = useProjectsStore()

/** «Все/Свои» — тем, кому сервер отдаёт весь список; инженеру — только свои. */
const canSeeAll = computed(() => auth.role === 'ADMIN' || auth.role === 'MANAGER' || auth.role === 'VIEWER')

const DEVICE_LABELS: Record<DeviceType, string> = { KNS: 'КНС', EMK: 'Ёмкость', KOL: 'Колодец' }
const STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Черновик', CALC: 'Расчёт', REVIEW: 'Проверка', APPROVED: 'Утверждено', REJECTED: 'Отклонён',
}

// «Все/Свои» и вид списка — привычка сотрудника: помнятся между визитами.
// Хранилище может быть недоступно (приватный режим) — тогда просто по умолчанию.
const PREFS_KEY = 'ntt.dashboard'
function readPrefs(): { scope?: ProjectScope; view?: 'cards' | 'table' } {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {} } catch { return {} }
}
const prefs = readPrefs()

const filter = reactive<ProjectFilter>({ ...EMPTY_FILTER, scope: prefs.scope === 'mine' ? 'mine' : 'all' })
const view = ref<'cards' | 'table'>(prefs.view === 'table' ? 'table' : 'cards')
watch([() => filter.scope, view], ([scope, v]) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ scope, view: v })) } catch { /* без памяти */ }
})

function resetFilter() {
  Object.assign(filter, { ...EMPTY_FILTER, scope: filter.scope })
}

const authors = computed(() => projectAuthors(projects.list))

const newOpen = ref(false)
const creating = ref(false)
const formError = ref('')
const form = reactive({ title: '', customer: '', address: '', notes: '' })

const filtered = computed(() =>
  filterProjects(projects.list, canSeeAll.value ? filter : { ...filter, scope: 'all' }, auth.user?.id),
)

function closeNew() {
  newOpen.value = false
  form.title = ''; form.customer = ''; form.address = ''; form.notes = ''
  formError.value = ''; creating.value = false
}

async function createProject() {
  if (!form.title.trim()) { formError.value = 'Укажите название объекта'; return }
  creating.value = true; formError.value = ''
  try {
    const p = await projects.create({
      title:    form.title.trim(),
      customer: form.customer.trim() || undefined,
      address:  form.address.trim()  || undefined,
      notes:    form.notes.trim()    || undefined,
    })
    closeNew()
    router.push(`/projects/${p.id}`)
  } catch (e: unknown) {
    formError.value = apiErrorMessage(e, 'Ошибка')
  } finally {
    creating.value = false
  }
}

// ── Delete project ──────────────────────────────────────────────────────────
const deleteProjectId    = ref<string | null>(null)
const deleteProjectTitle = ref('')
/** Сколько единиц уйдёт вместе с проектом — окно называет число заранее. */
const deleteUnits = computed(
  () => projects.list.find((p) => p.id === deleteProjectId.value)?.estimates.length ?? 0,
)
/** «с 1 единицей», «с 3 единицами», «с 21 единицей» — творительный падеж. */
function unitsWord(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'единицей' : 'единицами'
}
const deleteError = ref('')
const deleting    = ref(false)
/**
 * Сервер отказал: в проекте единицы с выпущенным КП. Администратор может
 * удалить проект всё равно — вторым, явным подтверждением.
 */
const deleteProtected = ref(false)

function askDeleteProject(id: string, title: string) {
  deleteProjectId.value    = id
  deleteProjectTitle.value = title
  deleteError.value = ''
  deleteProtected.value = false
}

async function confirmDeleteProject(force: boolean) {
  if (!deleteProjectId.value) return
  deleting.value = true; deleteError.value = ''
  try {
    const units = deleteUnits.value
    await projectsApi.delete(deleteProjectId.value, { force })
    projects.list = projects.list.filter(p => p.id !== deleteProjectId.value)
    toast(
      units > 0
        ? `Проект «${deleteProjectTitle.value}» удалён вместе с ${units} ${unitsWord(units)}`
        : `Проект «${deleteProjectTitle.value}» удалён`,
      'success',
    )
    deleteProjectId.value = null
  } catch (e: unknown) {
    deleteError.value = apiErrorMessage(e, 'Ошибка удаления')
    const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code
    deleteProtected.value = code === 'PROJECT_UNITS_PROTECTED' && auth.role === 'ADMIN'
  } finally {
    deleting.value = false
  }
}

onMounted(() => projects.fetchAll())
</script>

<style scoped>
.dash-filters { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.dash-filters { flex-wrap: wrap; align-items: center; }
.dash-search  { flex: 1 1 220px; min-width: 0; }
.dash-sel     { width: auto; flex: 0 0 auto; }
.seg          { display: inline-flex; }
.seg .chip-f + .chip-f { border-left: none; }
.dash-view    { margin-left: auto; }
.dash-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 12px; align-content: start; }
/* Плитка «Новый проект» — тот же вид, что «Добавить оборудование» в проекте:
   пунктир акцентным цветом, высота карточки проекта. */
.dash-add     { border: 1px dashed var(--accent); border-radius: 6px; background: transparent;
  color: var(--accent); font: inherit; font-size: 13.5px; font-weight: 600;
  padding: 11px 13px; min-height: 96px; cursor: pointer; transition: background .15s; }
.dash-add:hover { background: var(--bg3); }
.del-q { font-size: 14.5px; color: var(--tx2); line-height: 1.5; margin: 0 0 8px; }
.del-err { margin: 10px 0 0; }
.del-force { margin-top: 10px; color: var(--danger); }
</style>
