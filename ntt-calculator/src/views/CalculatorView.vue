<template>
  <div class="app-layout">

    <!-- ── SIDEBAR ── -->
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push(projectId ? `/projects/${projectId}` : '/')">← Назад</button>
        <div class="logo">{{ estimateTitle }}</div>
      </div>
      <div class="sidebar-scroll">
        <div v-for="b in store.bundles" :key="b.id" class="nb">
          <div class="nb-h" @click="scrollTo('bnd-' + b.id)">
            <div class="nb-dot" :style="{ background: b.color }"></div>
            <div class="nb-lbl">{{ b.title }}</div>
            <div class="nb-sm">{{ fmt(store.bSum(b)) }}</div>
          </div>
          <div class="ng-list">
            <div
              v-for="g in b.groups" :key="g.id"
              class="ng-row"
              @click="scrollTo('grp-' + g.id)"
            >
              <div class="ng-dot" :style="{ background: b.color }"></div>
              <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ g.title }}</div>
            </div>
            <div class="nav-add" @click="store.addGroup(b.id)">＋ группа</div>
          </div>
        </div>
        <div class="nav-add" style="margin-top:5px" @click="store.addBundle()">＋ связка</div>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <!-- ── MAIN ── -->
    <div class="main-col">

      <!-- Topbar -->
      <div class="topbar">
        <div>
          <div class="tb-title">{{ estimateTitle }}</div>
          <div class="tb-sub" v-if="saveError" style="color:var(--danger)">{{ saveError }}</div>
        </div>
        <div class="tb-spacer"></div>
        <button class="btn btn-g" @click="store.collapseAll()">Свернуть</button>
        <button class="btn btn-g" @click="store.expandAll()">Развернуть</button>
        <button v-if="estimateId" class="btn btn-g" :disabled="saving" @click="saveSnapshot">
          {{ saving ? 'Сохранение…' : '↑ Сохранить' }}
        </button>
        <!-- Кнопки смены статуса -->
        <template v-if="estimateId && statusAction">
          <button
            v-if="statusAction.back"
            class="btn btn-g"
            :disabled="statusChanging"
            @click="changeStatus(statusAction.back!.to)"
          >{{ statusAction.back.label }}</button>
          <button
            class="btn"
            :class="statusAction.cls"
            :disabled="statusChanging"
            @click="changeStatus(statusAction.to)"
          >{{ statusChanging ? '…' : statusAction.label }}</button>
        </template>
        <span v-if="estimateId && currentStatus" class="tb-status" :class="`tb-status--${currentStatus.toLowerCase()}`">
          {{ STATUS_LABELS[currentStatus] }}
        </span>
        <button class="btn btn-g" @click="store.exportTxt()">↓ Экспорт</button>
        <div class="div1"></div>
        <span class="tb-total-label">ИТОГО</span>
        <span class="tb-total">{{ fmt(store.total) }} ₽</span>
      </div>

      <!-- Calc area -->
      <div class="calc-area">

        <CalcBundle
          v-for="(b, i) in store.bundles"
          :key="b.id"
          :bundle="b"
          :bundle-idx="i"
        />

        <!-- Add bundle -->
        <button class="add-bnd" @click="store.addBundle()">
          <span style="font-size:14px">＋</span> Добавить связку
        </button>

        <!-- Grand total -->
        <div class="gt">
          <template v-for="b in store.bundles" :key="b.id">
            <div style="display:flex;align-items:center;gap:4px">
              <div style="width:7px;height:7px;border-radius:2px" :style="{ background: b.color }"></div>
              <span style="font-size:8px;color:var(--tx3);font-family:Archivo, system-ui, sans-serif">{{ b.title }}</span>
              <span style="font-family:Archivo, system-ui, sans-serif;font-size:11px;font-weight:600" :style="{ color: b.color }">{{ fmt(store.bSum(b)) }} ₽</span>
            </div>
            <div class="gt-sep"></div>
          </template>
          <span class="gt-ml">ИТОГО</span>
          <span class="gt-mv">{{ fmt(store.total) }} ₽</span>
        </div>

      </div>
    </div>

    <!-- ── CONTEXT MENU ── -->
    <ContextMenu :show="ctx.show" :x="ctx.x" :y="ctx.y" :items="ctx.items" @close="ctx.show = false" />

    <!-- ── MODAL (bundle settings) ── -->
    <BaseModal :show="modal.show" title="Настройки связки" @close="modal.show = false">
      <div class="ff">
        <label class="fl">Название</label>
        <input class="fi" v-model="modal.name" @keydown.enter="saveModal" />
      </div>
      <div class="ff">
        <label class="fl">Цвет</label>
        <div class="cpr">
          <div
            v-for="c in BCOLORS" :key="c"
            class="cp" :class="{ on: modal.color === c }"
            :style="{ background: c }"
            @click="modal.color = c"
          ></div>
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="modal.show = false">Отмена</button>
        <button class="btn btn-am" @click="saveModal">Сохранить</button>
      </template>
    </BaseModal>

  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted, provide } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useCalculatorStore, mkRow, mkFOT, mkSubgroup, mkGroup, mkBundle } from '@/stores/calculator'
import { useEstimatesStore } from '@/stores/estimates'
import { estimatesApi, type EstimateStatus } from '@/api/estimates'
import { useAuthStore } from '@/stores/auth'
import CalcBundle  from '@/components/calculator/CalcBundle.vue'
import ContextMenu  from '@/components/ui/ContextMenu.vue'
import BaseModal    from '@/components/ui/BaseModal.vue'
import ThemeToggle  from '@/components/ui/ThemeToggle.vue'
import { fmt } from '@/engines/cost'
import { BCOLORS, FOT_RATE } from '@/data/nomenclature'
import type { CtxItem, CalcDragState } from '@/types/ui'

const store     = useCalculatorStore()
const estimates = useEstimatesStore()
const auth      = useAuthStore()
const route     = useRoute()
const router    = useRouter()

const estimateId    = ref<string | null>((route.params.id as string) || null)
const estimateTitle = ref<string>('Новый расчёт стоимости')
const projectId     = ref<string | null>(null)
const saving        = ref(false)
const saveError     = ref<string | null>(null)
const currentStatus = ref<EstimateStatus | null>(null)
const statusChanging = ref(false)

const STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Черновик', CALC: 'Расчёт', REVIEW: 'Проверка', APPROVED: 'Утверждено', REJECTED: 'Отклонён',
}

const statusAction = computed(() => {
  const role = auth.role
  const s = currentStatus.value
  if (!s || !role) return null
  if (s === 'DRAFT' && ['ENGINEER', 'MANAGER', 'ADMIN'].includes(role))
    return { label: 'В расчёт →', to: 'CALC' as EstimateStatus, cls: 'btn-am', back: null }
  if (s === 'CALC' && ['MANAGER', 'ADMIN'].includes(role))
    return { label: 'На проверку →', to: 'REVIEW' as EstimateStatus, cls: 'btn-am', back: null }
  if (s === 'REVIEW' && ['MANAGER', 'ADMIN'].includes(role))
    return { label: 'Утвердить ✓', to: 'APPROVED' as EstimateStatus, cls: 'btn-am', back: { label: '← Вернуть', to: 'CALC' as EstimateStatus } }
  return null
})

async function changeStatus(status: EstimateStatus) {
  if (!estimateId.value) return
  statusChanging.value = true
  saveError.value = null
  try {
    await estimatesApi.patchStatus(estimateId.value, status)
    currentStatus.value = status
  } catch (e: unknown) {
    saveError.value = e instanceof Error ? e.message : 'Ошибка смены статуса'
  } finally {
    statusChanging.value = false
  }
}

// ── Load estimate from API (if id param given) ────────────────────────────────
async function loadEstimate(id: string) {
  try {
    const est = await estimatesApi.get(id)
    estimateTitle.value = est.title
    projectId.value = est.projectId ?? null
    currentStatus.value = est.status
    const saved = est.surveyData as { bundles?: unknown }
    if (saved?.bundles && Array.isArray(saved.bundles) && (saved.bundles as unknown[]).length > 0) {
      store.bundles.splice(0, store.bundles.length, ...(saved.bundles as typeof store.bundles))
      return
    }
  } catch {
    // estimate not found or offline — fall through to seed
  }
  seedDemo()
}

// ── Save snapshot ─────────────────────────────────────────────────────────────
async function saveSnapshot() {
  if (!estimateId.value) return
  saving.value   = true
  saveError.value = null
  try {
    await estimatesApi.patchSurvey(estimateId.value, { bundles: store.bundles })
  } catch (e: unknown) {
    saveError.value = e instanceof Error ? e.message : 'Ошибка сохранения'
  } finally {
    saving.value = false
  }
}

// ── Seed data ──────────────────────────────────────────────────────────────────
function seedDemo() {
  if (store.bundles.length > 0) return
  const b1 = mkBundle(0, { title: 'Корпус КНС' })
  const g1 = mkGroup({ title: '1.1 Корпус. Материалы' })

  const sg1 = mkSubgroup({ title: 'Труба корпуса' })
  const rt = mkRow({ rtype: 'МАТ', name: 'Труба СК/НПС-К 3000-0.1-10000', qty: '11.5', unit: 'м' })
  const rw = mkRow({ rtype: 'РАБ', name: 'Придание изделию товарного вида', qty: '26.6', unit: 'ч·ч', price: FOT_RATE, isAuto: true, autoParentId: rt.id, autoCoeff: 2.31 })
  sg1.rows.push(rt, rw, mkFOT(rw.id, 1.0))

  const sg2 = mkSubgroup({ title: 'Механическое дно' })
  const rb = mkRow({ rtype: 'МАТ', name: 'Механическое формованное дно', qty: '262.8', unit: 'кг', price: '214.4', note: 'дно + фальшпол' })
  sg2.rows.push(rb, mkFOT(rb.id, 0.28))

  const sg3 = mkSubgroup({ title: 'Ламинирование дна к фальшполу' })
  const rl = mkRow({ rtype: 'РАБ', name: 'Ламинирование дна к фальшполу', qty: '78.9', unit: 'кг', price: '310.2' })
  sg3.rows.push(rl, mkFOT(rl.id, 0.56))

  g1.subgroups.push(sg1, sg2, sg3)

  const g2 = mkGroup({ title: '1.2 Корпус. Работы' })
  const sg4 = mkSubgroup({ title: 'Подготовка трубы' })
  const rp = mkRow({ rtype: 'РАБ', name: 'Предварительные работы для подготовки трубы (транспортировка, разметка осей, шлифовка)', qty: '26.6', unit: 'ч·ч', price: FOT_RATE })
  sg4.rows.push(rp, mkFOT(rp.id, 1.0))
  g2.subgroups.push(sg4)
  b1.groups.push(g1, g2)
  store.bundles.push(b1)

  const b2 = mkBundle(1, { title: 'Комплектация' })
  const g3 = mkGroup({ title: '2.1 Патрубки' })
  const sg5 = mkSubgroup({ title: 'Входящий патрубок DN400' })
  const rg = mkRow({ rtype: 'МАТ', name: 'Труба СК/НПС-К 500-0.1-2500', qty: '0.5', unit: 'м', note: 'Гильза Ø500' })
  const rg2 = mkRow({ rtype: 'РАБ', name: 'Ламинирование патрубка к корпусу', qty: '0.57', unit: 'кг', price: '310.2' })
  sg5.rows.push(rg, mkFOT(rg.id, 0.385), rg2, mkFOT(rg2.id, 1.0))
  g3.subgroups.push(sg5)
  b2.groups.push(g3)
  store.bundles.push(b2)

  const b3 = mkBundle(2, { title: 'Насосное оборудование' })
  const g4 = mkGroup({ title: '3.1 Запорная арматура' })
  const sg6 = mkSubgroup({ title: 'Задвижки' })
  sg6.rows.push(
    mkRow({ rtype: 'ЗАК', category: 'Запорная арматура', name: 'Задвижка клиновая с обрезиненным клином DN400 PN10', purchase: 'да', qty: '1', unit: 'шт', price: '24000' }),
    mkRow({ rtype: 'ЗАК', category: 'Запорная арматура', name: 'Задвижка шиберная DN150 PN10', purchase: 'да', qty: '2', unit: 'шт', price: '18500', note: 'напорный 1+1' })
  )
  g4.subgroups.push(sg6)
  b3.groups.push(g4)
  store.bundles.push(b3)
}

// ── Scroll ────────────────────────────────────────────────────────────────────
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// ── Drag state (provided to all child components via inject) ──────────────────
const dragState = reactive<CalcDragState>({ dropTarget: null, data: null })
provide('dragState', dragState)

// ── Context menu ──────────────────────────────────────────────────────────────
const ctx = reactive<{ show: boolean; x: number; y: number; items: CtxItem[] }>({
  show: false, x: 0, y: 0, items: [],
})

function showCtx(e: MouseEvent, items: CtxItem[]) {
  e.preventDefault(); e.stopPropagation()
  ctx.items = items
  ctx.x = Math.min(e.clientX, window.innerWidth - 165)
  ctx.y = Math.min(e.clientY, window.innerHeight - 300)
  ctx.show = true
}
function hideCtx() { ctx.show = false }

provide('showCtx', showCtx)

// ── Modal ─────────────────────────────────────────────────────────────────────
const modal = reactive({ show: false, bid: '', name: '', color: '' })

function openModal(bid: string) {
  const b = store.findBundle(bid)
  if (!b) return
  modal.bid = bid; modal.name = b.title; modal.color = b.color; modal.show = true
}

function saveModal() {
  const b = store.findBundle(modal.bid)
  if (b) { b.title = modal.name.trim() || b.title; b.color = modal.color }
  modal.show = false
}

provide('openModal', openModal)

onMounted(async () => {
  document.addEventListener('click', hideCtx)
  if (estimateId.value) {
    await loadEstimate(estimateId.value)
  } else {
    seedDemo()
  }
})
onUnmounted(() => document.removeEventListener('click', hideCtx))
</script>

<style scoped>
.tb-status {
  font-family: Archivo, system-ui, sans-serif; font-size: 9px; font-weight: 700;
  padding: 2px 7px; border-radius: 3px; letter-spacing: .04em; text-transform: uppercase;
  background: var(--bg3); color: var(--tx3); border: 1px solid var(--border);
}
.tb-status--calc     { background: color-mix(in srgb, #3b82f6 15%, transparent); color: #3b82f6; border-color: #3b82f6; }
.tb-status--review   { background: color-mix(in srgb, #f59e0b 15%, transparent); color: #f59e0b; border-color: #f59e0b; }
.tb-status--approved { background: color-mix(in srgb, #10b981 15%, transparent); color: #10b981; border-color: #10b981; }
.tb-status--rejected { background: color-mix(in srgb, var(--danger) 15%, transparent); color: var(--danger); border-color: var(--danger); }
</style>
