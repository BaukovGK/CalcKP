<template>
  <div class="pr">
    <header class="topbar">
      <div class="tb-l">
        <!-- Снабженцу расчёт закрыт — назад в проект (План_устранения 3.7). -->
        <RouterLink v-if="id && !isBuyer" class="tb-lnk" :to="{ name: 'calculator', params: { id } }">← Расчёт</RouterLink>
        <RouterLink v-else-if="projectId" class="tb-lnk" :to="{ name: 'project', params: { id: projectId } }">← Проект</RouterLink>
        <span class="tb-title">Заявка на закупку</span>
        <span class="tb-sub">{{ st.estimate?.title ?? '—' }}</span>
      </div>
      <div class="tb-r">
        <span class="pr-cnt">{{ rows.length }} позиций · {{ fmtInt(total) }} ₽</span>
        <button class="btn btn-acc" :disabled="busy || !rows.length" @click="onExport">
          {{ busy ? 'Готовим…' : 'Выгрузить xlsx' }}
        </button>
        <ThemeToggle compact />
      </div>
    </header>

    <div v-if="st.loading" class="state">Загрузка расчёта…</div>
    <div v-else-if="st.error" class="state state-err">{{ st.error }}</div>

    <template v-else>
      <!-- Строки без цены занижают заявку: их сумма равна нулю. -->
      <div v-if="missing.length" class="warn">
        ⚠ {{ missing.length }} закупаемых {{ plural(missing.length) }} без цены — их стоимость в заявке равна нулю.
        <RouterLink v-if="!isBuyer" :to="{ name: 'calculator', params: { id } }">Заполнить в расчёте →</RouterLink>
        <span v-else>Цены заполняет инженер в расчёте или вы — в прайсе.</span>
      </div>

      <div class="tbl">
        <div class="th">
          <div>№</div><div>Категория</div><div>Наименование</div><div>ЕИ</div>
          <div class="num">Кол-во</div><div class="num">Бюдж. цена</div><div class="num">Бюдж. стоимость</div>
          <div>Дата закупки</div><div>Отметка об исполнении</div>
        </div>

        <div v-for="(r, i) in rows" :key="r.id" class="r" :class="{ 'is-red': r.price == null }">
          <div class="c-n">{{ i + 1 }}</div>
          <div class="c-cat"><span v-hint.plain="r.category" class="chip">{{ r.category }}</span></div>
          <div v-hint.plain="r.name" class="c-name">{{ r.name }}</div>
          <div class="c-u">{{ r.unit }}</div>
          <div class="num">{{ fmt(r.qty) }}</div>
          <div class="num">{{ r.price == null ? '—' : fmt(r.price) }}</div>
          <div class="num">{{ r.price == null ? '—' : fmtInt(r.sum) }}</div>
          <!-- Колонки отдела закупок: заполняются вне системы, в выгрузке пустые -->
          <div class="c-buy">—</div>
          <div class="c-buy">—</div>
        </div>

        <div v-if="!rows.length" class="empty">
          В расчёте нет закупаемых позиций. Закупка — это все категории, кроме
          «Собственное производство», «Работы» и «ФОТ».
        </div>

        <div v-else class="tf">
          <div>ИТОГО</div>
          <div class="num">{{ fmtInt(total) }}</div>
        </div>
      </div>
    </template>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { apiErrorMessage } from '@/utils/api-error'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useCalcTreeStore } from '@/stores/calcTree'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/composables/useToast'
import { isPurchase } from '@/engines/row'
import { api } from '@/api/client'

/**
 * Заявка на закупку (ТЗ §9.6).
 *
 * «Отчёт-представление поверх расчёта, НЕ отдельная сущность данных» — поэтому
 * своего состояния нет: строки берутся из того же стора дерева, что и
 * калькулятор, и считаются тем же движком. Иначе заявка и расчёт разошлись бы.
 */
const route = useRoute()
const st = useCalcTreeStore()

const busy = ref(false)
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : null))
/** Снабженцу расчёт закрыт: назад — в проект единицы (План_устранения 3.7). */
const isBuyer = computed(() => useAuthStore().role === 'BUYER')
const projectId = computed(() => st.estimate?.projectId ?? null)

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

function plural(n: number): string {
  const d = n % 10
  const dd = n % 100
  if (dd >= 11 && dd <= 14) return 'строк'
  if (d === 1) return 'строка'
  if (d >= 2 && d <= 4) return 'строки'
  return 'строк'
}

/**
 * Закупаемые строки: категория ∉ {Собственное производство, Работы, ФОТ}
 * и количество ненулевое («все НЕПУСТЫЕ закупаемые строки», §9.6).
 * Выключенные разделы дают qty = 0 и сюда не попадают.
 */
const rows = computed(() =>
  st.rows
    .filter((r) => isPurchase(r.category))
    .map((r) => ({ row: r, res: st.results.get(r.id) }))
    .filter((x) => x.res != null && x.res.qty > 0)
    .map((x) => ({
      id: x.row.id,
      category: x.row.category,
      name: x.row.name,
      unit: x.row.unit,
      qty: x.res!.qty,
      price: x.res!.price,
      sum: x.res!.sum,
    })),
)

const missing = computed(() => rows.value.filter((r) => r.price == null))
const total = computed(() => rows.value.reduce((s, r) => s + r.sum, 0))

async function onExport() {
  if (!id.value) return
  busy.value = true
  try {
    // Строки считает движок (здесь), бэкенд только форматирует xlsx:
    // дублировать движок ради выгрузки — держать две реализации формул.
    const { data } = await api.post(
      `/estimates/${id.value}/purchase-request/export`,
      { rows: rows.value.map(({ category, name, unit, qty, price, sum }) => ({ category, name, unit, qty, price, sum })) },
      { responseType: 'blob' },
    )
    const url = URL.createObjectURL(data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Заявка_${st.estimate?.title ?? 'расчёт'}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    toast('Заявка выгружена', 'success')
  } catch (e) {
    toast(apiErrorMessage(e, 'Не удалось выгрузить заявку'), 'error')
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  // Загружаем, только если стор пуст или это другой расчёт: переход из
  // калькулятора не должен терять несохранённый тюнинг.
  if (id.value && st.estimate?.id !== id.value) void st.load(id.value)
})
</script>

<style scoped>
.pr { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

.pr-cnt { font-size: 13.5px; color: var(--faint); }


.warn { padding: 6px 14px; background: var(--amber-bg); border-bottom: 1px solid var(--amber);
  font-size: 13.5px; color: var(--amber); flex: none; }
.warn a { color: var(--amber); }


.tbl { flex: 1; overflow: auto; }
.th, .r {
  display: grid;
  grid-template-columns: 40px 150px minmax(200px, 1fr) 44px 80px 96px 116px 96px 130px;
  gap: 8px; padding: 0 10px; align-items: center;
}
.th { position: sticky; top: 0; z-index: 2; height: 30px; background: var(--panel2);
  border-bottom: 1px solid var(--line2); font-size: 12px; text-transform: uppercase;
  letter-spacing: .06em; color: var(--faint); }
.th .num { text-align: right; }
.r { min-height: 30px; border-bottom: 1px solid var(--line); font-size: 13.5px; }
.r:nth-child(even) { background: var(--panel); }
.r.is-red { background: var(--acc-bg); }
.num { text-align: right; }

.c-n { color: var(--faint); font-size: 12.5px; }
.c-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-u { font-size: 12.5px; color: var(--muted); }
.c-buy { font-size: 12.5px; color: var(--faint); }

.tf { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 8px 10px;
  border-top: 2px solid var(--line2); font-weight: 700; font-size: 15px; position: sticky; bottom: 0;
  background: var(--panel); }
.empty { padding: 20px 14px; font-size: 13.5px; color: var(--faint); }
</style>
