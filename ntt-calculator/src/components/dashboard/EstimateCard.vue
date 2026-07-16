<template>
  <div class="ec" @click="$emit('open', estimate.id)">
    <div class="ec-top">
      <div class="ec-type" :class="`ec-type--${estimate.deviceType.toLowerCase()}`">
        {{ estimate.deviceType }}
      </div>
      <div class="ec-status" :class="`ec-status--${estimate.status.toLowerCase()}`">
        {{ STATUS_LABELS[estimate.status] }}
      </div>
      <div class="ec-date">{{ fmtDate(estimate.updatedAt) }}</div>
    </div>

    <div class="ec-title">{{ estimate.title }}</div>

    <div v-if="estimate.surveyData?.customer" class="ec-info-row">
      <span class="ec-info-lbl">Заказчик</span>
      <span class="ec-info-val">{{ estimate.surveyData.customer }}</span>
    </div>
    <div v-if="estimate.surveyData?.address" class="ec-info-row">
      <span class="ec-info-lbl">Адрес</span>
      <span class="ec-info-val">{{ estimate.surveyData.address }}</span>
    </div>

    <div class="ec-footer">
      <span class="ec-author">{{ estimate.author?.name ?? '—' }}</span>
      <span v-if="estimate.totalRub" class="ec-total">{{ fmt(estimate.totalRub) }} ₽</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EstimateListItem, EstimateStatus } from '@/api/estimates'
import { fmt } from '@/engines/cost'

defineProps<{ estimate: EstimateListItem }>()
defineEmits<{ open: [id: string] }>()

const STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT:    'Черновик',
  CALC:     'Расчёт',
  REVIEW:   'Проверка',
  APPROVED: 'Утверждено',
  ARCHIVED: 'Архив',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
</script>

<style scoped>
.ec {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: border-color .15s, background .15s;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ec:hover { border-color: var(--accent); background: var(--bg3); }

.ec-top  { display: flex; align-items: center; gap: 6px; }
.ec-type {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px; font-weight: 700; letter-spacing: .04em;
  padding: 2px 5px; border-radius: 3px;
  background: var(--accent); color: #fff;
}
.ec-type--emk { background: #8b5cf6; }
.ec-type--kol { background: #10b981; }

.ec-status {
  font-size: 9px; padding: 2px 6px; border-radius: 3px;
  background: var(--bg3); color: var(--tx3);
  border: 1px solid var(--border);
}
.ec-status--approved { color: #10b981; border-color: #10b981; }
.ec-status--review   { color: #f59e0b; border-color: #f59e0b; }

.ec-date   { margin-left: auto; font-size: 9px; color: var(--tx3); font-family: 'IBM Plex Mono', monospace; }
.ec-title  { font-size: 12px; font-weight: 600; color: var(--tx1); line-height: 1.3; margin-top: 2px; }

.ec-info-row { display: flex; gap: 6px; align-items: baseline; }
.ec-info-lbl {
  font-size: 8px; color: var(--tx3); font-family: 'IBM Plex Mono', monospace;
  text-transform: uppercase; letter-spacing: .04em; white-space: nowrap;
}
.ec-info-val { font-size: 10px; color: var(--tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ec-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 2px; }
.ec-author { font-size: 10px; color: var(--tx3); }
.ec-total  {
  font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700;
  color: var(--accent);
}
</style>
