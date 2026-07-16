<template>
  <!-- Subgroup header row -->
  <tr
    style="background:rgba(27,34,54,.65)"
    :class="{ 'drop-row': drag.dropTarget === sg.id }"
    @dragover.prevent="onSGDragOver"
    @dragleave="drag.dropTarget = null"
    @drop.prevent="onSGDrop"
  >
    <td>
      <div
        class="drag-handle"
        draggable="true"
        title="Перетащить подгруппу"
        @dragstart.stop="onSGDragStart"
        @dragend="drag.dropTarget = null; drag.data = null"
      >⠿</div>
    </td>
    <td></td>
    <td colspan="6" style="padding:0">
      <div
        style="display:flex;align-items:center;gap:6px;padding:4px 7px"
        :style="{ borderLeft: '2px solid ' + bundleColor + '38' }"
      >
        <input
          :id="'sn-' + sg.id"
          style="background:transparent;border:none;outline:none;font-size:10px;font-weight:500;color:var(--tx);flex:1;min-width:0"
          :value="sg.title"
          @change="e => sg.title = (e.target as HTMLInputElement).value"
          @keydown.enter="e => (e.target as HTMLInputElement).blur()"
        />
        <span
          v-if="sg.rows.some(r => r.isAuto)"
          class="sg-auto"
          title="Содержит строки с авто-пересчётом"
        >⟳ авто</span>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:9px;font-weight:600;color:var(--tl2)">
          {{ fmt(store.sgSum(sg)) }} ₽
        </span>
      </div>
    </td>
    <td style="padding:0">
      <div style="display:flex;gap:1px;padding:0 3px;justify-content:flex-end">
        <button class="ib" style="width:22px;height:22px;font-size:11px" title="Добавить строку" @click="store.addRowToSG(sg.id)">＋</button>
        <button class="ib" style="width:22px;height:22px;font-size:11px" @click="onShowCtx">…</button>
        <span class="chev" @click="sg.collapsed = !sg.collapsed">{{ sg.collapsed ? '▶' : '▼' }}</span>
      </div>
    </td>
    <td></td>
  </tr>

  <!-- Data rows -->
  <template v-if="!sg.collapsed">
    <CalcRow
      v-for="r in sg.rows"
      :key="r.id"
      :row="r"
      :is-drop-target="drag.dropTarget === r.id"
      @dragstart="onRowDragStart"
      @dragover="onRowDragOver"
      @dragleave="drag.dropTarget = null"
      @drop="onRowDrop"
    />
    <tr>
      <td colspan="11" style="border-bottom:none">
        <button class="add-row-btn" @click="store.addRowToSG(sg.id)">
          <span style="color:var(--tl2);font-size:12px;width:14px;text-align:center">＋</span>
          Добавить строку
        </button>
      </td>
    </tr>
  </template>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { CalcSubgroup } from '@/types/calculator'
import type { CtxItem, CalcDragState } from '@/types/ui'
import { useCalculatorStore } from '@/stores/calculator'
import { fmt } from '@/engines/cost'
import CalcRow from './CalcRow.vue'

const props = defineProps<{
  sg: CalcSubgroup
  bundleColor: string
  groupId: string
}>()

const store = useCalculatorStore()
const drag = inject<CalcDragState>('dragState')!
const showCtx = inject<(e: MouseEvent, items: CtxItem[]) => void>('showCtx')!

// ── Subgroup drag ─────────────────────────────────────────────────────────────
function onSGDragStart(e: DragEvent) {
  drag.data = { type: 'sg', id: props.sg.id, parentId: props.groupId }
  e.dataTransfer!.effectAllowed = 'move'
}
function onSGDragOver() {
  if (drag.data?.type === 'sg' && drag.data.id !== props.sg.id) drag.dropTarget = props.sg.id
}
function onSGDrop() {
  if (drag.data?.type !== 'sg') return
  store.moveSGToGroup(drag.data.id, props.groupId, props.sg.id)
  drag.data = null; drag.dropTarget = null
}

// ── Row drag ──────────────────────────────────────────────────────────────────
function onRowDragStart(e: DragEvent, rid: string) {
  drag.data = { type: 'row', id: rid }
  e.dataTransfer!.effectAllowed = 'move'
}
function onRowDragOver(rid: string) {
  if (drag.data?.type === 'row' && drag.data.id !== rid) drag.dropTarget = rid
}
function onRowDrop(rid: string) {
  if (drag.data?.type !== 'row') return
  store.moveRow(drag.data.id, rid)
  drag.data = null; drag.dropTarget = null
}

// ── Context menu ──────────────────────────────────────────────────────────────
function onShowCtx(e: MouseEvent) {
  showCtx(e, [
    { head: 'Подгруппа' },
    { label: '＋ Материал',  action: () => store.addRowToSG(props.sg.id, 'МАТ') },
    { label: '＋ Работа',    action: () => store.addRowToSG(props.sg.id, 'РАБ') },
    { label: '＋ ФОТ',       action: () => store.addRowToSG(props.sg.id, 'ФОТ') },
    { label: '＋ Закупка',   action: () => store.addRowToSG(props.sg.id, 'ЗАК') },
    { sep: true },
    { label: '⧉ Дублировать',     action: () => store.dupSubgroup(props.sg.id) },
    { label: '＋ Добавить после',  action: () => store.addSubgroup(props.groupId, props.sg.id) },
    { label: '↑ Вверх', action: () => store.moveSG(props.groupId, props.sg.id, -1) },
    { label: '↓ Вниз',  action: () => store.moveSG(props.groupId, props.sg.id, 1) },
    { sep: true },
    { label: '🗑 Удалить подгруппу', danger: true, action: () => store.deleteSubgroup(props.sg.id) },
  ])
}
</script>
