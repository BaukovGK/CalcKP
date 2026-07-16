<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">Реестр цен</div>
      </div>
      <div class="sidebar-scroll" style="flex:1">
        <div class="nav-section">Категории</div>
        <button
          class="nav-link"
          :class="{ 'nav-link--active': selectedCat === '' }"
          @click="selectedCat = ''"
        >Все</button>
        <button
          v-for="cat in categories" :key="cat"
          class="nav-link"
          :class="{ 'nav-link--active': selectedCat === cat }"
          @click="selectedCat = cat"
        >{{ cat }}</button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">Реестр цен</div>
        <div class="tb-spacer"></div>
        <div style="font-size:10px;color:var(--tx3)">{{ filtered.length }} позиций</div>
      </div>

      <div class="pr-toolbar">
        <input class="fi pr-search" v-model="search" placeholder="Поиск по наименованию…" />
        <button class="btn btn-g" @click="search = ''; selectedCat = ''">Сбросить</button>
      </div>

      <div class="calc-area">
        <div v-if="loading" class="dash-state">
          <div class="dash-state-txt">Загрузка прайс-листа…</div>
        </div>
        <div v-else-if="loadError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ loadError }}</div>
          <button class="btn btn-g" @click="load">Повторить</button>
        </div>
        <div v-else-if="filtered.length === 0" class="dash-state">
          <div class="dash-state-txt">Ничего не найдено.</div>
        </div>
        <template v-else>
          <template v-for="cat in visibleCats" :key="cat">
            <div class="pr-cat-hdr">{{ cat }}</div>
            <table class="pr-table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Ед.</th>
                  <th>Цена, ₽</th>
                  <th>Поставщик</th>
                  <th>Обновлено</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in byCat(cat)" :key="item.id">
                  <td>{{ item.name }}</td>
                  <td class="pr-unit">{{ item.unit }}</td>
                  <td class="pr-price">
                    <template v-if="editingId === item.id">
                      <input
                        class="fi pr-inp"
                        type="number"
                        step="0.01"
                        min="0"
                        v-model.number="editPrice"
                        @keydown.enter="saveEdit(item.id)"
                        @keydown.escape="cancelEdit"
                        ref="priceInputRef"
                      />
                    </template>
                    <span v-else class="pr-price-val" @click="startEdit(item)">
                      {{ item.priceRub != null ? fmt(item.priceRub) : '—' }}
                    </span>
                  </td>
                  <td class="pr-supplier">
                    <template v-if="editingId === item.id">
                      <input
                        class="fi pr-inp"
                        v-model="editSupplier"
                        placeholder="Поставщик"
                        @keydown.enter="saveEdit(item.id)"
                        @keydown.escape="cancelEdit"
                      />
                    </template>
                    <span v-else class="pr-sup-val" @click="startEdit(item)">
                      {{ item.supplier || '—' }}
                    </span>
                  </td>
                  <td class="pr-date">{{ fmtDate(item.updatedAt) }}</td>
                  <td class="pr-actions">
                    <template v-if="editingId === item.id">
                      <button class="btn btn-am pr-save-btn" :disabled="saving" @click="saveEdit(item.id)">✓</button>
                      <button class="btn btn-g  pr-save-btn" @click="cancelEdit">✕</button>
                    </template>
                    <button v-else class="pr-edit-btn" @click="startEdit(item)">✎</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { pricesApi, type PriceItem } from '@/api/prices'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { fmt } from '@/engines/cost'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth   = useAuthStore()
const canEdit = computed(() => auth.role === 'ADMIN' || auth.role === 'BUYER')

const items    = ref<PriceItem[]>([])
const loading  = ref(false)
const loadError = ref('')
const search    = ref('')
const selectedCat = ref('')

const editingId   = ref<string | null>(null)
const editPrice   = ref<number | null>(null)
const editSupplier = ref('')
const saving      = ref(false)
const priceInputRef = ref<HTMLInputElement | null>(null)

async function load() {
  loading.value = true; loadError.value = ''
  try {
    items.value = await pricesApi.list()
  } catch (e: unknown) {
    loadError.value = e instanceof Error ? e.message : 'Ошибка загрузки'
  } finally {
    loading.value = false
  }
}

const categories = computed(() => [...new Set(items.value.map(i => i.category))].sort())

const filtered = computed(() => {
  let list = items.value
  if (selectedCat.value) list = list.filter(i => i.category === selectedCat.value)
  const q = search.value.toLowerCase()
  if (q) list = list.filter(i => i.name.toLowerCase().includes(q) || (i.supplier ?? '').toLowerCase().includes(q))
  return list
})

const visibleCats = computed(() => [...new Set(filtered.value.map(i => i.category))].sort())

function byCat(cat: string) {
  return filtered.value.filter(i => i.category === cat)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function startEdit(item: PriceItem) {
  if (!canEdit.value) return
  editingId.value  = item.id
  editPrice.value  = item.priceRub
  editSupplier.value = item.supplier ?? ''
  nextTick(() => priceInputRef.value?.focus())
}

function cancelEdit() {
  editingId.value = null
}

async function saveEdit(id: string) {
  saving.value = true
  try {
    const updated = await pricesApi.patch(id, {
      priceRub:  editPrice.value   ?? undefined,
      supplier:  editSupplier.value.trim() || undefined,
    })
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) items.value[idx] = updated
    editingId.value = null
  } catch {
    // keep editing open on error
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.pr-toolbar { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg1); flex-shrink: 0; }
.pr-search  { flex: 1; min-width: 0; }

.pr-cat-hdr {
  font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  color: var(--accent); font-family: Archivo, system-ui, sans-serif;
  padding: 10px 14px 4px; border-bottom: 1px solid var(--border);
}

.pr-table {
  width: 100%; border-collapse: collapse; font-size: 11px;
}
.pr-table th {
  text-align: left; padding: 4px 10px; font-size: 9px; font-weight: 600;
  color: var(--tx3); background: var(--bg1); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1;
}
.pr-table td {
  padding: 5px 10px; border-bottom: 1px solid var(--border); color: var(--tx2); vertical-align: middle;
}
.pr-table tr:hover td { background: var(--bg3); }

.pr-unit     { font-family: Archivo, system-ui, sans-serif; font-size: 9px; color: var(--tx3); white-space: nowrap; width: 40px; }
.pr-price    { width: 110px; }
.pr-price-val { cursor: pointer; font-family: Archivo, system-ui, sans-serif; font-size: 11px; font-weight: 600; color: var(--accent); }
.pr-price-val:hover { text-decoration: underline; }
.pr-supplier  { width: 160px; }
.pr-sup-val   { cursor: pointer; }
.pr-sup-val:hover { text-decoration: underline; color: var(--tx1); }
.pr-date      { font-size: 9px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; width: 70px; white-space: nowrap; }
.pr-actions   { width: 70px; white-space: nowrap; }

.pr-inp      { padding: 2px 5px; font-size: 11px; height: 24px; width: 100%; }
.pr-save-btn { padding: 2px 7px; font-size: 11px; height: 24px; min-width: 0; }
.pr-edit-btn {
  background: transparent; border: none; color: var(--tx3); font-size: 13px;
  cursor: pointer; padding: 2px 4px; transition: color .12s;
}
.pr-edit-btn:hover { color: var(--accent); }

.nav-section { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }
.nav-link    { display: block; width: 100%; text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 11px; color: var(--tx2); cursor: pointer; background: transparent; border: none; transition: background .12s, color .12s; }
.nav-link:hover    { background: var(--bg3); color: var(--tx1); }
.nav-link--active  { background: var(--bg3); color: var(--accent); font-weight: 600; }

.dash-state    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 12px; color: var(--tx3); }
.dash-err      { color: var(--danger); }
</style>
