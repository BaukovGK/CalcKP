<template>
  <tr
    class="dr"
    :class="{ 'auto-r': row.isAuto, 'drop-row': isDropTarget }"
    :id="'row-' + row.id"
    @dragover.prevent="emit('dragover', row.id)"
    @dragleave="emit('dragleave')"
    @drop.prevent="emit('drop', row.id)"
  >
    <!-- ── Drag handle — ONLY element that initiates drag ── -->
    <td class="td-drag">
      <div
        class="drag-handle"
        draggable="true"
        title="Перетащить строку"
        @dragstart.stop="emit('dragstart', $event, row.id)"
        @dragend="emit('dragleave')"
      >⠿</div>
    </td>

    <!-- ── Type badge ── -->
    <td class="td-type">
      <span
        class="rt-b"
        :class="RTYPE_CLASS[row.rtype]"
        :title="'Тип: ' + row.rtype + ' (клик — сменить)'"
        @click="store.cycleRtype(row.id)"
      >{{ row.rtype }}</span>
    </td>

    <!-- ── Category ── -->
    <td class="td-cat">
      <select
        class="csel"
        :value="row.category"
        @change="onCatChange"
      >
        <option v-for="c in ALL_CATS" :key="c" :value="c">{{ c }}</option>
      </select>
    </td>

    <!-- ── Name autocomplete ── -->
    <td class="td-name" :style="{ borderLeft: '2px solid ' + typeColor + '1a' }">
      <div class="name-wrap">
        <input
          ref="nameInputRef"
          class="name-input"
          :value="row.name"
          placeholder="Выберите или введите наименование…"
          @focus="openDropdown"
          @blur="closeDropdown"
          @input="onNameInput"
          @keydown="onKeydown"
          @change="e => store.setField(row.id, 'name', (e.target as HTMLInputElement).value)"
        />
        <!-- Dropdown -->
        <div v-if="dropdownOpen" class="name-dropdown">
          <div v-if="filtered.length === 0" class="nd-empty">
            Нет совпадений — введите вручную
          </div>
          <template v-else>
            <div
              v-for="(item, i) in filtered"
              :key="item.n"
              class="nd-item"
              :class="{ active: i === activeIdx }"
              @mousedown.prevent="selectItem(item)"
            >
              <span class="nd-text" v-html="highlight(item.n, search)"></span>
              <span v-if="item.p" class="nd-price">{{ item.p }} ₽/{{ item.u }}</span>
            </div>
          </template>
        </div>
      </div>
    </td>

    <!-- ── Buy ── -->
    <td class="td-center">
      <span
        class="buy-b"
        :class="buyClass"
        @click="store.cycleBuy(row.id)"
        title="Закупка (клик — сменить)"
      >{{ row.purchase }}</span>
    </td>

    <!-- ── Qty ── -->
    <td>
      <input
        v-if="row.isAuto"
        class="ci mono auto-v"
        :value="row.qty"
        :title="'Авто: ' + row.autoCoeff + ' × qty родителя. Измените для ручного ввода.'"
        @change="e => store.overrideAuto(row.id, (e.target as HTMLInputElement).value)"
      />
      <input
        v-else
        class="ci mono"
        :value="row.qty"
        placeholder="0"
        @change="e => store.setQty(row.id, (e.target as HTMLInputElement).value)"
      />
    </td>

    <!-- ── Unit ── -->
    <td>
      <select class="csel" :value="row.unit"
        @change="e => store.setField(row.id, 'unit', (e.target as HTMLSelectElement).value)">
        <option v-for="u in UNITS" :key="u" :value="u" :selected="row.unit === u">{{ u }}</option>
      </select>
    </td>

    <!-- ── Price ── -->
    <td>
      <input
        class="ci mono"
        :class="{ 'fot-p': row.rtype === 'ФОТ' }"
        :value="row.price"
        placeholder="—"
        @change="e => store.setField(row.id, 'price', (e.target as HTMLInputElement).value)"
      />
    </td>

    <!-- ── Sum ── -->
    <td>
      <div class="sum-c" :class="{ v: rowSum > 0 }">
        {{ rowSum > 0 ? fmt(rowSum) + ' ₽' : '—' }}
      </div>
    </td>

    <!-- ── Note ── -->
    <td>
      <input
        class="ci"
        :value="row.note"
        placeholder="—"
        @change="e => store.setField(row.id, 'note', (e.target as HTMLInputElement).value)"
      />
    </td>

    <!-- ── Actions ── -->
    <td>
      <div class="r-acts">
        <button class="ib" title="Дублировать" @click="store.dupRow(row.id)">⧉</button>
        <button class="ib ib-d" title="Удалить" @click="store.deleteRow(row.id)">✕</button>
      </div>
    </td>
  </tr>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { CalcRow } from '@/types/calculator'
import type { NomItem } from '@/types/calculator'
import { useCalculatorStore } from '@/stores/calculator'
import { NOM_DB, ALL_CATS, UNITS, RTYPE_CLASS, RTYPE_COLOR } from '@/data/nomenclature'
import { rowSum as calcRowSum, fmt } from '@/engines/cost'

const props = defineProps<{
  row: CalcRow
  isDropTarget?: boolean
}>()

const emit = defineEmits<{
  dragstart: [e: DragEvent, id: string]
  dragover:  [id: string]
  dragleave: []
  drop:      [id: string]
}>()

const store = useCalculatorStore()

// ── Sums ────────────────────────────────────────────────────────────────────
const rowSum = computed(() => calcRowSum(props.row))

// ── Type / Buy styles ────────────────────────────────────────────────────────
const typeColor = computed(() => RTYPE_COLOR[props.row.rtype] || 'var(--bd)')

const buyClass = computed(() => ({
  'by-y': props.row.purchase === 'да',
  'by-n': props.row.purchase === 'нет',
  'by-d': props.row.purchase === '-',
}))

// ── Category change ──────────────────────────────────────────────────────────
function onCatChange(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  store.setField(props.row.id, 'category', val)
  // Reset name when category changes
  search.value = ''
}

// ── Name autocomplete ────────────────────────────────────────────────────────
const nameInputRef = ref<HTMLInputElement | null>(null)
const dropdownOpen = ref(false)
const search       = ref('')
const activeIdx    = ref(-1)

const catItems = computed<NomItem[]>(() => NOM_DB[props.row.category] || [])

const filtered = computed<NomItem[]>(() => {
  const q = search.value.toLowerCase()
  if (!q) return catItems.value
  return catItems.value.filter(x => x.n.toLowerCase().includes(q))
})

function openDropdown() {
  search.value = ''
  activeIdx.value = -1
  dropdownOpen.value = true
}

function closeDropdown() {
  // Delay to allow mousedown on items to fire first
  setTimeout(() => {
    dropdownOpen.value = false
    activeIdx.value = -1
  }, 160)
}

function onNameInput(e: Event) {
  search.value = (e.target as HTMLInputElement).value
  dropdownOpen.value = true
  activeIdx.value = -1
}

function onKeydown(e: KeyboardEvent) {
  if (!dropdownOpen.value) {
    if (e.key === 'ArrowDown') openDropdown()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIdx.value = Math.min(activeIdx.value + 1, filtered.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIdx.value = Math.max(activeIdx.value - 1, -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const active = activeIdx.value >= 0 ? filtered.value[activeIdx.value] : undefined
    if (active) {
      selectItem(active)
    } else {
      store.setField(props.row.id, 'name', (e.target as HTMLInputElement).value)
      dropdownOpen.value = false
    }
  } else if (e.key === 'Escape') {
    dropdownOpen.value = false
    ;(e.target as HTMLInputElement).blur()
  }
}

function selectItem(item: NomItem) {
  store.setField(props.row.id, 'name', item.n)
  if (item.u) store.setField(props.row.id, 'unit', item.u)
  if (item.p) store.setField(props.row.id, 'price', item.p)
  if (item.note) store.setField(props.row.id, 'note', item.note)

  if (nameInputRef.value) nameInputRef.value.value = item.n
  search.value = ''
  dropdownOpen.value = false
}

// Highlight matching text
function highlight(text: string, query: string): string {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx < 0) return text
  return (
    text.slice(0, idx) +
    '<mark class="hl">' + text.slice(idx, idx + query.length) + '</mark>' +
    text.slice(idx + query.length)
  )
}
</script>
