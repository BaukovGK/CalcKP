<template>
  <!-- Картинку можно бросить на любое место окна и вставить откуда угодно в
       нём: слушатели — на подложке, куда всплывают события из поля. -->
  <BaseModal
    :show="bugReportOpen"
    title="Сообщить о проблеме"
    :close-on-backdrop="false"
    class="bug-mo"
    @close="close"
    @paste="onPaste"
    @dragover.prevent="dragOver = true"
    @dragleave="dragOver = false"
    @drop.prevent="onDrop"
  >
    <template v-if="sent">
      <p class="bug-lead">
        Отчёт <b>{{ sent }}</b> отправлен. Спасибо — администратор увидит его в разделе «Отчёты об
        ошибках» вместе со скриншотами и адресом экрана.
      </p>
    </template>
    <template v-else>
      <p class="bug-lead">
        Опишите, что вы делали и что пошло не так: чего ожидали и что получилось вместо этого. Если
        ошибка в расчёте — какое значение неверно и каким должно быть. Скриншот сильно помогает: его
        можно вставить сюда (<kbd>Ctrl</kbd>+<kbd>V</kbd>), перетащить на окно или выбрать файлом.
      </p>
      <p class="bug-ctx">
        Приложится само: экран «{{ context.pageTitle }}» ({{ context.pageUrl }}), размер окна
        {{ context.viewport }}, браузер и ваша учётная запись.
      </p>

      <label class="fl" for="bug-text">Что случилось <span class="bug-req">*</span></label>
      <textarea
        id="bug-text"
        ref="textEl"
        v-model="text"
        class="fi bug-text"
        :class="{ 'is-over': dragOver }"
        rows="7"
        :maxlength="MAX_TEXT_LENGTH"
        placeholder="Например: в опросном листе КНС после смены DN напорного пропала подсказка по скорости"
        @keydown.ctrl.enter.prevent="send"
        @keydown.meta.enter.prevent="send"
      ></textarea>

      <div v-if="shots.length" class="bug-shots">
        <figure v-for="s in shots" :key="s.id" class="bug-shot">
          <img :src="s.url" :alt="s.file.name" />
          <figcaption>
            {{ s.file.name }} · {{ fileSizeLabel(s.file.size) }}<template v-if="s.shrunk"> · пережат</template>
          </figcaption>
          <button type="button" class="ib bug-shot-x" :aria-label="`Убрать ${s.file.name}`" @click="removeShot(s.id)">✕</button>
        </figure>
      </div>

      <div class="bug-tools">
        <label class="btn" :class="{ 'is-off': shots.length >= MAX_SCREENSHOTS }">
          Прикрепить скриншот
          <input
            type="file"
            :accept="SCREENSHOT_ACCEPT"
            multiple
            hidden
            :disabled="shots.length >= MAX_SCREENSHOTS"
            @change="onPick"
          />
        </label>
        <span class="bug-note">
          {{ shots.length }} из {{ MAX_SCREENSHOTS }} · PNG, JPEG, GIF, WebP до 4 МБ — крупнее пережмётся сам
        </span>
      </div>

      <ul v-if="problems.length" class="bug-problems">
        <li v-for="p in problems" :key="p">{{ p }}</li>
      </ul>
      <div v-if="error" class="auth-err bug-err">{{ error }}</div>
    </template>

    <template #footer>
      <template v-if="sent">
        <button class="btn btn-am" @click="close">Готово</button>
      </template>
      <template v-else>
        <span class="bug-keys">Ctrl+Enter — отправить</span>
        <button class="btn btn-g" @click="close">Отмена</button>
        <button class="btn btn-am" :disabled="!canSend" @click="send">
          {{ sending ? 'Отправляем…' : 'Отправить' }}
        </button>
      </template>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
/**
 * Окно «Сообщить о проблеме» — одно на всё приложение, открывается кнопкой в
 * оболочке любого экрана (`composables/useBugReport.ts`).
 *
 * В окне пояснение, поле для текста, скриншоты и «Отправить». Скриншот
 * вставляется из буфера (снимок экрана Win+Shift+S лежит там файлом),
 * перетаскивается на окно или выбирается файлом; крупный пережимается сам
 * (`utils/bug-report.ts`). Экран, размер окна и браузер прикладываются к
 * отчёту без участия сотрудника — по ним администратор находит, где искать.
 *
 * Окно живёт в `App.vue`, поверх любого экрана, поэтому черновик переживает
 * переход между экранами: закрыть окно, сделать снимок нужного места и
 * вернуться к тексту — обычный порядок. Очищается черновик только отправкой.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import BaseModal from '@/components/ui/BaseModal.vue'
import { bugReportsApi } from '@/api/bugReports'
import { bugReportOpen, closeBugReport, useDialogPresence } from '@/composables/useBugReport'
import { apiErrorMessage } from '@/utils/api-error'
import {
  fileSizeLabel,
  fitScreenshot,
  imagesFromTransfer,
  MAX_SCREENSHOTS,
  MAX_TEXT_LENGTH,
  pastedName,
  pickScreenshots,
  SCREENSHOT_ACCEPT,
  screenLabel,
} from '@/utils/bug-report'

interface Shot {
  id: number
  file: File
  /** Адрес превью: blob-ссылка, её освобождают при удалении. */
  url: string
  /** Файл был больше предела и пережат в JPEG. */
  shrunk: boolean
}

const route = useRoute()
useDialogPresence()

const text = ref('')
const shots = ref<Shot[]>([])
const problems = ref<string[]>([])
const error = ref('')
const sending = ref(false)
/** Номер отправленного отчёта — окно показывает «отправлено». */
const sent = ref('')
const dragOver = ref(false)
const textEl = ref<HTMLTextAreaElement | null>(null)
const context = ref({ pageUrl: '', pageTitle: '', viewport: '' })

let shotSeq = 0
let pastedSeq = 0

const canSend = computed(() => !sending.value && text.value.trim() !== '' && text.value.length <= MAX_TEXT_LENGTH)

/** Экран, с которого открыли окно: об ошибке сообщают там, где её видят. */
function captureContext() {
  context.value = {
    pageUrl: route.fullPath,
    pageTitle: screenLabel(route.name, document.title),
    viewport: `${window.innerWidth}×${window.innerHeight}`,
  }
}

/** Окно открыли — с этого экрана и отчёт; прежний «отправлено» уже ни к чему. */
watch(
  bugReportOpen,
  (open) => {
    if (!open) return
    captureContext()
    sent.value = ''
    error.value = ''
    void nextTick(() => textEl.value?.focus())
  },
  { immediate: true },
)

function close() {
  closeBugReport()
  dragOver.value = false
  problems.value = []
  if (sent.value) sent.value = ''
}

async function addFiles(files: File[], pasted: boolean) {
  const { accepted, problems: found } = pickScreenshots(shots.value.length, files)
  const out = [...found]
  for (const f of accepted) {
    // У вставленного из буфера имя всегда «image.png» — даём своё.
    const named = pasted ? new File([f], pastedName(++pastedSeq, f.type), { type: f.type }) : f
    const fitted = await fitScreenshot(named)
    if (!fitted) {
      out.push(`«${named.name}» больше 4 МБ, и пережать его не вышло — обрежьте снимок до нужного места`)
    } else if (shots.value.length >= MAX_SCREENSHOTS) {
      out.push(`Скриншотов не больше ${MAX_SCREENSHOTS} — «${named.name}» не добавлен`)
    } else {
      shots.value.push({ id: ++shotSeq, file: fitted, url: URL.createObjectURL(fitted), shrunk: fitted !== named })
    }
  }
  problems.value = out
}

function onPaste(e: ClipboardEvent) {
  if (sent.value) return
  const images = imagesFromTransfer(e.clipboardData)
  // Текст вставляется как обычно — перехватываются только картинки.
  if (!images.length) return
  e.preventDefault()
  void addFiles(images, true)
}

function onDrop(e: DragEvent) {
  dragOver.value = false
  if (sent.value) return
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length) void addFiles(files, false)
}

function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = '' // повторный выбор того же файла должен сработать снова
  if (files.length) void addFiles(files, false)
}

function removeShot(id: number) {
  const s = shots.value.find((x) => x.id === id)
  if (s) URL.revokeObjectURL(s.url)
  shots.value = shots.value.filter((x) => x.id !== id)
}

function clearDraft() {
  for (const s of shots.value) URL.revokeObjectURL(s.url)
  shots.value = []
  text.value = ''
  problems.value = []
}

async function send() {
  if (!canSend.value) return
  sending.value = true
  error.value = ''
  try {
    const r = await bugReportsApi.send({
      text: text.value.trim(),
      ...context.value,
      screenshots: shots.value.map((s) => s.file),
    })
    sent.value = r.id
    clearDraft()
  } catch (e) {
    error.value = apiErrorMessage(e, 'Не удалось отправить отчёт — попробуйте ещё раз')
  } finally {
    sending.value = false
  }
}

// Выход из системы убирает окно вместе с черновиком: следующий сотрудник за
// этим браузером не должен ни увидеть чужой текст, ни войти с открытым окном.
onBeforeUnmount(() => {
  clearDraft()
  closeBugReport()
})
</script>

<style scoped>
.bug-mo :deep(.mo-box) { width: 640px; }
.bug-lead { font-size: 13.5px; line-height: 1.5; color: var(--tx2); margin: 0 0 8px; }
.bug-lead kbd { font: inherit; font-size: 12px; padding: 0 4px; border: 1px solid var(--line2); background: var(--panel2); }
.bug-ctx { font-size: 12.5px; line-height: 1.45; color: var(--faint); margin: 0 0 12px; overflow-wrap: anywhere; }
.bug-req { color: var(--danger); }
.bug-text { resize: vertical; min-height: 120px; line-height: 1.45; }
.bug-text.is-over { border-color: var(--acc); background: var(--acc-bg); }

.bug-shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; margin-top: 10px; }
.bug-shot { position: relative; margin: 0; border: 1px solid var(--line); background: var(--panel); }
.bug-shot img { display: block; width: 100%; height: 90px; object-fit: cover; object-position: top left; }
.bug-shot figcaption { font-size: 11.5px; color: var(--faint); padding: 3px 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bug-shot-x { position: absolute; top: 3px; right: 3px; background: var(--panel2); border-color: var(--line2); }

.bug-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-top: 10px; }
.bug-tools .btn.is-off { opacity: .45; pointer-events: none; }
.bug-note { font-size: 12.5px; color: var(--faint); }
.bug-problems { list-style: none; margin: 8px 0 0; padding: 0; font-size: 12.5px; color: var(--amber); line-height: 1.5; }
.bug-err { margin: 10px 0 0; }
.bug-keys { margin-right: auto; align-self: center; font-size: 12px; color: var(--faint); }

@media (max-width: 760px) {
  .bug-keys { display: none; }
}
</style>
