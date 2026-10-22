<template>
  <div class="pt-wrap">
    <table class="pt">
      <thead>
        <tr>
          <th v-for="c in columns" :key="c.key" :class="{ num: c.num }">
            <button class="pt-sort" :class="{ on: sort.key === c.key }" @click="toggleSort(c.key)">
              {{ c.label }}<span class="pt-dir">{{ sort.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : '' }}</span>
            </button>
          </th>
          <th>Состав</th>
          <th v-if="canDelete" class="pt-act"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in sorted" :key="p.id" class="pt-row" @click="$emit('open', p.id)">
          <td class="pt-title">{{ p.title }}</td>
          <td class="pt-txt">{{ p.customer || '—' }}</td>
          <td class="pt-txt">{{ p.address || '—' }}</td>
          <td class="num">{{ p.estimates.length }}</td>
          <td v-if="showTotals" class="num" :class="{ 'pt-total': projectTotal(p) > 0 }">{{ fmt(projectTotal(p)) }}</td>
          <td class="pt-txt">{{ p.author?.name ?? '—' }}</td>
          <td class="pt-date">{{ fmtDate(p.updatedAt) }}</td>
          <td class="pt-units">
            <span
              v-for="(n, type) in unitTypes(p)" :key="type"
              class="dev-badge" :class="`dev-badge--${String(type).toLowerCase()}`"
            >{{ type }}<template v-if="n > 1"> ×{{ n }}</template></span>
          </td>
          <td v-if="canDelete" class="pt-act">
            <button v-hint="'Удалить проект'" class="pt-del" aria-label="Удалить проект" @click.stop="$emit('delete', p.id)">×</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProjectListItem } from '@/api/projects'
import { fmt } from '@/engines/format'
import { projectTotal, sortProjects, type ProjectSort, type ProjectSortKey } from '@/utils/project-filter'

/**
 * Табличный вид списка проектов: строка — проект, сортировка по клику на
 * заголовок. Карточки показывают единицы целиком, таблица — сводку: число
 * единиц, их типы и сумму.
 */
const props = defineProps<{ projects: ProjectListItem[]; canDelete?: boolean; showTotals?: boolean }>()
defineEmits<{ open: [id: string]; delete: [id: string] }>()

const columns = computed(() => [
  { key: 'title' as const, label: 'Объект' },
  { key: 'customer' as const, label: 'Заказчик' },
  { key: 'address' as const, label: 'Адрес', unsortable: true },
  { key: 'units' as const, label: 'Ед.', num: true },
  ...(props.showTotals ? [{ key: 'total' as const, label: 'Сумма, ₽', num: true }] : []),
  { key: 'author' as const, label: 'Автор' },
  { key: 'updatedAt' as const, label: 'Обновлён' },
])

const sort = ref<ProjectSort>({ key: 'updatedAt', dir: 'desc' })
const sorted = computed(() => sortProjects(props.projects, sort.value))

function toggleSort(key: ProjectSortKey | 'address') {
  // По адресу не сортируем: строка свободная, порядок по ней ничего не даёт.
  if (key === 'address') return
  sort.value = sort.value.key === key
    ? { key, dir: sort.value.dir === 'asc' ? 'desc' : 'asc' }
    // Числа и даты — сначала большие и свежие, текст — по алфавиту.
    : { key, dir: key === 'units' || key === 'total' || key === 'updatedAt' ? 'desc' : 'asc' }
}

/** Типы единиц проекта с количеством: { KNS: 2, EMK: 1 }. */
function unitTypes(p: ProjectListItem): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of p.estimates) out[e.deviceType] = (out[e.deviceType] ?? 0) + 1
  return out
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}
</script>

<style scoped>
.pt-wrap { padding: 12px; overflow-x: auto; }
.pt { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--bg2); border: 1px solid var(--border); }
.pt th { text-align: left; padding: 0; border-bottom: 1px solid var(--border); background: var(--bg1); white-space: nowrap; }
.pt th.num { text-align: right; }
.pt-sort { background: transparent; border: none; color: var(--tx3); font: inherit; font-size: 11.5px;
  text-transform: uppercase; letter-spacing: .04em; padding: 7px 9px; cursor: pointer; width: 100%; text-align: inherit; }
.pt-sort:hover, .pt-sort.on { color: var(--tx); }
.pt-dir { font-size: 9px; margin-left: 4px; }
.pt td { padding: 7px 9px; border-bottom: 1px solid var(--border); vertical-align: middle; }
.pt-row { cursor: pointer; transition: background .12s; }
.pt-row:hover { background: var(--bg3); }
.pt-title { font-weight: 600; color: var(--tx1); min-width: 180px; }
.pt-txt { color: var(--tx2); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pt-total { color: var(--accent); font-weight: 600; }
.pt-date { color: var(--tx3); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pt-units { white-space: nowrap; }
.pt-units .dev-badge + .dev-badge { margin-left: 4px; }
.pt-act { width: 28px; text-align: center; }
.pt-del { background: transparent; border: none; color: var(--tx3); font-size: 18px; line-height: 1;
  cursor: pointer; padding: 0 2px; transition: color .12s; }
.pt-del:hover { color: var(--danger); }
</style>
