<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">{{ projects.current?.title ?? '…' }}</div>
        <div v-if="projects.current?.customer" class="logo-sub">{{ projects.current.customer }}</div>
        <div v-if="projects.current?.address"  class="logo-sub">{{ projects.current.address }}</div>
      </div>
      <div class="sidebar-scroll" style="flex:1">
        <div class="nav-section">Единицы оборудования</div>
        <template v-if="projects.current">
          <div
            v-for="e in projects.current.estimates" :key="e.id"
            class="pv-unit-link"
            @click="router.push(`/calculator/${e.id}`)"
          >
            <span class="pv-unit-badge" :class="`pv-unit-badge--${e.deviceType.toLowerCase()}`">{{ e.deviceType }}</span>
            <span class="pv-unit-name">{{ e.title }}</span>
          </div>
        </template>
        <div v-if="projects.current?.estimates.length === 0" class="pv-empty-nav">Нет единиц</div>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <!-- Topbar -->
      <div class="topbar">
        <div>
          <div class="tb-title">{{ projects.current?.title ?? 'Проект' }}</div>
          <div v-if="projects.current?.address" class="tb-sub">{{ projects.current.address }}</div>
        </div>
        <div class="tb-spacer"></div>
        <button class="btn btn-g" @click="openEditProject">Редактировать</button>
        <button class="btn" @click="addUnit">＋ Добавить единицу</button>
      </div>

      <!-- Content -->
      <div class="calc-area">
        <div v-if="projects.loading" class="dash-state">
          <div class="dash-state-txt">Загрузка…</div>
        </div>
        <div v-else-if="projects.error" class="dash-state">
          <div class="dash-state-txt dash-err">{{ projects.error }}</div>
        </div>
        <template v-else-if="projects.current">

          <!-- Project meta card -->
          <div class="pv-meta-card">
            <div class="pv-meta-row" v-if="projects.current.customer">
              <span class="pv-meta-lbl">Заказчик</span>
              <span class="pv-meta-val">{{ projects.current.customer }}</span>
            </div>
            <div class="pv-meta-row" v-if="projects.current.address">
              <span class="pv-meta-lbl">Адрес</span>
              <span class="pv-meta-val">{{ projects.current.address }}</span>
            </div>
            <div class="pv-meta-row">
              <span class="pv-meta-lbl">Автор</span>
              <span class="pv-meta-val">{{ projects.current.author?.name }}</span>
            </div>
            <div class="pv-meta-row">
              <span class="pv-meta-lbl">Обновлено</span>
              <span class="pv-meta-val">{{ fmtDate(projects.current.updatedAt) }}</span>
            </div>
          </div>

          <!-- Estimates list -->
          <div v-if="projects.current.estimates.length === 0" class="dash-state" style="height:auto;padding:32px 0;opacity:.5">
            <div class="dash-state-txt">Единиц оборудования нет</div>
            <button class="btn" @click="addUnit">＋ Добавить первую единицу</button>
          </div>

          <div v-else class="pv-units-grid">
            <div
              v-for="e in projects.current.estimates" :key="e.id"
              class="pv-unit-card"
              @click="router.push(`/calculator/${e.id}`)"
            >
              <div class="pv-uc-top">
                <span class="pv-uc-type" :class="`pv-uc-type--${e.deviceType.toLowerCase()}`">{{ e.deviceType }}</span>
                <span class="pv-uc-status" :class="`pv-uc-status--${e.status.toLowerCase()}`">{{ STATUS_LABELS[e.status] }}</span>
                <span class="pv-uc-date">{{ fmtDate(e.updatedAt) }}</span>
                <button
                  v-if="e.status === 'DRAFT' || e.status === 'REJECTED'"
                  class="pv-uc-del"
                  title="Удалить"
                  @click.stop="askDeleteEstimate(e)"
                >×</button>
              </div>
              <div class="pv-uc-title">{{ e.title }}</div>
              <div class="pv-uc-params" v-if="techParams(e).length">
                <span v-for="p in techParams(e)" :key="p" class="pv-uc-param">{{ p }}</span>
              </div>
              <div v-if="e.totalRub" class="pv-uc-total">{{ fmt(e.totalRub) }} ₽</div>
            </div>
          </div>

        </template>
      </div>
    </div>

    <!-- Редактирование проекта -->
    <BaseModal :show="editOpen" title="Редактировать проект" @close="editOpen = false">
      <div class="ff">
        <label class="fl">Объект <span style="color:var(--danger)">*</span></label>
        <input class="fi" v-model="editForm.title" />
      </div>
      <div class="ff">
        <label class="fl">Заказчик</label>
        <input class="fi" v-model="editForm.customer" />
      </div>
      <div class="ff">
        <label class="fl">Адрес объекта</label>
        <input class="fi" v-model="editForm.address" />
      </div>
      <div class="ff">
        <label class="fl">Примечание</label>
        <textarea class="fi" v-model="editForm.notes" rows="2" style="resize:vertical"></textarea>
      </div>
      <div v-if="editError" class="auth-err" style="margin-top:8px">{{ editError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="editOpen = false">Отмена</button>
        <button class="btn btn-am" :disabled="editSaving" @click="saveEdit">
          {{ editSaving ? 'Сохранение…' : 'Сохранить' }}
        </button>
      </template>
    </BaseModal>

    <!-- Подтверждение удаления единицы -->
    <BaseModal :show="!!deleteEstimateId" title="Удалить единицу?" @close="deleteEstimateId = null">
      <div style="font-size:12px;color:var(--tx2)">
        Удалить <strong>{{ deleteEstimateTitle }}</strong>? Действие необратимо.
      </div>
      <div v-if="deleteError" class="auth-err" style="margin-top:8px">{{ deleteError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="deleteEstimateId = null">Отмена</button>
        <button class="btn" style="background:var(--danger);color:#fff" :disabled="deleting" @click="confirmDeleteEstimate">
          {{ deleting ? 'Удаление…' : 'Удалить' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import { projectsApi } from '@/api/projects'
import { estimatesApi, type EstimateStatus } from '@/api/estimates'
import type { ProjectEstimate } from '@/api/projects'
import BaseModal    from '@/components/ui/BaseModal.vue'
import ThemeToggle  from '@/components/ui/ThemeToggle.vue'
import { fmt } from '@/engines/cost'

const route    = useRoute()
const router   = useRouter()
const projects = useProjectsStore()

const projectId = String(route.params.id)

/**
 * Новая единица создаётся через ЕДИНЫЙ опросный лист (/survey?project=…):
 * прежний краткий модал сохранял surveyData в форме, которую материализатор
 * не понимал, — расчёт открывался пустым.
 */
function addUnit() {
  router.push({ name: 'survey', query: { project: projectId } })
}

// ── Edit project ────────────────────────────────────────────────────────────
const editOpen  = ref(false)
const editSaving = ref(false)
const editError = ref('')
const editForm  = reactive({ title: '', customer: '', address: '', notes: '' })

function openEditProject() {
  const p = projects.current
  if (!p) return
  editForm.title    = p.title
  editForm.customer = p.customer ?? ''
  editForm.address  = p.address  ?? ''
  editForm.notes    = (p as Record<string, unknown>).notes as string ?? ''
  editError.value   = ''
  editOpen.value    = true
}

async function saveEdit() {
  if (!editForm.title.trim()) { editError.value = 'Укажите название объекта'; return }
  editSaving.value = true; editError.value = ''
  try {
    const updated = await projectsApi.update(projectId, {
      title:    editForm.title.trim(),
      customer: editForm.customer.trim() || undefined,
      address:  editForm.address.trim()  || undefined,
      notes:    editForm.notes.trim()    || undefined,
    })
    if (projects.current) {
      projects.current.title    = updated.title
      projects.current.customer = updated.customer
      projects.current.address  = updated.address
    }
    editOpen.value = false
  } catch (e: unknown) {
    editError.value = e instanceof Error ? e.message : 'Ошибка сохранения'
  } finally {
    editSaving.value = false
  }
}

// ── Delete estimate ─────────────────────────────────────────────────────────
const deleteEstimateId    = ref<string | null>(null)
const deleteEstimateTitle = ref('')
const deleteError = ref('')
const deleting    = ref(false)

function askDeleteEstimate(e: ProjectEstimate) {
  deleteEstimateId.value    = e.id
  deleteEstimateTitle.value = e.title
  deleteError.value = ''
}

async function confirmDeleteEstimate() {
  if (!deleteEstimateId.value) return
  deleting.value = true; deleteError.value = ''
  try {
    await estimatesApi.delete(deleteEstimateId.value)
    if (projects.current) {
      projects.current.estimates = projects.current.estimates.filter(e => e.id !== deleteEstimateId.value)
    }
    deleteEstimateId.value = null
  } catch (e: unknown) {
    deleteError.value = e instanceof Error ? e.message : 'Ошибка удаления'
  } finally {
    deleting.value = false
  }
}

const STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Черновик', CALC: 'Расчёт', REVIEW: 'Проверка', APPROVED: 'Утверждено', REJECTED: 'Отклонён',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Чипы параметров — по единому контракту surveyData (kns/emk/kol + derived). */
function techParams(e: ProjectEstimate): string[] {
  const sd = e.surveyData ?? {}
  const src = (sd.kns ?? sd.emk ?? sd.kol ?? {}) as Record<string, unknown>
  const derived = (sd.derived ?? {}) as Record<string, unknown>
  const out: string[] = []
  if (src.dn) out.push(`DN${src.dn}`)
  // КНС: глубина подземной части из derived; ЕМК: объём; КОЛ: рабочая глубина.
  if (derived.npodzMm) out.push(`подз. ${derived.npodzMm} мм`)
  if (src.volumeM3) out.push(`V=${src.volumeM3} м³`)
  if (src.workingDepthMm) out.push(`H=${src.workingDepthMm} мм`)
  if (derived.pn ?? src.pnSurvey) out.push(`PN${derived.pn ?? src.pnSurvey}`)
  if (derived.sn) out.push(`SN${derived.sn}`)
  return out
}

onMounted(() => projects.fetchOne(projectId))
</script>

<style scoped>
.pv-unit-link {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px;
  cursor: pointer; transition: background .12s;
}
.pv-unit-link:hover { background: var(--bg3); }
.pv-unit-badge {
  font-family: Archivo, system-ui, sans-serif; font-size: 8px; font-weight: 700;
  padding: 1px 4px; border-radius: 2px; background: var(--accent); color: #fff; flex-shrink: 0;
}
.pv-unit-badge--emk { background: #8b5cf6; }
.pv-unit-badge--kol { background: #10b981; }
.pv-unit-name { font-size: 10px; color: var(--tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-empty-nav { font-size: 10px; color: var(--tx3); padding: 4px 8px; font-style: italic; }

.pv-meta-card {
  margin: 12px; padding: 10px 14px; background: var(--bg2);
  border: 1px solid var(--border); border-radius: 6px;
  display: flex; flex-wrap: wrap; gap: 6px 20px;
}
.pv-meta-row   { display: flex; gap: 6px; align-items: baseline; }
.pv-meta-lbl   { font-size: 8px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; text-transform: uppercase; letter-spacing: .04em; }
.pv-meta-val   { font-size: 11px; color: var(--tx1); }

.pv-units-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px; padding: 0 12px 12px;
}
.pv-unit-card {
  background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  padding: 10px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 4px;
  transition: border-color .15s, background .15s;
}
.pv-unit-card:hover { border-color: var(--accent); background: var(--bg3); }

.pv-uc-top  { display: flex; align-items: center; gap: 6px; }
.pv-uc-type {
  font-family: Archivo, system-ui, sans-serif; font-size: 8px; font-weight: 700;
  padding: 1px 5px; border-radius: 2px; background: var(--accent); color: #fff;
}
.pv-uc-type--emk { background: #8b5cf6; }
.pv-uc-type--kol { background: #10b981; }
.pv-uc-status { font-size: 9px; color: var(--tx3); }
.pv-uc-status--approved { color: #10b981; }
.pv-uc-status--review   { color: #f59e0b; }
.pv-uc-date   { margin-left: auto; font-size: 9px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; }

.pv-uc-title  { font-size: 12px; font-weight: 600; color: var(--tx1); }
.pv-uc-params { display: flex; flex-wrap: wrap; gap: 4px; }
.pv-uc-param  {
  font-family: Archivo, system-ui, sans-serif; font-size: 9px; color: var(--tx3);
  background: var(--bg1); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px;
}
.pv-uc-total  {
  font-family: Archivo, system-ui, sans-serif; font-size: 11px; font-weight: 700;
  color: var(--accent); text-align: right;
}
.dash-state     { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 12px; color: var(--tx3); }
.dash-err       { color: var(--danger); }
.pv-uc-del {
  margin-left: auto; background: transparent; border: none; color: var(--tx3);
  font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px;
  transition: color .12s;
}
.pv-uc-del:hover { color: var(--danger); }
</style>
