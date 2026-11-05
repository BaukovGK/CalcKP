<template>
  <!-- Битрикс24: вкладка «Калькулятор» в карточке сделки
       (doc/План_Б24_сделка.md, этап 2). Портал регистрирует её только по
       ключу администратора портала — его берём у того, кто нажал кнопку. -->
  <div class="calc-area">
    <p class="b24-note">
      Вкладка «Калькулятор» в карточке сделки открывает калькулятор сразу на этой сделке.
      Подключить или отключить её может сотрудник, который одновременно администратор
      калькулятора и администратор Битрикс24. Для этого он должен хотя бы раз открыть
      калькулятор из портала.
    </p>

    <div v-if="loading" class="dash-state"><div class="dash-state-txt">Спрашиваем портал…</div></div>
    <template v-else>
      <p v-if="error" class="b24-err" role="alert">{{ error }}</p>
      <div v-if="state" class="b24-card">
        <div class="b24-row">
          <span class="b24-k">Вкладка в сделках</span>
          <span class="b24-st" :class="statusClass">{{ statusText }}</span>
        </div>
        <div class="b24-row">
          <span class="b24-k">Адрес обработчика</span>
          <code class="b24-v">{{ state.handler ?? 'не задан PUBLIC_URL с https' }}</code>
        </div>
        <div v-if="state.bound && !state.current" class="b24-row">
          <span class="b24-k">Сейчас в портале</span>
          <code class="b24-v">{{ state.handlers.join(', ') }}</code>
        </div>
        <div class="b24-acts">
          <button
            v-if="!state.current"
            class="btn btn-acc"
            :disabled="busy || !state.handler"
            @click="bind"
          >{{ state.bound ? 'Переподключить' : 'Подключить вкладку в сделках' }}</button>
          <button v-if="state.bound" class="btn" :disabled="busy" @click="askUnbind = true">Отключить</button>
          <button class="btn btn-g" :disabled="busy" @click="load">↻ Проверить</button>
        </div>
      </div>
      <button v-else class="btn btn-g" @click="load">Повторить</button>
    </template>

    <BaseModal :show="askUnbind" title="Отключить вкладку" @close="askUnbind = false">
      <p class="b24-note">
        Вкладка «Калькулятор» пропадёт из карточки сделки у всех сотрудников. Расчёты и КП
        в калькуляторе останутся, комментарии в лентах сделок тоже. Подключить вкладку
        обратно можно здесь же.
      </p>
      <template #footer>
        <button class="btn" @click="askUnbind = false">Отмена</button>
        <button class="btn btn-acc" :disabled="busy" @click="unbind">Отключить</button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { b24AdminApi, type DealTabState } from '@/api/admin'
import { apiErrorMessage } from '@/utils/api-error'
import BaseModal from '@/components/ui/BaseModal.vue'

const state = ref<DealTabState | null>(null)
const askUnbind = ref(false)
const loading = ref(true)
const busy = ref(false)
const error = ref('')

const statusText = computed(() => {
  const s = state.value
  if (!s?.bound) return 'не подключена'
  return s.current ? 'подключена' : 'подключена на другой адрес'
})
const statusClass = computed(() => {
  const s = state.value
  return s?.current ? 'b24-st--ok' : s?.bound ? 'b24-st--warn' : ''
})

async function run(fn: () => Promise<DealTabState>, fallback: string) {
  error.value = ''
  try {
    state.value = await fn()
  } catch (e) {
    error.value = apiErrorMessage(e, fallback)
  }
}

async function load() {
  loading.value = true
  await run(b24AdminApi.dealTab, 'Не удалось узнать состояние вкладки у портала')
  loading.value = false
}

async function bind() {
  busy.value = true
  await run(b24AdminApi.bindDealTab, 'Не удалось подключить вкладку')
  busy.value = false
}

async function unbind() {
  askUnbind.value = false
  busy.value = true
  await run(b24AdminApi.unbindDealTab, 'Не удалось отключить вкладку')
  busy.value = false
}

onMounted(load)
defineExpose({ load })
</script>

<style scoped>
.b24-note { font-size: 13.5px; color: var(--tx3); line-height: 1.5; margin: 0 0 14px; max-width: 78ch; }
.b24-err  { font-size: 13.5px; color: var(--danger); margin: 0 0 12px; max-width: 78ch; }
.b24-card { max-width: 720px; padding: 16px 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg2); }
.b24-row  { display: flex; gap: 14px; align-items: baseline; margin-bottom: 10px; font-size: 13.5px; }
.b24-k    { width: 170px; flex-shrink: 0; color: var(--muted); }
.b24-v    { word-break: break-all; font-size: 12.5px; }
.b24-st   { font-weight: 600; }
.b24-st--ok   { color: var(--green); }
.b24-st--warn { color: var(--amber); }
.b24-acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
</style>
