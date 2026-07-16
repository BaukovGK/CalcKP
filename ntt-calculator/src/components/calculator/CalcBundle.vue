<template>
  <div
    :id="'bnd-' + bundle.id"
    class="bnd"
    :class="{ 'drop-bnd': drag.dropTarget === bundle.id }"
    @dragover.prevent="onBndDragOver"
    @dragleave="drag.dropTarget = null"
    @drop.prevent="onBndDrop"
  >
    <!-- Bundle header -->
    <div class="bnd-hd">
      <span
        class="bnd-drag"
        draggable="true"
        title="Перетащить связку"
        @dragstart.stop="onBndDragStart"
        @dragend="drag.dropTarget = null; drag.data = null"
      >⠿</span>
      <div class="bnd-swatch" :style="{ background: bundle.color }"></div>
      <input
        class="bnd-name"
        :value="bundle.title"
        @change="e => bundle.title = (e.target as HTMLInputElement).value"
        @keydown.enter="e => (e.target as HTMLInputElement).blur()"
      />
      <span class="bnd-tot-l">итого</span>
      <span class="bnd-tot">{{ fmt(store.bSum(bundle)) }} ₽</span>
      <button class="ib" title="Добавить группу" @click="store.addGroup(bundle.id)">＋</button>
      <button class="ib" @click="onShowCtx">…</button>
      <span class="chev" @click="bundle.collapsed = !bundle.collapsed">{{ bundle.collapsed ? '▶' : '▼' }}</span>
    </div>

    <template v-if="!bundle.collapsed">
      <CalcGroup
        v-for="g in bundle.groups"
        :key="g.id"
        :group="g"
        :bundle="bundle"
      />

      <!-- Bundle footer -->
      <div class="bft">
        <button class="bft-add" @click="store.addGroup(bundle.id)">＋ Добавить группу</button>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:8px;color:var(--tx3)">Итого по связке</span>
          <span class="bft-sum">{{ fmt(store.bSum(bundle)) }} ₽</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { CalcBundle } from '@/types/calculator'
import type { CtxItem, CalcDragState } from '@/types/ui'
import { useCalculatorStore } from '@/stores/calculator'
import { fmt } from '@/engines/cost'
import CalcGroup from './CalcGroup.vue'

const props = defineProps<{
  bundle: CalcBundle
  bundleIdx: number
}>()

const store = useCalculatorStore()
const drag = inject<CalcDragState>('dragState')!
const showCtx = inject<(e: MouseEvent, items: CtxItem[]) => void>('showCtx')!
const openModal = inject<(bid: string) => void>('openModal')!

// ── Bundle drag ───────────────────────────────────────────────────────────────
function onBndDragStart(e: DragEvent) {
  drag.data = { type: 'bundle', id: props.bundle.id }
  e.dataTransfer!.effectAllowed = 'move'
}
function onBndDragOver() {
  if (drag.data?.type === 'bundle' && drag.data.id !== props.bundle.id) drag.dropTarget = props.bundle.id
}
function onBndDrop() {
  if (drag.data?.type !== 'bundle') return
  store.moveBundleDrop(drag.data.id, props.bundle.id)
  drag.data = null; drag.dropTarget = null
}

// ── Context menu ──────────────────────────────────────────────────────────────
function onShowCtx(e: MouseEvent) {
  showCtx(e, [
    { head: 'Связка' },
    { label: '🎨 Настроить цвет / название', action: () => openModal(props.bundle.id) },
    { label: '＋ Добавить группу',            action: () => store.addGroup(props.bundle.id) },
    { label: '↑ Переместить вверх',           action: () => store.moveBundle(props.bundle.id, -1) },
    { label: '↓ Переместить вниз',            action: () => store.moveBundle(props.bundle.id, 1) },
    { sep: true },
    { label: '🗑 Удалить связку', danger: true, action: () => store.deleteBundle(props.bundle.id) },
  ])
}
</script>
