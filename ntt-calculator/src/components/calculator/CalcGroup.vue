<template>
  <div
    :id="'grp-' + group.id"
    class="grp"
    :class="{ 'drop-bnd': drag.dropTarget === group.id }"
    @dragover.prevent="onGrpDragOver"
    @dragleave="drag.dropTarget = null"
    @drop.prevent="onGrpDrop"
  >
    <!-- Group header -->
    <div class="grp-hd">
      <span
        class="grp-drag"
        draggable="true"
        title="Перетащить группу"
        @dragstart.stop="onGrpDragStart"
        @dragend="drag.dropTarget = null; drag.data = null"
      >⠿</span>
      <span class="grp-num" :style="{ color: bundle.color }">{{ bundle.groups.indexOf(group) + 1 }}</span>
      <input
        class="grp-name"
        :value="group.title"
        @change="e => group.title = (e.target as HTMLInputElement).value"
        @keydown.enter="e => (e.target as HTMLInputElement).blur()"
      />
      <span class="grp-cnt">{{ group.subgroups.reduce((s, sg) => s + sg.rows.length, 0) }} поз.</span>
      <span class="grp-tot">{{ fmt(store.gSum(group)) }} ₽</span>
      <button class="ib" style="width:22px;height:22px;font-size:11px" @click="onShowCtx">…</button>
      <span class="chev" @click="group.collapsed = !group.collapsed">{{ group.collapsed ? '▶' : '▼' }}</span>
    </div>

    <!-- Group body -->
    <div v-if="!group.collapsed">
      <table class="rows-tbl">
        <colgroup>
          <col class="c-dh"><col class="c-rt"><col class="c-cat"><col class="c-nm">
          <col class="c-buy"><col class="c-qty"><col class="c-un">
          <col class="c-pr"><col class="c-sm"><col class="c-nt"><col class="c-ac">
        </colgroup>
        <thead>
          <tr>
            <th></th><th>Тип</th><th>Категория</th>
            <th>Наименование / Материалы, работы, услуги</th>
            <th class="r">Закупка</th><th class="r">Кол-во</th>
            <th>ЕИ</th><th class="r">Цена, руб</th>
            <th class="r">Сумма, руб</th><th>Примечание</th><th></th>
          </tr>
        </thead>
        <tbody>
          <CalcSubgroup
            v-for="sg in group.subgroups"
            :key="sg.id"
            :sg="sg"
            :bundle-color="bundle.color"
            :group-id="group.id"
          />
        </tbody>
      </table>
      <button class="add-sg-btn" @click="store.addSubgroup(group.id)">
        <span style="font-size:12px;color:var(--tl2)">＋</span> Добавить подгруппу
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { inject } from 'vue'
import type { CalcBundle, CalcGroup } from '@/types/calculator'
import type { CtxItem, CalcDragState } from '@/types/ui'
import { useCalculatorStore } from '@/stores/calculator'
import { fmt } from '@/engines/cost'
import CalcSubgroup from './CalcSubgroup.vue'

const props = defineProps<{
  group: CalcGroup
  bundle: CalcBundle
}>()

const store = useCalculatorStore()
const drag = inject<CalcDragState>('dragState')!
const showCtx = inject<(e: MouseEvent, items: CtxItem[]) => void>('showCtx')!

// ── Group drag ────────────────────────────────────────────────────────────────
function onGrpDragStart(e: DragEvent) {
  drag.data = { type: 'group', id: props.group.id, parentId: props.bundle.id }
  e.dataTransfer!.effectAllowed = 'move'
}
function onGrpDragOver() {
  if (drag.data?.type === 'group' && drag.data.id !== props.group.id) drag.dropTarget = props.group.id
}
function onGrpDrop() {
  if (drag.data?.type !== 'group') return
  const fromF = store.findGroup(drag.data.id)
  if (!fromF) { drag.data = null; drag.dropTarget = null; return }
  fromF.b.groups.splice(fromF.b.groups.indexOf(fromF.g), 1)
  const ti = props.bundle.groups.findIndex(g => g.id === props.group.id)
  props.bundle.groups.splice(ti, 0, fromF.g)
  drag.data = null; drag.dropTarget = null
}

// ── Context menu ──────────────────────────────────────────────────────────────
function onShowCtx(e: MouseEvent) {
  showCtx(e, [
    { head: 'Группа' },
    { label: '＋ Добавить подгруппу', action: () => store.addSubgroup(props.group.id) },
    { label: '⧉ Дублировать',         action: () => store.dupGroup(props.bundle.id, props.group.id) },
    { label: '↑ Вверх', action: () => store.moveGroup(props.bundle.id, props.group.id, -1) },
    { label: '↓ Вниз',  action: () => store.moveGroup(props.bundle.id, props.group.id, 1) },
    { sep: true },
    { label: '🗑 Удалить группу', danger: true, action: () => store.deleteGroup(props.bundle.id, props.group.id) },
  ])
}
</script>
