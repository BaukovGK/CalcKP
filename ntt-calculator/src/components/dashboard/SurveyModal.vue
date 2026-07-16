<template>
  <BaseModal :show="show" title="Новый расчёт стоимости" :close-on-backdrop="false" @close="$emit('close')">

    <!-- ── Шаг 1: Основные данные ── -->
    <div class="sv-section">
      <div class="sv-section-title">Единица оборудования</div>
      <div class="ff">
        <label class="fl">Обозначение <span class="sv-req">*</span></label>
        <input class="fi" v-model="form.title"
          placeholder="КНС DN3000, КНС-1, ЕМК-2…"
          @keydown.enter.prevent />
      </div>
      <div class="ff">
        <label class="fl">Тип изделия <span class="sv-req">*</span></label>
        <div class="sv-type-row">
          <button
            v-for="t in DEVICE_TYPES" :key="t.value"
            class="sv-type-btn"
            :class="{ active: form.deviceType === t.value }"
            @click="form.deviceType = t.value"
            type="button"
          >
            <span class="sv-type-code">{{ t.value }}</span>
            <span class="sv-type-label">{{ t.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Шаг 2: КНС ── -->
    <template v-if="form.deviceType === 'KNS'">
      <div class="sv-section">
        <div class="sv-section-title">Корпус КНС</div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Диаметр DN, мм <span class="sv-req">*</span></label>
            <select class="fi" v-model.number="form.kns.dn">
              <option v-for="d in KNS_DN" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Длина корпуса L, м <span class="sv-req">*</span></label>
            <input class="fi" type="number" step="0.1" min="0.5" v-model.number="form.kns.l"
              placeholder="11.5" />
          </div>
        </div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Рабочее давление PN, МПа</label>
            <select class="fi" v-model="form.kns.pn">
              <option value="0.1">PN 0.1</option>
              <option value="0.4">PN 0.4</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Кольцевая жёсткость SN</label>
            <select class="fi" v-model.number="form.kns.sn">
              <option value="2500">SN 2500</option>
              <option value="5000">SN 5000</option>
              <option value="10000">SN 10000</option>
            </select>
          </div>
        </div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Глубина заложения, м</label>
            <input class="fi" type="number" step="0.1" min="1" v-model.number="form.kns.depth"
              placeholder="5.0" />
          </div>
          <div class="ff">
            <label class="fl">Тип перекрытия</label>
            <select class="fi" v-model="form.kns.cover">
              <option value="flat">Плоское</option>
              <option value="cone">Конусное</option>
              <option value="none">Без перекрытия</option>
            </select>
          </div>
        </div>
      </div>
      <div class="sv-section">
        <div class="sv-section-title">Насосное оборудование</div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Кол-во рабочих насосов</label>
            <input class="fi" type="number" min="1" max="6" v-model.number="form.kns.pumpsWorking"
              placeholder="1" />
          </div>
          <div class="ff">
            <label class="fl">Кол-во резервных насосов</label>
            <input class="fi" type="number" min="0" max="3" v-model.number="form.kns.pumpsReserve"
              placeholder="1" />
          </div>
        </div>
        <div class="ff">
          <label class="fl">Производительность, м³/ч</label>
          <input class="fi" type="number" step="1" min="1" v-model.number="form.kns.flowRate"
            placeholder="100" />
        </div>
      </div>
      <div class="sv-section">
        <div class="sv-section-title">Патрубки</div>
        <div class="sv-row3">
          <div class="ff">
            <label class="fl">Входящий DN, мм</label>
            <select class="fi" v-model.number="form.kns.inletDn">
              <option v-for="d in PIPE_DN" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Напорный DN, мм</label>
            <select class="fi" v-model.number="form.kns.outletDn">
              <option v-for="d in PIPE_DN" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Аварийный перелив</label>
            <select class="fi" v-model="form.kns.overflow">
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Шаг 2: ЕМК ── -->
    <template v-if="form.deviceType === 'EMK'">
      <div class="sv-section">
        <div class="sv-section-title">Ёмкостное изделие</div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Диаметр DN, мм <span class="sv-req">*</span></label>
            <select class="fi" v-model.number="form.emk.dn">
              <option v-for="d in KNS_DN" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Длина L, м <span class="sv-req">*</span></label>
            <input class="fi" type="number" step="0.1" min="0.5" v-model.number="form.emk.l"
              placeholder="6.0" />
          </div>
        </div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Рабочее давление PN, МПа</label>
            <select class="fi" v-model="form.emk.pn">
              <option value="0.1">PN 0.1</option>
              <option value="0.4">PN 0.4</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Объём, м³</label>
            <input class="fi" type="number" step="0.1" min="0" v-model.number="form.emk.volume"
              readonly :placeholder="calcVolume" />
          </div>
        </div>
        <div class="ff">
          <label class="fl">Назначение</label>
          <select class="fi" v-model="form.emk.purpose">
            <option value="septik">Септик</option>
            <option value="accumulator">Накопительный</option>
            <option value="fire">Противопожарный</option>
            <option value="other">Иное</option>
          </select>
        </div>
      </div>
    </template>

    <!-- ── Шаг 2: КОЛ ── -->
    <template v-if="form.deviceType === 'KOL'">
      <div class="sv-section">
        <div class="sv-section-title">Колодец</div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Диаметр DN, мм <span class="sv-req">*</span></label>
            <select class="fi" v-model.number="form.kol.dn">
              <option value="1000">1000</option>
              <option value="1200">1200</option>
              <option value="1500">1500</option>
              <option value="2000">2000</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Глубина H, м <span class="sv-req">*</span></label>
            <input class="fi" type="number" step="0.1" min="0.5" v-model.number="form.kol.h"
              placeholder="3.0" />
          </div>
        </div>
        <div class="sv-row2">
          <div class="ff">
            <label class="fl">Тип колодца</label>
            <select class="fi" v-model="form.kol.type">
              <option value="inspection">Смотровой</option>
              <option value="drop">Перепадный</option>
              <option value="filter">Фильтрующий</option>
            </select>
          </div>
          <div class="ff">
            <label class="fl">Лестница</label>
            <select class="fi" v-model="form.kol.ladder">
              <option value="steps">Ступени</option>
              <option value="none">Без лестницы</option>
            </select>
          </div>
        </div>
      </div>
    </template>

    <!-- ── Примечание ── -->
    <div class="ff" style="margin-top:4px">
      <label class="fl">Примечание / доп. требования</label>
      <textarea class="fi sv-note" v-model="form.notes" rows="2"
        placeholder="Особые условия, марка грунта, сейсмика…"></textarea>
    </div>

    <div v-if="error" class="auth-err" style="margin-top:8px">{{ error }}</div>

    <template #footer>
      <button class="btn btn-g" @click="$emit('close')">Отмена</button>
      <button class="btn btn-am" :disabled="creating" @click="submit">
        {{ creating ? 'Создание…' : 'Создать расчёт' }}
      </button>
    </template>

  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, ref, computed } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import type { DeviceType } from '@/api/estimates'

const props = defineProps<{ show: boolean; projectId: string }>()
const emit  = defineEmits<{
  close: []
  created: [id: string]
}>()

// ── Константы ──────────────────────────────────────────────────────────────
const DEVICE_TYPES = [
  { value: 'KNS' as DeviceType, label: 'Канализационная насосная станция' },
  { value: 'EMK' as DeviceType, label: 'Ёмкостное изделие' },
  { value: 'KOL' as DeviceType, label: 'Колодец' },
]
const KNS_DN  = [1000, 1200, 1500, 2000, 2500, 3000]
const PIPE_DN = [100, 150, 200, 250, 300, 400, 500, 600]

// ── Форма ──────────────────────────────────────────────────────────────────
const form = reactive({
  title:      '',
  deviceType: 'KNS' as DeviceType,
  notes:      '',
  kns: {
    dn: 3000, l: null as number | null, pn: '0.1', sn: 10000,
    depth: null as number | null, cover: 'flat',
    pumpsWorking: 1, pumpsReserve: 1, flowRate: null as number | null,
    inletDn: 400, outletDn: 150, overflow: 'yes',
  },
  emk: {
    dn: 2000, l: null as number | null, pn: '0.1',
    volume: null as number | null, purpose: 'septik',
  },
  kol: {
    dn: 1000, h: null as number | null,
    type: 'inspection', ladder: 'steps',
  },
})

const creating = ref(false)
const error    = ref('')

// Авторасчёт объёма ЕМК
const calcVolume = computed(() => {
  const r = form.emk.dn / 2000
  const l = form.emk.l ?? 0
  return l > 0 ? `≈ ${(Math.PI * r * r * l).toFixed(2)} м³` : '—'
})

// ── Валидация ───────────────────────────────────────────────────────────────
function validate(): string | null {
  if (!form.title.trim())    return 'Укажите название объекта'
  if (form.deviceType === 'KNS') {
    if (!form.kns.l)  return 'Укажите длину корпуса КНС'
  }
  if (form.deviceType === 'EMK') {
    if (!form.emk.l)  return 'Укажите длину ёмкости'
  }
  if (form.deviceType === 'KOL') {
    if (!form.kol.h)  return 'Укажите глубину колодца'
  }
  return null
}

// ── Submit ─────────────────────────────────────────────────────────────────
async function submit() {
  error.value = validate() ?? ''
  if (error.value) return

  creating.value = true
  try {
    const { useProjectsStore } = await import('@/stores/projects')
    const projectsStore = useProjectsStore()

    const surveyData: Record<string, unknown> = {
      notes: form.notes.trim(),
      ...(form.deviceType === 'KNS' ? { kns: { ...form.kns } } : {}),
      ...(form.deviceType === 'EMK' ? { emk: { ...form.emk } } : {}),
      ...(form.deviceType === 'KOL' ? { kol: { ...form.kol } } : {}),
    }

    const est = await projectsStore.addEstimate(props.projectId, {
      title:      form.title.trim(),
      deviceType: form.deviceType,
      surveyData,
    })

    resetForm()
    emit('created', est.id)
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'Ошибка создания'
  } finally {
    creating.value = false
  }
}

function resetForm() {
  form.title      = ''
  form.deviceType = 'KNS'
  form.notes      = ''
  form.kns.l      = null
  form.kns.depth  = null
  form.kns.flowRate = null
  form.emk.l      = null
  form.emk.volume = null
  form.kol.h      = null
  error.value     = ''
}
</script>

<style scoped>
.sv-section        { margin-bottom: 14px; }
.sv-section-title  {
  font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent); font-family: Archivo, system-ui, sans-serif;
  margin-bottom: 8px; padding-bottom: 4px;
  border-bottom: 1px solid var(--border);
}
.sv-req  { color: var(--danger); }
.sv-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sv-row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }

.sv-type-row { display: flex; gap: 6px; }
.sv-type-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 6px; border-radius: 5px; cursor: pointer;
  background: var(--bg3); border: 1px solid var(--border);
  transition: all .15s;
}
.sv-type-btn:hover  { border-color: var(--accent); }
.sv-type-btn.active { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.sv-type-code  {
  font-family: Archivo, system-ui, sans-serif; font-size: 11px; font-weight: 700;
  color: var(--accent);
}
.sv-type-label { font-size: 8px; color: var(--tx3); text-align: center; line-height: 1.2; }

.sv-note { resize: vertical; min-height: 40px; font-family: inherit; }
</style>
