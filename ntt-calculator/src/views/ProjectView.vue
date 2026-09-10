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
            @click="openUnit(e.id)"
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
        <template v-if="canEdit">
          <button class="btn btn-g" @click="openEditProject">Редактировать</button>
          <!-- Главное действие проекта — акцентной кнопкой, как «Создать
               проект» на дашборде: серой она терялась среди служебных. -->
          <button class="btn btn-am" @click="addUnit">＋ Добавить единицу</button>
        </template>
        <!-- КП на проект доступно и наблюдателю: чтение документа шире правки
             расчёта — то же правило, что у КП на единицу. -->
        <button class="btn" :disabled="units.length === 0" @click="openKp">КП на проект</button>
        <span v-if="!canEdit" v-hint.plain="'Роль «Наблюдатель»: только просмотр'" class="pv-ro">👁 просмотр</span>
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
          <div v-if="projects.current.estimates.length === 0" class="dash-state" style="height:auto;padding:32px 0">
            <div class="dash-state-txt">Единиц оборудования нет</div>
            <button v-if="canEdit" class="btn btn-am" @click="addUnit">＋ Добавить первую единицу</button>
          </div>

          <div v-else class="pv-units-grid">
            <div
              v-for="e in projects.current.estimates" :key="e.id"
              class="pv-unit-card"
              @click="openUnit(e.id)"
            >
              <div class="pv-uc-top">
                <span class="pv-uc-type" :class="`pv-uc-type--${e.deviceType.toLowerCase()}`">{{ e.deviceType }}</span>
                <span class="pv-uc-status" :class="`pv-uc-status--${e.status.toLowerCase()}`">{{ STATUS_LABELS[e.status] }}</span>
                <span class="pv-uc-date">{{ fmtDate(e.updatedAt) }}</span>
                <button
                  v-if="canEdit && (e.status === 'DRAFT' || e.status === 'CALC' || e.status === 'REJECTED')"
                  v-hint="'Удалить единицу'"
                  class="pv-uc-del"
                  aria-label="Удалить единицу"
                  @click.stop="askDeleteEstimate(e)"
                >×</button>
              </div>
              <div class="pv-uc-title">{{ e.title }}</div>
              <div class="pv-uc-params" v-if="techParams(e).length">
                <span v-for="p in techParams(e)" :key="p" class="pv-uc-param">{{ p }}</span>
              </div>
              <div class="pv-uc-foot">
                <!-- Карточка открывает ОЛ; в расчёт — отдельной ссылкой, для
                     тонкой настройки строк. -->
                <button v-hint="'Открыть расчёт: строки, цены и итоги. Сама карточка открывает опросный лист'" class="pv-uc-calc" @click.stop="openCalc(e.id)">расчёт →</button>
                <span v-if="e.totalRub" class="pv-uc-total">{{ fmt(e.totalRub) }} ₽</span>
              </div>
            </div>

            <!-- «Добавить единицу» остаётся на виду и когда единицы уже есть:
                 раньше кнопка жила только в пустом состоянии и после первой же
                 единицы исчезала, а в шапке её замечали не сразу. Плитка стоит
                 последней в сетке — там, где взгляд заканчивает список. -->
            <button v-if="canEdit" class="pv-unit-add" @click="addUnit">
              ＋ Добавить единицу
            </button>
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
      <div style="font-size:14.4px;color:var(--tx2)">
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

    <!-- КП на проект: состав документа выбирается здесь -->
    <BaseModal :show="kpOpen" title="КП на проект" @close="kpOpen = false">
      <p class="pv-kp-sub">
        В документ войдёт по позиции на каждую отмеченную единицу — со своей
        спецификацией и своей ценой. Цена берётся из выпущенного КП, а не из
        текущего состояния расчёта.
      </p>

      <ul class="pv-kp-list">
        <li v-for="u in units" :key="u.id" class="pv-kp-item">
          <label class="pv-kp-lbl" :class="{ 'is-off': !kpReady(u) }">
            <input
              type="checkbox"
              :checked="kpPicked.has(u.id)"
              :disabled="!kpReady(u)"
              @change="toggleKpUnit(u.id)"
            />
            <span class="pv-kp-title">{{ u.title }}</span>
          </label>
          <span class="pv-kp-state">
            <template v-if="kpReady(u)">редакция {{ u.snapshots?.[0]?.version }}</template>
            <template v-else>КП не выпускалось</template>
          </span>
          <span class="pv-kp-sum">{{ u.totalRub ? `${fmt(u.totalRub)} ₽` : '—' }}</span>
        </li>
      </ul>

      <!-- Единицу без выпущенного КП в документ не поставить: цена берётся из
           снапшота, а его нет. Путь один — открыть расчёт и выпустить КП. -->
      <p v-if="kpNotReady.length" class="pv-kp-note">
        Не войдут в документ: {{ kpNotReady.map(u => u.title).join(', ') }} — по ним ещё
        не выпускалось КП. Откройте расчёт и нажмите «Выпустить КП».
      </p>
      <div v-if="kpError" class="auth-err" style="margin-top:8px">{{ kpError }}</div>

      <template #footer>
        <button class="btn btn-g" @click="kpOpen = false">Отмена</button>
        <button class="btn" :disabled="kpBusy !== null || kpPicked.size === 0" @click="downloadProjectKp('docx')">
          {{ kpBusy === 'docx' ? 'Готовим…' : 'Скачать .docx' }}
        </button>
        <button class="btn btn-am" :disabled="kpBusy !== null || kpPicked.size === 0" @click="downloadProjectKp('pdf')">
          {{ kpBusy === 'pdf' ? 'Готовим…' : 'Скачать .pdf' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import { useAuthStore } from '@/stores/auth'
import { projectsApi } from '@/api/projects'
import { estimatesApi, type EstimateStatus } from '@/api/estimates'
import type { ProjectEstimate } from '@/api/projects'
import BaseModal    from '@/components/ui/BaseModal.vue'
import ThemeToggle  from '@/components/ui/ThemeToggle.vue'
import { fmt } from '@/engines/format'

const route    = useRoute()
const router   = useRouter()
const projects = useProjectsStore()
const auth     = useAuthStore()

/** VIEWER — наблюдатель: проект и расчёты открыты только для просмотра. */
const canEdit = computed(() => auth.role !== 'VIEWER')

const projectId = String(route.params.id)

/**
 * Новая единица создаётся через ЕДИНЫЙ опросный лист (/survey?project=…):
 * прежний краткий модал сохранял surveyData в форме, которую материализатор
 * не понимал, — расчёт открывался пустым.
 */
function addUnit() {
  router.push({ name: 'survey', query: { project: projectId } })
}

/**
 * Единица открывается опросным листом, а не расчётом.
 *
 * Изделие в проекте создаётся и живёт в ОЛ: правка ОЛ сама пересобирает
 * расчёт, так что в ОЛ инженер видит и параметры, и итог. В расчёт — для
 * тонкой настройки строк — ведёт отдельная ссылка на карточке и кнопка в ОЛ.
 *
 * Наблюдателю ОЛ закрыт (экран редактирующий — каждая правка сохраняется),
 * поэтому карточка ведёт его в расчёт, открытый только для просмотра. Иначе
 * роутер отбрасывал его с карточки на дашборд.
 */
function openUnit(id: string) {
  if (!canEdit.value) return openCalc(id)
  router.push({ name: 'survey', params: { id } })
}

function openCalc(id: string) {
  router.push({ name: 'calculator', params: { id } })
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

// ── КП на проект ────────────────────────────────────────────────────────────
//
// Документ собирается из снапшотов единиц, поэтому единица без выпущенного КП
// в него не войдёт. Показываем это ДО отправки: иначе сервер откажет 422, и
// инженер узнает о непроработанной единице из ошибки.
const kpOpen = ref(false)
const kpBusy = ref<'docx' | 'pdf' | null>(null)
const kpError = ref('')
const kpPicked = ref<Set<string>>(new Set())

const units = computed<ProjectEstimate[]>(() => projects.current?.estimates ?? [])

/** Единица готова к КП, если по ней есть хотя бы одна редакция. */
function kpReady(u: ProjectEstimate): boolean {
  return (u.snapshots?.length ?? 0) > 0
}

const kpNotReady = computed(() => units.value.filter((u) => !kpReady(u)))

function openKp() {
  // По умолчанию отмечено всё готовое: обычный случай — КП на весь проект.
  kpPicked.value = new Set(units.value.filter(kpReady).map((u) => u.id))
  kpError.value = ''
  kpOpen.value = true
}

function toggleKpUnit(id: string) {
  const next = new Set(kpPicked.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  kpPicked.value = next
}

/**
 * Разбор ошибки запроса, ответ которого — blob.
 *
 * При `responseType: 'blob'` тело ошибки тоже приходит блобом, и обычное
 * `data.message` в нём не читается: без этого пользователь видел бы «Ошибка»
 * вместо «по единице X не выпускалось КП».
 */
async function messageFromBlobError(e: unknown): Promise<string> {
  const data = (e as { response?: { data?: unknown } }).response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text()) as { message?: string }
      if (parsed.message) return parsed.message
    } catch {
      // Не JSON — покажем общий текст ниже.
    }
  }
  const msg = (data as { message?: string } | undefined)?.message
  return msg ?? (e instanceof Error ? e.message : 'Не удалось выгрузить КП')
}

async function downloadProjectKp(format: 'docx' | 'pdf') {
  if (kpPicked.value.size === 0) return
  kpBusy.value = format
  kpError.value = ''
  try {
    const picked = units.value.filter((u) => kpPicked.value.has(u.id)).map((u) => u.id)
    const blob = await projectsApi.kpExport(projectId, format, picked)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `КП_${projects.current?.title ?? 'проект'}.${format}`
    a.click()
    URL.revokeObjectURL(url)
    kpOpen.value = false
  } catch (e) {
    kpError.value = await messageFromBlobError(e)
  } finally {
    kpBusy.value = null
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
.pv-ro { font-size: 12px; color: var(--tx3); border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px; }

.pv-unit-link {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 4px;
  cursor: pointer; transition: background .12s;
}
.pv-unit-link:hover { background: var(--bg3); }
.pv-unit-badge {
  font-family: Archivo, system-ui, sans-serif; font-size: 9.6px; font-weight: 700;
  padding: 1px 4px; border-radius: 2px; background: var(--accent); color: #fff; flex-shrink: 0;
}
.pv-unit-badge--emk { background: #8b5cf6; }
.pv-unit-badge--kol { background: #10b981; }
.pv-unit-name { font-size: 12px; color: var(--tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-empty-nav { font-size: 12px; color: var(--tx3); padding: 4px 8px; font-style: italic; }

.pv-meta-card {
  margin: 12px; padding: 10px 14px; background: var(--bg2);
  border: 1px solid var(--border); border-radius: 6px;
  display: flex; flex-wrap: wrap; gap: 6px 20px;
}
.pv-meta-row   { display: flex; gap: 6px; align-items: baseline; }
.pv-meta-lbl   { font-size: 9.6px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; text-transform: uppercase; letter-spacing: .04em; }
.pv-meta-val   { font-size: 13.2px; color: var(--tx1); }

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

/* Плитка «добавить» — того же размера, что карточка единицы, но пунктиром и
   акцентом: это действие, а не единица оборудования. */
.pv-unit-add {
  border: 1px dashed var(--accent); border-radius: 6px; background: transparent;
  color: var(--accent); font: inherit; font-size: 13.2px; font-weight: 600;
  padding: 10px 12px; min-height: 84px; cursor: pointer;
  transition: background .15s;
}
.pv-unit-add:hover { background: var(--bg3); }

/* Список единиц в окне «КП на проект» */
.pv-kp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.pv-kp-item { display: flex; align-items: center; gap: 8px; padding: 5px 6px; border-radius: 4px; }
.pv-kp-item:hover { background: var(--bg3); }
.pv-kp-lbl { display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; cursor: pointer; }
/* Единица без выпущенного КП — видна, но приглушена: это состояние, а не
   отсутствие. Скрывать её нельзя, иначе состав документа читается неверно. */
.pv-kp-lbl.is-off { cursor: default; opacity: .55; }
.pv-kp-title { font-size: 13.2px; color: var(--tx1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pv-kp-state { font-size: 11.4px; color: var(--tx3); white-space: nowrap; }
.pv-kp-sum { font-size: 12px; color: var(--tx2); white-space: nowrap; min-width: 96px; text-align: right; }
.pv-kp-note { font-size: 12px; color: var(--tx3); line-height: 1.5; margin: 10px 0 0; }
.pv-kp-sub { font-size: 12.6px; color: var(--tx2); line-height: 1.5; margin: 0 0 10px; }

.pv-uc-top  { display: flex; align-items: center; gap: 6px; }
.pv-uc-type {
  font-family: Archivo, system-ui, sans-serif; font-size: 9.6px; font-weight: 700;
  padding: 1px 5px; border-radius: 2px; background: var(--accent); color: #fff;
}
.pv-uc-type--emk { background: #8b5cf6; }
.pv-uc-type--kol { background: #10b981; }
.pv-uc-status { font-size: 10.8px; color: var(--tx3); }
.pv-uc-status--approved { color: #10b981; }
.pv-uc-status--review   { color: #f59e0b; }
.pv-uc-date   { margin-left: auto; font-size: 10.8px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; }

.pv-uc-title  { font-size: 14.4px; font-weight: 600; color: var(--tx1); }
.pv-uc-params { display: flex; flex-wrap: wrap; gap: 4px; }
.pv-uc-param  {
  font-family: Archivo, system-ui, sans-serif; font-size: 10.8px; color: var(--tx3);
  background: var(--bg1); border: 1px solid var(--border); border-radius: 3px; padding: 1px 5px;
}
.pv-uc-total  {
  font-family: Archivo, system-ui, sans-serif; font-size: 13.2px; font-weight: 700;
  color: var(--accent); text-align: right; margin-left: auto;
}
/* Низ карточки: слева путь в расчёт, справа итог. */
.pv-uc-foot { display: flex; align-items: baseline; gap: 8px; margin-top: 2px; }
.pv-uc-calc {
  background: none; border: none; padding: 0; cursor: pointer; font: inherit;
  font-size: 11.4px; color: var(--tx3); border-bottom: 1px dashed currentColor;
}
.pv-uc-calc:hover { color: var(--tx1); border-bottom-style: solid; }
.dash-state     { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 14.4px; color: var(--tx3); }
.dash-err       { color: var(--danger); }
.pv-uc-del {
  margin-left: auto; background: transparent; border: none; color: var(--tx3);
  font-size: 16.8px; line-height: 1; cursor: pointer; padding: 0 2px;
  transition: color .12s;
}
.pv-uc-del:hover { color: var(--danger); }
</style>
