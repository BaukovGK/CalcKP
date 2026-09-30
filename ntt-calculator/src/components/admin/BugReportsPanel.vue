<template>
  <div class="calc-area bgr">
    <div class="bgr-filters">
      <button
        v-for="f in FILTERS" :key="f.key"
        class="chip-f" :class="{ on: filter === f.key }"
        @click="filter = f.key"
      >{{ f.label }} {{ countOf(f.key) }}</button>
      <span class="bgr-dir">Хранятся на сервере в каталоге <code>bugreports/</code> — папка на отчёт.</span>
    </div>

    <div v-if="loading && !items.length" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
    <div v-else-if="listError" class="dash-state">
      <div class="dash-state-txt dash-err">{{ listError }}</div>
      <button class="btn btn-g" @click="load">Повторить</button>
    </div>
    <div v-else-if="!items.length" class="dash-state">
      <div class="dash-state-txt">Отчётов об ошибках пока нет</div>
    </div>

    <div v-else class="bgr-grid">
      <!-- ── Список ── -->
      <div class="bgr-list">
        <div v-if="!shown.length" class="dash-state state--inline">
          <div class="dash-state-txt">В этом отборе отчётов нет</div>
        </div>
        <button
          v-for="r in shown" :key="r.id"
          class="bgr-row" :class="{ 'is-sel': r.id === selectedId, 'is-new': r.status === 'new' }"
          @click="select(r.id)"
        >
          <span class="bgr-row-h">
            <span class="bgr-st" :class="`bgr-st--${r.status}`">{{ STATUS[r.status] }}</span>
            <span class="bgr-when">{{ fmtDateTime(r.createdAt) }}</span>
            <span class="bgr-who">{{ r.authorName ?? '—' }}</span>
            <span v-if="r.screenshots" v-hint.plain="`Скриншотов: ${r.screenshots}`" class="bgr-clip">▣ {{ r.screenshots }}</span>
          </span>
          <span class="bgr-ex">{{ r.excerpt }}</span>
          <span v-if="r.pageUrl" class="bgr-url">{{ r.pageUrl }}</span>
        </button>
      </div>

      <!-- ── Отчёт ── -->
      <div class="bgr-card">
        <div v-if="!selectedId" class="dash-state state--inline">
          <div class="dash-state-txt">Выберите отчёт в списке</div>
        </div>
        <div v-else-if="cardLoading && !report" class="dash-state state--inline">
          <div class="dash-state-txt">Загрузка…</div>
        </div>
        <div v-else-if="cardError" class="dash-state state--inline">
          <div class="dash-state-txt dash-err">{{ cardError }}</div>
        </div>
        <template v-else-if="report">
          <div class="bgr-card-h">
            <div>
              <div class="bgr-id">{{ report.id }}</div>
              <div class="bgr-meta">{{ fmtDateTime(report.createdAt) }}<template v-if="report.updatedAt !== report.createdAt"> · изменён {{ fmtDateTime(report.updatedAt) }}</template></div>
            </div>
            <select class="fi bgr-status" :value="report.status" :disabled="saving" @change="setStatus(($event.target as HTMLSelectElement).value as BugReportStatus)">
              <option v-for="(label, key) in STATUS" :key="key" :value="key">{{ label }}</option>
            </select>
          </div>

          <dl class="bgr-dl">
            <dt>Автор</dt>
            <dd>
              <template v-if="report.author">
                {{ report.author.name }} · {{ report.author.email }} · {{ roleLabels[report.author.role] ?? report.author.role }}
              </template>
              <template v-else>—</template>
            </dd>
            <dt>Экран</dt>
            <dd>
              {{ report.page.title ?? '—' }}
              <RouterLink v-if="inAppUrl(report.page.url)" class="bgr-open" :to="report.page.url!">{{ report.page.url }}</RouterLink>
              <span v-else-if="report.page.url" class="bgr-url">{{ report.page.url }}</span>
            </dd>
            <dt>Окно</dt>
            <dd>{{ report.client.viewport ?? '—' }}</dd>
            <dt>Браузер</dt>
            <dd class="bgr-ua">{{ report.client.userAgent ?? '—' }}</dd>
          </dl>

          <div class="sec-h">Что случилось</div>
          <div class="bgr-text">{{ report.text }}</div>

          <template v-if="report.screenshots.length">
            <div class="sec-h">Скриншоты</div>
            <div class="bgr-shots">
              <button
                v-for="s in report.screenshots" :key="s.name"
                v-hint.plain="'Открыть во весь размер'"
                class="bgr-shot"
                @click="viewer = s.name"
              >
                <img v-if="images[s.name]" :src="images[s.name]" :alt="s.originalName ?? s.name" />
                <span v-else class="bgr-shot-ph">{{ imageErrors[s.name] ? 'не загрузился' : 'загрузка…' }}</span>
                <span class="bgr-shot-c">{{ s.originalName ?? s.name }} · {{ fileSizeLabel(s.sizeBytes) }}</span>
              </button>
            </div>
          </template>

          <div class="sec-h">Пометка администратора</div>
          <textarea v-model="note" class="fi bgr-note" rows="3" maxlength="2000" placeholder="Что сделано, в какой версии исправлено"></textarea>
          <div class="bgr-acts">
            <button class="btn" :disabled="saving || note === (report.adminNote ?? '')" @click="saveNote">Сохранить пометку</button>
            <span v-if="saveError" class="bgr-save-err">{{ saveError }}</span>
            <span class="tb-spacer"></span>
            <button class="btn btn-g bgr-del" :disabled="saving" @click="confirmDelete = true">Удалить отчёт</button>
          </div>
        </template>
      </div>
    </div>

    <!-- Скриншот во весь размер: в карточке он превью. -->
    <div v-if="viewer && images[viewer]" class="mo bgr-viewer" @click.self="viewer = ''">
      <div class="bgr-viewer-box">
        <div class="bgr-viewer-h">
          <span>{{ viewerName }}</span>
          <a class="btn btn-xs" :href="images[viewer]" :download="`${selectedId}-${viewer}`">скачать</a>
          <button class="ib" aria-label="Закрыть" @click="viewer = ''">✕</button>
        </div>
        <div class="bgr-viewer-img"><img :src="images[viewer]" :alt="viewerName" /></div>
      </div>
    </div>

    <BaseModal :show="confirmDelete" title="Удалить отчёт" @close="confirmDelete = false">
      <p class="adm-p">
        Отчёт {{ report?.id }} удалится вместе со скриншотами — с диска сервера, без возможности вернуть.
        Если ошибка исправлена, лучше закрыть отчёт: он останется в истории.
      </p>
      <template #footer>
        <button class="btn btn-g" @click="confirmDelete = false">Отмена</button>
        <button class="btn btn-danger" :disabled="saving" @click="remove">Удалить</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
/**
 * Отчёты об ошибках — раздел администрирования.
 *
 * Слева список (свежие первыми, отбор по статусу), справа выбранный отчёт:
 * кто, с какого экрана, в каком окне и браузере, текст, скриншоты во весь
 * размер по щелчку, статус и пометка администратора. Адрес экрана — ссылка:
 * по ней открывается то самое место, откуда пришёл отчёт.
 *
 * Скриншоты грузятся файлами (`bugReportsApi.file`) и показываются через
 * blob-ссылки: `<img src>` на адрес API ушёл бы без токена. Ссылки
 * освобождаются при смене отчёта и уходе с экрана.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import {
  BUG_REPORT_STATUS_LABELS as STATUS,
  bugReportsApi,
  type BugReport,
  type BugReportStatus,
  type BugReportSummary,
} from '@/api/bugReports'
import { apiErrorMessage } from '@/utils/api-error'
import { fileSizeLabel } from '@/utils/bug-report'

defineProps<{
  /** Роли по-русски — те же, что в таблице пользователей. */
  roleLabels: Readonly<Record<string, string>>
}>()

const emit = defineEmits<{
  /** Сколько новых — для счётчика у пункта меню. */
  'new-count': [count: number]
}>()

type FilterKey = 'open' | BugReportStatus | 'all'
const FILTERS: ReadonlyArray<{ key: FilterKey; label: string }> = [
  { key: 'open', label: 'Открытые' },
  { key: 'new', label: 'Новые' },
  { key: 'in_progress', label: 'В работе' },
  { key: 'resolved', label: 'Закрытые' },
  { key: 'all', label: 'Все' },
]

const items = ref<BugReportSummary[]>([])
const loading = ref(false)
const listError = ref('')
/** По умолчанию — незакрытые: закрытые нужны реже, как история. */
const filter = ref<FilterKey>('open')

const selectedId = ref('')
const report = ref<BugReport | null>(null)
const cardLoading = ref(false)
const cardError = ref('')
const note = ref('')
const saving = ref(false)
const saveError = ref('')
const confirmDelete = ref(false)

/** Превью скриншотов выбранного отчёта: имя файла → blob-ссылка. */
const images = reactive<Record<string, string>>({})
const imageErrors = reactive<Record<string, boolean>>({})
const viewer = ref('')

const matches = (r: BugReportSummary, key: FilterKey) =>
  key === 'all' ? true : key === 'open' ? r.status !== 'resolved' : r.status === key

const shown = computed(() => items.value.filter((r) => matches(r, filter.value)))
const countOf = (key: FilterKey) => items.value.filter((r) => matches(r, key)).length

const viewerName = computed(() => {
  const s = report.value?.screenshots.find((x) => x.name === viewer.value)
  return s?.originalName ?? s?.name ?? ''
})

/** Адрес экрана внутри приложения: ссылкой делаем только такой. */
function inAppUrl(url: string | null): boolean {
  return !!url && url.startsWith('/') && !url.startsWith('//')
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function releaseImages() {
  for (const url of Object.values(images)) URL.revokeObjectURL(url)
  for (const k of Object.keys(images)) delete images[k]
  for (const k of Object.keys(imageErrors)) delete imageErrors[k]
  viewer.value = ''
}

async function load() {
  loading.value = true
  listError.value = ''
  try {
    const r = await bugReportsApi.list()
    items.value = r.items
    emit('new-count', r.newCount)
  } catch (e) {
    listError.value = apiErrorMessage(e, 'Не удалось получить список отчётов')
  } finally {
    loading.value = false
  }
}

async function loadImages(r: BugReport) {
  await Promise.all(
    r.screenshots.map(async (s) => {
      try {
        const blob = await bugReportsApi.file(r.id, s.name)
        // Пока грузилось, могли выбрать другой отчёт — чужое превью не нужно.
        if (selectedId.value !== r.id) return
        images[s.name] = URL.createObjectURL(blob)
      } catch {
        if (selectedId.value === r.id) imageErrors[s.name] = true
      }
    }),
  )
}

async function select(id: string) {
  if (id === selectedId.value) return
  releaseImages()
  selectedId.value = id
  report.value = null
  cardError.value = ''
  saveError.value = ''
  cardLoading.value = true
  try {
    const r = await bugReportsApi.get(id)
    if (selectedId.value !== id) return
    report.value = r
    note.value = r.adminNote ?? ''
    void loadImages(r)
  } catch (e) {
    if (selectedId.value === id) cardError.value = apiErrorMessage(e, 'Не удалось открыть отчёт')
  } finally {
    if (selectedId.value === id) cardLoading.value = false
  }
}

/** Отчёт изменился на сервере — строку списка и счётчик тоже поправить. */
function applyUpdated(r: BugReport) {
  report.value = r
  const row = items.value.find((x) => x.id === r.id)
  if (row) {
    row.status = r.status
    row.updatedAt = r.updatedAt
    row.hasNote = !!r.adminNote
  }
  emit('new-count', items.value.filter((x) => x.status === 'new').length)
}

async function patch(dto: { status?: BugReportStatus; adminNote?: string | null }) {
  const current = report.value
  if (!current) return
  saving.value = true
  saveError.value = ''
  try {
    applyUpdated(await bugReportsApi.update(current.id, dto))
  } catch (e) {
    saveError.value = apiErrorMessage(e, 'Не удалось сохранить')
  } finally {
    saving.value = false
  }
}

function setStatus(status: BugReportStatus) {
  if (report.value && status !== report.value.status) return patch({ status })
}

function saveNote() {
  return patch({ adminNote: note.value.trim() || null })
}

async function remove() {
  const current = report.value
  if (!current) return
  saving.value = true
  try {
    await bugReportsApi.remove(current.id)
    confirmDelete.value = false
    releaseImages()
    report.value = null
    selectedId.value = ''
    items.value = items.value.filter((x) => x.id !== current.id)
    emit('new-count', items.value.filter((x) => x.status === 'new').length)
  } catch (e) {
    saveError.value = apiErrorMessage(e, 'Не удалось удалить отчёт')
    confirmDelete.value = false
  } finally {
    saving.value = false
  }
}

onMounted(load)
onBeforeUnmount(releaseImages)

defineExpose({ load })
</script>

<style scoped>
.bgr { display: flex; flex-direction: column; gap: 10px; }
.bgr-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bgr-dir { margin-left: auto; font-size: 12.5px; color: var(--tx3); }
.bgr-dir code { font-size: 12px; }

.bgr-grid { display: grid; grid-template-columns: minmax(280px, 2fr) minmax(0, 3fr); gap: 12px; align-items: start; min-height: 0; }
@media (max-width: 1100px) { .bgr-grid { grid-template-columns: 1fr; } }

.bgr-list { display: flex; flex-direction: column; border: 1px solid var(--bd); background: var(--bg2); }
.bgr-row { display: flex; flex-direction: column; gap: 3px; text-align: left; padding: 8px 10px; border: none;
  border-bottom: 1px solid var(--bd); background: transparent; color: var(--tx2); font: inherit; cursor: pointer; }
.bgr-row:last-child { border-bottom: none; }
.bgr-row:hover { background: var(--bg3); }
.bgr-row.is-sel { background: var(--bg3); box-shadow: inset 3px 0 0 var(--acc); }
.bgr-row.is-new .bgr-ex { color: var(--tx); font-weight: 600; }
.bgr-row-h { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--tx3); }
.bgr-who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgr-clip { margin-left: auto; white-space: nowrap; }
.bgr-ex { font-size: 13.5px; line-height: 1.4; color: var(--tx2); overflow-wrap: anywhere; }
.bgr-url { font-size: 12px; color: var(--tx3); overflow-wrap: anywhere; }

.bgr-st { font-size: 11px; font-weight: 700; letter-spacing: .04em; padding: 0 5px; border: 1px solid currentColor; white-space: nowrap; }
.bgr-st--new { color: var(--acc); }
.bgr-st--in_progress { color: var(--amber); }
.bgr-st--resolved { color: var(--green); }

.bgr-card { border: 1px solid var(--bd); background: var(--bg2); padding: 12px 14px; min-width: 0; }
.bgr-card-h { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.bgr-id { font-size: 15px; font-weight: 700; color: var(--tx); overflow-wrap: anywhere; }
.bgr-meta { font-size: 12.5px; color: var(--tx3); margin-top: 2px; }
.bgr-status { width: auto; min-width: 130px; }
.bgr-dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 12px; font-size: 13.5px; margin: 0 0 6px; }
.bgr-dl dt { color: var(--tx3); }
.bgr-dl dd { margin: 0; color: var(--tx2); overflow-wrap: anywhere; }
.bgr-open { margin-left: 8px; color: var(--blue); font-size: 12.5px; }
.bgr-ua { font-size: 12px; color: var(--tx3); }
.bgr-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; color: var(--tx); }

.bgr-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 8px; }
.bgr-shot { display: flex; flex-direction: column; padding: 0; border: 1px solid var(--line); background: var(--panel); cursor: zoom-in; font: inherit; text-align: left; }
.bgr-shot:hover { border-color: var(--acc); }
.bgr-shot img, .bgr-shot-ph { display: block; width: 100%; height: 120px; object-fit: cover; object-position: top left; }
.bgr-shot-ph { display: flex; align-items: center; justify-content: center; font-size: 12px; color: var(--tx3); }
.bgr-shot-c { font-size: 11.5px; color: var(--tx3); padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.bgr-note { resize: vertical; line-height: 1.45; }
.bgr-acts { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.bgr-save-err { font-size: 12.5px; color: var(--danger); }
.bgr-del:hover:not(:disabled) { color: var(--danger); border-color: var(--danger); }

.bgr-viewer { z-index: 600; }
.bgr-viewer-box { display: flex; flex-direction: column; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); background: var(--bg2); border: 1px solid var(--bd3); }
.bgr-viewer-h { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--bd); font-size: 13px; color: var(--tx2); }
.bgr-viewer-h span { margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bgr-viewer-img { overflow: auto; }
.bgr-viewer-img img { display: block; max-width: none; }
.adm-p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.5; color: var(--tx2); }
</style>
