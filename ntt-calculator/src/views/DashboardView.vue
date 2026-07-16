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
        <button class="nav-link" v-if="auth.role === 'ADMIN'" @click="router.push('/admin')">Администрирование</button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
        <button class="btn btn-g btn-full" @click="handleLogout">Выйти</button>
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Проекты</div>
        <div class="tb-spacer"></div>
        <button class="btn" @click="newOpen = true">＋ Новый проект</button>
      </div>

      <div class="dash-filters">
        <input class="fi dash-search" v-model="search" placeholder="Поиск по объекту, заказчику, адресу…" />
        <button class="btn btn-g" @click="search = ''">Сбросить</button>
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
          <button v-if="projects.list.length === 0" class="btn" @click="newOpen = true">＋ Создать проект</button>
        </div>
        <div v-else class="dash-grid">
          <ProjectCard
            v-for="p in filtered" :key="p.id"
            :project="p"
            :can-delete="auth.role === 'ADMIN'"
            @open="router.push(`/projects/${$event}`)"
            @delete="askDeleteProject($event, p.title)"
          />
        </div>
      </div>
    </div>

    <!-- Подтверждение удаления проекта -->
    <BaseModal :show="!!deleteProjectId" title="Удалить проект?" @close="deleteProjectId = null">
      <div style="font-size:12px;color:var(--tx2)">
        Удалить <strong>{{ deleteProjectTitle }}</strong> со всеми единицами оборудования? Действие необратимо.
      </div>
      <div v-if="deleteError" class="auth-err" style="margin-top:8px">{{ deleteError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="deleteProjectId = null">Отмена</button>
        <button class="btn" style="background:var(--danger);color:#fff" :disabled="deleting" @click="confirmDeleteProject">
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import { projectsApi } from '@/api/projects'
import ProjectCard  from '@/components/dashboard/ProjectCard.vue'
import BaseModal    from '@/components/ui/BaseModal.vue'
import ThemeToggle  from '@/components/ui/ThemeToggle.vue'

const router   = useRouter()
const auth     = useAuthStore()
const projects = useProjectsStore()

const search  = ref('')
const newOpen = ref(false)
const creating = ref(false)
const formError = ref('')
const form = reactive({ title: '', customer: '', address: '', notes: '' })

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return projects.list
  return projects.list.filter(p =>
    [p.title, p.customer ?? '', p.address ?? ''].join(' ').toLowerCase().includes(q)
  )
})

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
    formError.value = e instanceof Error ? e.message : 'Ошибка'
  } finally {
    creating.value = false
  }
}

// ── Delete project ──────────────────────────────────────────────────────────
const deleteProjectId    = ref<string | null>(null)
const deleteProjectTitle = ref('')
const deleteError = ref('')
const deleting    = ref(false)

function askDeleteProject(id: string, title: string) {
  deleteProjectId.value    = id
  deleteProjectTitle.value = title
  deleteError.value = ''
}

async function confirmDeleteProject() {
  if (!deleteProjectId.value) return
  deleting.value = true; deleteError.value = ''
  try {
    await projectsApi.delete(deleteProjectId.value)
    projects.list = projects.list.filter(p => p.id !== deleteProjectId.value)
    deleteProjectId.value = null
  } catch (e: unknown) {
    deleteError.value = e instanceof Error ? e.message : 'Ошибка удаления'
  } finally {
    deleting.value = false
  }
}

async function handleLogout() {
  await auth.logout()
  projects.clear()
  router.push('/login')
}

onMounted(() => projects.fetchAll())
</script>

<style scoped>
.dash-filters { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.dash-search  { flex: 1; min-width: 0; }
.dash-grid    { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 10px; padding: 12px; align-content: start; }
.dash-state   { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 12px; color: var(--tx3); }
.dash-err     { color: var(--danger); }
.nav-section  { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }
.nav-link     { display: block; width: 100%; text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 11px; color: var(--tx2); cursor: pointer; background: transparent; border: none; transition: background .12s, color .12s; }
.nav-link:hover   { background: var(--bg3); color: var(--tx1); }
.nav-link--active { background: var(--bg3); color: var(--accent); font-weight: 600; }
</style>
