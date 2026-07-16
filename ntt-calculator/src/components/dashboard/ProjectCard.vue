<template>
  <div class="pc" @click="$emit('open', project.id)">
    <div class="pc-head">
      <div class="pc-title">{{ project.title }}</div>
      <div class="pc-date">{{ fmtDate(project.updatedAt) }}</div>
      <button
        v-if="canDelete"
        class="pc-del"
        title="Удалить проект"
        @click.stop="$emit('delete', project.id)"
      >×</button>
    </div>
    <div v-if="project.customer" class="pc-row">
      <span class="pc-lbl">Заказчик</span>
      <span class="pc-val">{{ project.customer }}</span>
    </div>
    <div v-if="project.address" class="pc-row">
      <span class="pc-lbl">Адрес</span>
      <span class="pc-val">{{ project.address }}</span>
    </div>
    <div class="pc-units">
      <template v-if="project.estimates.length > 0">
        <div v-for="e in project.estimates" :key="e.id" class="pc-unit">
          <span class="pc-unit-type" :class="`pc-unit-type--${e.deviceType.toLowerCase()}`">{{ e.deviceType }}</span>
          <span class="pc-unit-name">{{ e.title }}</span>
          <span class="pc-unit-status" :class="`pc-unit-status--${e.status.toLowerCase()}`">{{ STATUS_LABELS[e.status] }}</span>
          <span v-if="e.totalRub" class="pc-unit-total">{{ fmt(e.totalRub) }} ₽</span>
        </div>
      </template>
      <div v-else class="pc-empty">Единиц оборудования нет</div>
    </div>
    <div class="pc-footer">
      <span class="pc-author">{{ project.author?.name ?? '—' }}</span>
      <span class="pc-count">{{ project.estimates.length }} ед.</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ProjectListItem } from '@/api/projects'
import type { EstimateStatus }  from '@/api/estimates'
import { fmt } from '@/engines/cost'

defineProps<{ project: ProjectListItem; canDelete?: boolean }>()
defineEmits<{ open: [id: string]; delete: [id: string] }>()

const STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Черновик', CALC: 'Расчёт', REVIEW: 'Проверка', APPROVED: 'Утверждено', REJECTED: 'Отклонён',
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
</script>

<style scoped>
.pc {
  background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
  padding: 11px 13px; cursor: pointer; display: flex; flex-direction: column; gap: 5px;
  transition: border-color .15s, background .15s;
}
.pc:hover { border-color: var(--accent); background: var(--bg3); }

.pc-head  { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.pc-title { font-size: 13px; font-weight: 600; color: var(--tx1); line-height: 1.3; }
.pc-date  { font-size: 9px; color: var(--tx3); font-family: 'IBM Plex Mono', monospace; white-space: nowrap; flex-shrink: 0; }

.pc-row  { display: flex; gap: 6px; align-items: baseline; }
.pc-lbl  { font-size: 8px; color: var(--tx3); font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
.pc-val  { font-size: 10px; color: var(--tx2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pc-units { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.pc-unit  { display: flex; align-items: center; gap: 5px; padding: 3px 5px; background: var(--bg1); border-radius: 3px; }
.pc-unit-type {
  font-family: 'IBM Plex Mono', monospace; font-size: 8px; font-weight: 700;
  padding: 1px 4px; border-radius: 2px; background: var(--accent); color: #fff; flex-shrink: 0;
}
.pc-unit-type--emk { background: #8b5cf6; }
.pc-unit-type--kol { background: #10b981; }
.pc-unit-name   { font-size: 10px; color: var(--tx1); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-unit-status { font-size: 9px; color: var(--tx3); white-space: nowrap; }
.pc-unit-status--approved { color: #10b981; }
.pc-unit-status--review   { color: #f59e0b; }
.pc-unit-total  { font-family: 'IBM Plex Mono', monospace; font-size: 9px; color: var(--accent); font-weight: 600; white-space: nowrap; }
.pc-empty { font-size: 10px; color: var(--tx3); font-style: italic; padding: 2px 4px; }

.pc-footer { display: flex; justify-content: space-between; margin-top: 1px; }
.pc-author { font-size: 9px; color: var(--tx3); }
.pc-count  { font-size: 9px; color: var(--tx3); font-family: 'IBM Plex Mono', monospace; }
.pc-del {
  background: transparent; border: none; color: var(--tx3); font-size: 15px;
  line-height: 1; cursor: pointer; padding: 0 2px; transition: color .12s; flex-shrink: 0;
}
.pc-del:hover { color: var(--danger); }
</style>
