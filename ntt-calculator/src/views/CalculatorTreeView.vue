<template>
  <div class="cw">
    <!-- ── Топбар ── -->
    <header class="tb">
      <div class="tb-l">
        <RouterLink class="tb-lnk" :to="backTarget">{{ backLabel }}</RouterLink>
        <span v-hint.plain="st.estimate?.title" class="tb-t">Расчёт: {{ st.estimate?.title ?? '—' }}</span>
        <span v-if="customer" class="tb-cust">· Заказчик {{ customer }}</span>
        <!-- Экран ОЛ — редактирующий, наблюдателю недоступен (роут не пустит). -->
        <RouterLink
          v-if="st.estimate && !readOnly"
          class="tb-lnk"
          :to="{ name: 'survey', params: { id: st.estimate.id } }"
        >← Опросный лист</RouterLink>
        <span v-if="zayavka" class="tb-zv">· заявка {{ zayavka }}</span>
        <span v-hint="STATUS_HINT" class="badge">{{ statusLabel }}</span>
      </div>
      <div class="tb-r">
        <span v-if="readOnly" v-hint.plain="'Роль «Наблюдатель»: расчёт открыт только для просмотра'" class="tb-ro">👁 просмотр</span>
        <button
          v-if="hasProblems"
          v-hint="'Показать только проблемные строки: без цены и с конфликтами. Повторное нажатие вернёт все'"
          class="tb-prob"
          :class="{ on: filters.problems }"
          @click="toggleProblems"
        >
          {{ problemsText }}
        </button>
        <span v-hint.plain="PRICE_LIST_HINT" class="tb-pl" :class="{ old: st.priceOutdated }">
          прайс {{ priceListLabel }}<template v-if="st.priceOutdated"> · действует v{{ st.priceListVersion }}</template>
        </span>
        <span v-hint.plain="TEMPLATE_VERSION_HINT" class="tb-pl" :class="{ old: st.templateOutdated }">
          шаблон {{ compositionLabel(treeTemplateVersion, st.tree?.builtinRevision) }}<template v-if="st.templateChanged"> · действует {{ compositionLabel(st.activeTemplateVersion, st.activeBuiltinRevision) }}</template><template v-else-if="st.builtinOutdated"> · действует ред. {{ st.activeBuiltinRevision }}</template>
        </span>
        <template v-if="!readOnly">
          <button class="btn" :disabled="saving" @click="onSave">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
          <button v-hint="VERSIONS_HINT" class="btn" @click="openVersions">Версии</button>
          <button v-hint="'Заявка на закупку: покупные позиции расчёта с количествами, для отдела закупок'" class="btn" @click="onExport">Экспорт ▾</button>
          <button v-hint="KP_HINT" class="btn btn-acc" :disabled="kpBusy" @click="onKp">Сформировать КП</button>
        </template>
        <button v-else v-hint="VERSIONS_HINT" class="btn" @click="openVersions">Версии</button>
        <button v-hint="'Переключить тему'" class="btn" aria-label="Переключить тему" @click="toggle">{{ theme === 'dark' ? '☾' : '☀' }}</button>
      </div>
    </header>

    <!-- ── Фильтры ── -->
    <div class="fl">
      <input v-model="filters.q" class="fl-q" placeholder="поиск по наименованию" />
      <button v-hint="FILTER_HINTS.missing" class="chip-f chip-red" :class="{ on: filters.missing }" @click="filters.missing = !filters.missing">
        ● без цены · {{ st.missingPriceIds.size }}
      </button>
      <button v-hint="FILTER_HINTS.conflict" class="chip-f chip-amber" :class="{ on: filters.conflict }" @click="filters.conflict = !filters.conflict">
        ⚠ конфликты · {{ st.conflictIds.size }}
      </button>
      <button v-hint="FILTER_HINTS.override" class="chip-f chip-blue" :class="{ on: filters.override }" @click="filters.override = !filters.override">
        override · {{ st.overrideIds.size }}
      </button>
      <template v-if="st.priceDeltaIds.size">
        <button v-hint="FILTER_HINTS.repriced" class="chip-f chip-amber" :class="{ on: filters.repriced }" @click="filters.repriced = !filters.repriced">
          ₽ цены изменились · {{ st.priceDeltaIds.size }}
        </button>
        <button
          v-if="!readOnly"
          v-hint="'Принять новые цены прайса у всех строк — снять отметки «было … ₽»'"
          class="fl-clear"
          @click="st.acceptAllPriceDeltas()"
        >принять все</button>
      </template>
      <button v-if="anyFilter" class="fl-clear" @click="clearFilters">сбросить ✕</button>
      <label class="fl-chk"><input v-model="filters.ghosts" type="checkbox" /><span v-hint="FILTER_HINTS.ghosts">выключенные</span></label>
      <span class="fl-cnt">показано {{ shownCount }} из {{ st.rows.length }}</span>
    </div>

    <!-- Прайс обновился после сборки расчёта: цены строк — прежней версии. -->
    <div v-if="!st.loading && st.priceOutdated" class="pbar">
      <span class="pbar-t">Цены строк — из прайса НН v{{ treePriceVersion }}, а действует v{{ st.priceListVersion }}.</span>
      <span class="pbar-d">{{ repriceText }}</span>
      <button
        v-if="!readOnly"
        v-hint="REPRICE_HINT"
        class="btn btn-acc"
        :disabled="repricing"
        @click="onReprice"
      >{{ repricing ? 'Пересчитываем…' : `Пересчитать по прайсу v${st.priceListVersion}` }}</button>
    </div>

    <!-- Состав расчёта собран не тем шаблоном, что действует: технолог
         опубликовал другую версию, либо релиз завёл новую редакцию
         встроенных узлов. -->
    <div v-if="!st.loading && st.templateOutdated" class="pbar">
      <span class="pbar-t">{{ outdatedTitle }}</span>
      <span class="pbar-d">{{ outdatedDetail }}</span>
      <button
        v-if="!readOnly"
        v-hint="REBUILD_HINT"
        class="btn btn-acc"
        :disabled="rebuilding"
        @click="onRebuildTemplate"
      >{{ rebuilding ? 'Пересобираем…' : st.templateChanged ? `Пересобрать ${templateRef(st.activeTemplateVersion)}` : 'Пересобрать по текущей редакции' }}</button>
    </div>

    <div v-if="st.loading" class="state">Загрузка расчёта…</div>
    <div v-else-if="st.error" class="state state-err">{{ st.error }}</div>

    <div v-else class="body">
      <!-- ── Дерево сборок ── -->
      <nav class="tree">
        <div class="zone-h">Сборки</div>
        <div
          v-for="sec in st.tree?.sections ?? []"
          :key="sec.code"
          class="tr-s"
          :class="{ active: activeSec === sec.code, off: !sec.enabled }"
        >
          <label v-hint="sec.enabled ? SECTION_ON_HINT : SECTION_OFF_HINT" class="tr-chk" @click.stop>
            <input :checked="sec.enabled" type="checkbox" :disabled="readOnly" :aria-label="`Раздел ${sec.code} ${sec.title}`" @change="st.toggleSection(sec.code)" />
          </label>
          <button class="tr-n" @click="goSection(sec.code)">
            <span class="tr-t">{{ sec.code }} {{ sec.title }}</span>
            <span class="tr-sum" :class="{ struck: !sec.enabled }">{{ sectionSum(sec.code) }}</span>
          </button>
          <span v-if="secProblems(sec.code).red" v-hint.plain="`Строк без цены в разделе: ${secProblems(sec.code).red}`" class="bdg bdg-red">● {{ secProblems(sec.code).red }}</span>
          <span v-if="secProblems(sec.code).amber" v-hint.plain="`Конфликтов с опросным листом в разделе: ${secProblems(sec.code).amber}`" class="bdg bdg-amber">⚠ {{ secProblems(sec.code).amber }}</span>
        </div>
      </nav>

      <!-- ── Таблица ── -->
      <main ref="tableEl" class="tbl" @scroll="onScroll">
        <div class="th">
          <div>Категория</div><div>Наименование</div><div class="num">Кол-во</div><div>ЕИ</div>
          <div class="num">Цена ₽</div><div class="num">Сумма ₽</div><div>Примечание</div>
        </div>

        <template v-for="sec in visibleSections" :key="sec.code">
          <div :id="`grp-${sec.code}`" class="gh" :class="{ off: !sec.enabled }">
            {{ sec.code }} · {{ sec.title }}
            <span class="gh-sum">{{ sectionSum(sec.code) }}</span>
          </div>

          <template v-for="c in sec.components" :key="c.id">
            <div v-if="visibleRows(c).length" class="ch">
              <span>
                └ {{ c.title }}
                <button
                  v-if="!readOnly && c.nodeCode && c.id.startsWith('custom-')"
                  v-hint="'Убрать вставленный узел из расчёта целиком'"
                  class="ch-del"
                  @click="st.removeComponent(sec.code, c.id)"
                >✕ убрать узел</button>
              </span>
              <span class="ch-sum">{{ componentSum(c) }}</span>
            </div>
            <CalcTableRow
              v-for="row in visibleRows(c)"
              :key="row.id"
              :row="row"
              :res="st.results.get(row.id)!"
              :conflict="st.conflictIds.has(row.id)"
              :prev-calc="prevCalcOf(row.id)"
              :fot-k="st.fotKOf(row)"
              :parent="row.parentId ? rowById.get(row.parentId) ?? null : null"
              :tirage="st.tirage"
              :disabled="!sec.enabled || !c.enabled"
              :readonly="readOnly"
              :price-delta="st.priceDeltaIds.has(row.id)"
              :price-prev="row.priceCatalogPrev ?? null"
              @qty="st.setQtyManual"
              @price="st.setPriceManual"
              @reset-qty="st.resetQty"
              @reset-price="st.resetPrice"
              @keep="st.keepOverride"
              @drop="st.dropOverride"
              @accept-price="st.acceptPriceDelta"
              @keep-price="st.keepPrevPrice"
              @nav="onNav"
              @remove="st.removeRow"
            />
          </template>

          <div v-if="!sec.components.length" class="empty">
            Раздел без строк — состав сильно варьирует между заказами, строки добавляются вручную
          </div>

          <!-- Добавление строк — в каждую сборку (прототип: пунктирные кнопки). -->
          <div v-if="!readOnly" class="add">
            <button class="add-b" @click="openCatalog(sec.code)">+ Компонент из каталога…</button>
            <button class="add-b" @click="addFreeRow(sec.code)">+ Свободная строка</button>
          </div>
        </template>
      </main>

      <!-- ── Панель итогов ── -->
      <aside class="tot">
        <div class="tot-h">Итоги</div>

        <div v-for="b in buckets" :key="b.k" class="tot-r">
          <span v-hint="BUCKET_HINTS[b.k]">{{ b.k }}</span><span class="num">{{ fmtInt(b.v) }}</span>
        </div>

        <div class="tot-r tot-cost">
          <span v-hint="TOTAL_HINTS.cost">Себестоимость</span><span class="num">{{ fmtInt(e.costRub) }}</span>
        </div>

        <div class="tot-r">
          <span v-hint="TOTAL_HINTS.markup">Наценка {{ readOnly ? '' : '✎' }}</span>
          <input v-model="markupText" class="tot-in num" :disabled="readOnly" @change="onMarkup" />
        </div>

        <div class="tot-r tot-price">
          <span v-hint="TOTAL_HINTS.price">ЦЕНА ПРОДАЖИ</span><span class="num">{{ fmtInt(e.salePriceRub) }}</span>
        </div>

        <div class="tot-r">
          <span v-hint="TOTAL_HINTS.profitability">Рентабельность</span>
          <span class="num" :style="{ color: rentColor }">{{ rentText }}</span>
        </div>

        <div class="tot-r">
          <span v-hint="TOTAL_HINTS.tirage">Корпусов</span>
          <input v-model="tirageText" class="tot-in num" :disabled="readOnly" @change="onTirage" />
        </div>
        <!-- При тираже ≥2 главные цифры — за весь тираж (согласованы с
             таблицей, где количества умножены на N); строка ниже показывает
             цену одного корпуса отдельным прогоном экономики (tirage=1). -->
        <div v-if="st.tirage >= 2" class="tot-r tot-n">
          <span v-hint="TOTAL_HINTS.perUnit">за 1 корп.</span><span class="num">{{ fmtInt(st.economicsUnit.salePriceRub) }}</span>
        </div>

        <!-- Разложение «Прочих»: прототип его не показывает, но без него
             непонятно, откуда берётся сумма (§9.5). -->
        <details class="tot-d">
          <summary>Прочие — из чего</summary>
          <div class="tot-r tot-s"><span v-hint="TOTAL_HINTS.pzr">ПЗР ({{ fmt(e.pzrHours) }} чел.ч)</span><span class="num">{{ fmtInt(e.pzrRub) }}</span></div>
          <div class="tot-r tot-s"><span v-hint="TOTAL_HINTS.acetone">Ацетон ({{ fmt(e.acetoneKg) }} кг)</span><span class="num">{{ fmtInt(e.acetoneRub) }}</span></div>
          <div class="tot-r tot-s"><span v-hint="TOTAL_HINTS.ppe">СИЗ ({{ fmtInt(e.ppeUnits) }} ед.)</span><span class="num">{{ fmtInt(e.ppeRub) }}</span></div>
          <div class="tot-r tot-s"><span v-hint="TOTAL_HINTS.overhead">Накладные ({{ fmt(e.overheadHours) }} чел.ч)</span><span class="num">{{ fmtInt(e.overheadRub) }}</span></div>
          <div class="tot-note">ПЗР входит в «Работы, ФОТ», а не в «Прочие»</div>
        </details>

        <!-- Легенда — по прототипу: пояснение override + таблица клавиш. -->
        <div class="tot-legend">
          Синее значение — override, ↺ возвращает расчётное. ФОТ-спутники пересчитываются от массы родителя.
          Задержите указатель на строке или подписи с пунктиром — появится пояснение.
          <div class="keys">
            <span class="k">↑ ↓</span><span>по строкам</span>
            <span class="k">← →</span><span>кол-во ⇄ цена</span>
            <span class="k">Enter</span><span>применить и вниз</span>
            <span class="k">Esc</span><span>отменить</span>
            <span class="k">1,55*2+2,88*2</span><span>арифметика</span>
          </div>
        </div>
      </aside>
    </div>

    <!-- ── Модал «Компонент из каталога» ── -->
    <BaseModal
      :show="catalogOpen"
      title="Компонент из каталога"
      :close-on-backdrop="true"
      @close="catalogOpen = false"
    >
      <p class="cat-sub">→ в сборку «{{ secTitle(catalogSec) }}»</p>
      <div v-if="st.catalogNodes.length" class="cat-tabs">
        <button class="cat-tab" :class="{ on: catalogMode === 'price' }" @click="catalogMode = 'price'">Позиция прайса</button>
        <button v-hint="CATALOG_NODE_HINT" class="cat-tab" :class="{ on: catalogMode === 'node' }" @click="catalogMode = 'node'">Узел каталога · {{ st.catalogNodes.length }}</button>
      </div>
      <template v-if="catalogMode === 'price'">
        <input v-model="catalogQ" class="cat-q" placeholder="поиск по прайсу — минимум 2 символа" autofocus />
        <div class="cat-list">
          <button v-for="p in catalogHits" :key="`${p.category}|${p.name}|${p.unit}`" class="cat-i" @click="addFromCatalog(p)">
            <span class="cat-c">{{ p.category }}</span>
            <span v-hint.plain="p.name" class="cat-n">{{ p.name }}</span>
            <span class="cat-u">{{ p.unit }}</span>
            <span class="cat-p num">{{ p.priceRub == null ? '—' : fmtInt(p.priceRub) }}</span>
          </button>
          <div v-if="catalogQ.trim().length >= 2 && !catalogHits.length" class="cat-empty">Ничего не найдено</div>
        </div>
      </template>
      <div v-else-if="!pickedNode" class="cat-list">
        <button v-for="n in st.catalogNodes" :key="n.code" class="cat-i" @click="pickNode(n)">
          <span class="cat-c">{{ n.body.tag }}</span>
          <span v-hint.plain="n.body.description || n.body.name" class="cat-n">{{ n.code }} · {{ n.body.name }}</span>
          <span class="cat-u">v{{ n.version }}</span>
          <span class="cat-p">{{ n.body.rows.length }} стр.</span>
        </button>
      </div>
      <div v-else class="cat-node">
        <div class="cat-nh">
          <b>{{ pickedNode.code }} · {{ nodePreview?.title ?? pickedNode.body.name }}</b>
          <button class="fl-clear" @click="pickedNode = null">← к списку узлов</button>
        </div>
        <p v-if="pickedNode.body.description" class="cat-sub">{{ pickedNode.body.description }}</p>
        <div v-if="pickedNode.body.params.length" class="cat-pgrid">
          <label v-for="p in pickedNode.body.params" :key="p.key" class="cat-pf">
            <span>{{ p.label }}{{ p.unit ? `, ${p.unit}` : '' }}</span>
            <input v-if="p.type === 'bool'" type="checkbox" :checked="nodeValues[p.key] === true" @change="nodeValues[p.key] = ($event.target as HTMLInputElement).checked" />
            <input v-else class="cat-in" :class="{ num: p.type === 'number' }" :value="nodeValueText(p)" @change="setNodeValue(p, ($event.target as HTMLInputElement).value)" />
          </label>
        </div>
        <div class="cat-list">
          <div v-for="r in nodePreview?.rows ?? []" :key="r.id" class="cat-pr" :class="{ red: r.missing }">
            <span class="cat-n">{{ r.name }}</span>
            <span class="num">{{ r.qty }}</span>
            <span class="cat-u">{{ r.unit }}</span>
            <span class="num">{{ r.price }}</span>
          </div>
        </div>
      </div>
      <template v-if="catalogMode === 'node' && pickedNode" #footer>
        <button class="btn" @click="pickedNode = null">Назад</button>
        <button class="btn btn-acc" @click="addNodeFromCatalog">Добавить в раздел</button>
      </template>
    </BaseModal>

    <!-- ── Выпуск КП по прайсу старше действующего ── -->
    <BaseModal :show="kpAsk" title="Прайс обновился" :close-on-backdrop="true" @close="kpAsk = false">
      <p class="kpa-t">
        Цены строк расчёта — из прайса НН v{{ treePriceVersion }}, а действует v{{ st.priceListVersion }}.
        {{ repriceText }}
      </p>
      <p class="kpa-t">КП зафиксирует цены той версии прайса, по которой они посчитаны.</p>
      <template #footer>
        <button class="btn" @click="kpAsk = false">Отмена</button>
        <button class="btn" @click="kpIssueAsIs">Выпустить по v{{ treePriceVersion }}</button>
        <button class="btn btn-acc" @click="kpRepriceAndIssue">Пересчитать и выпустить</button>
      </template>
    </BaseModal>

    <!-- ── Модал «История версий» (ТЗ §7) ── -->
    <BaseModal
      :show="versionsOpen"
      title="История версий"
      :close-on-backdrop="true"
      @close="versionsOpen = false"
    >
      <p class="ver-sub">
        Версия фиксирует дерево, итог, версию прайса и шаблона на момент снимка.
        Снимается при создании единицы, при выпуске КП и вручную.
      </p>
      <div v-if="versionsLoading" class="ver-state">Загрузка…</div>
      <div v-else-if="!versions.length" class="ver-state">Версий пока нет</div>
      <table v-else class="ver-tbl">
        <thead>
          <tr><th>Версия</th><th>Дата</th><th>Причина</th><th class="ver-thw"><span v-hint.plain="'Версия прайса, по которой посчитаны цены, и версия шаблона изделия, по которой собран состав'">Прайс / шаблон</span></th><th class="num">Итог ₽</th><th>КП</th></tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td>v{{ v.version }}</td>
            <td>{{ fmtDateTime(v.createdAt) }}</td>
            <td class="ver-reason">{{ REASON_LABEL[v.reason ?? 'KP'] }}</td>
            <td>НН v{{ v.priceListVersion }}<span v-if="v.templateVersion != null || v.builtinRevision != null" class="ver-tpl">шаблон {{ v.templateVersion == null ? '—' : templateLabel(v.templateVersion) }}{{ v.builtinRevision == null ? '' : ` · ред. ${v.builtinRevision}` }}</span></td>
            <td class="num">{{ v.totalRub ? fmtInt(v.totalRub) : '—' }}</td>
            <!-- Слепок создания — исходное состояние: проверку строк без цены
                 он не проходил, поэтому КП по нему не печатается. -->
            <td v-if="v.reason === 'CREATE'" v-hint="'Исходное состояние — КП печатается из выпуска КП'" class="ver-dl ver-dl--none">—</td>
            <td v-else class="ver-dl">
              <button
                class="btn btn-xs"
                v-hint="'Скачать печатную форму КП в Word'"
                :disabled="kpDownload === `${v.version}:docx`"
                @click="downloadKp(v.version, 'docx')"
              >docx</button>
              <button
                class="btn btn-xs"
                v-hint="'Скачать печатную форму КП в PDF'"
                :disabled="kpDownload === `${v.version}:pdf`"
                @click="downloadKp(v.version, 'pdf')"
              >pdf</button>
            </td>
          </tr>
        </tbody>
      </table>
      <template #footer>
        <button class="btn" @click="versionsOpen = false">Закрыть</button>
        <button v-if="!readOnly" class="btn btn-acc" :disabled="snapBusy" @click="onManualSnapshot">
          {{ snapBusy ? 'Фиксируем…' : '＋ Зафиксировать версию' }}
        </button>
      </template>
    </BaseModal>

    <ToastHost />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CalcTableRow from '@/components/calculator/CalcTableRow.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useCalcTreeStore } from '@/stores/calcTree'
import { useAuthStore } from '@/stores/auth'
import { useTheme } from '@/composables/useTheme'
import { toast } from '@/composables/useToast'
import { COST_BUCKETS } from '@/engines/economics'
import { BUCKET_HINTS, FILTER_HINTS, TOTAL_HINTS } from '@/hints/calc'
import type { Hint } from '@/directives/hint'
import { tryEvalExpr } from '@/engines/expr'
import { handleCellNav } from '@/utils/cell-nav'
import { repricedToastText, repriceSummaryText } from '@/utils/reprice-text'
import type { CalcComponent, CalcRowNode, MaterializeContext } from '@/engines/template-kns'
import { defaultParams, materializeNode, type CatalogNode, type NodeParamDef, type NodeParamValues } from '@/engines/node-def'
import { surveyScope, type DeviceEnv } from '@/engines/template-def'
import { recalcFotSatellites } from '@/engines/fot'
import { estimatesApi, type EstimateSnapshotInfo, type SnapshotReason } from '@/api/estimates'

const route = useRoute()
const router = useRouter()
const st = useCalcTreeStore()
const auth = useAuthStore()
const { theme, toggle } = useTheme()

/**
 * VIEWER — наблюдатель: расчёт открыт только для просмотра (ТЗ §2).
 * Роль нужна вкладке «Расчёт» в Битрикс24. Запись заблокирована и на бэке —
 * здесь только прячем/выключаем органы управления.
 */
const readOnly = computed(() => auth.role === 'VIEWER')

const saving = ref(false)
const kpBusy = ref(false)
/** Выпуск КП ждёт ответа: пересчитать цены по действующему прайсу или нет. */
const kpAsk = ref(false)
const repricing = ref(false)
/** Какая печатная форма качается прямо сейчас: «<версия>:<формат>». */
const kpDownload = ref<string | null>(null)

// ── История версий (ТЗ §7): список снапшотов + ручная фиксация ──
const versionsOpen = ref(false)
const versionsLoading = ref(false)
const versions = ref<EstimateSnapshotInfo[]>([])
/** Причина слепка — теми же словами, что в сообщениях сервера. */
const REASON_LABEL: Record<SnapshotReason, string> = {
  CREATE: 'создание единицы',
  MANUAL: 'ручная фиксация',
  KP: 'выпуск КП',
}
const snapBusy = ref(false)

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

async function openVersions() {
  if (!st.estimate) return
  versionsOpen.value = true
  versionsLoading.value = true
  try {
    versions.value = await estimatesApi.snapshots(st.estimate.id)
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Не удалось загрузить версии', 'error')
  } finally {
    versionsLoading.value = false
  }
}

/** Ручная фиксация: сначала сохраняем текущее состояние, потом снимаем его. */
async function onManualSnapshot() {
  if (!st.estimate) return
  snapBusy.value = true
  try {
    await st.save()
    const snap = await estimatesApi.createSnapshot(st.estimate.id)
    toast(`Версия v${snap.version} зафиксирована`, 'success')
    versions.value = await estimatesApi.snapshots(st.estimate.id)
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Не удалось зафиксировать версию', 'error')
  } finally {
    snapBusy.value = false
  }
}
const activeSec = ref('1')
const tableEl = ref<HTMLElement | null>(null)

const filters = reactive({ q: '', missing: false, conflict: false, override: false, repriced: false, ghosts: false, problems: false })

const markupText = ref('0,43')
const tirageText = ref('1')

const e = computed(() => st.economics)

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 3 })
const fmtInt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

const buckets = computed(() => COST_BUCKETS.map((k) => ({ k, v: e.value.buckets[k] })))

/** Строки по id — сноске ФОТ-спутника нужна родительская операция. */
const rowById = computed(() => new Map(st.rows.map((r) => [r.id, r])))

// ── Сноски топбара и дерева (правило оформления — directives/hint.ts) ──
const STATUS_HINT: Hint = {
  title: 'Статус расчёта',
  text: 'Цифры фиксирует не статус, а версия: её снимает выпуск КП, создание единицы и кнопка «Зафиксировать» в «Версиях».',
}
const PRICE_LIST_HINT: Hint = {
  title: 'Версия прайса',
  text: [
    'Цены строк фиксируются при сборке расчёта вместе с версией прайса; ставки — ФОТ, накладные, ацетон, СИЗ — берутся из действующего прайса при каждом открытии.',
    'Импортировали новый прайс — цены строк остаются прежними, пока расчёт не пересчитают по нему: кнопкой под фильтрами или правкой опросного листа.',
  ],
}
const REPRICE_HINT: Hint = {
  title: 'Пересчитать по действующему прайсу',
  text: [
    'Цена каждой строки берётся заново из действующего прайса. Строки, у которых она сменилась, получают отметку «было … ₽» и янтарную рамку цены: ✓ принимает новую, ↶ оставляет прежнюю ручной.',
    'Ручные цены остаются ручными. Договорная труба и позиции, которых в новом прайсе нет, не меняются. Расчёт сохраняется сразу.',
  ],
}
const VERSIONS_HINT: Hint = {
  title: 'История версий',
  text: 'Слепки расчёта: дерево, итог и версия прайса на момент снимка. Из них печатается КП.',
}
const KP_HINT: Hint = {
  title: 'Сформировать КП',
  text: 'Печатная форма КП в Word и PDF и новая версия расчёта. Пока есть строки без цены, КП не выпускается.',
}
const TEMPLATE_VERSION_HINT: Hint = {
  title: 'Версия шаблона изделия',
  text: [
    'Из каких разделов и узлов собран расчёт: встроенный шаблон — состав из кода, vN — версия, опубликованная технологом в редакторе шаблонов.',
    'Ред. N — редакция встроенных узлов: версия формул и состава, заданных кодом. Её поднимает релиз, меняющий то, что программа строит из опросного листа.',
    'Новая версия шаблона или редакция не меняют готовый расчёт сами: его пересобирают кнопкой под фильтрами или правкой опросного листа.',
  ],
}
const REBUILD_HINT: Hint = {
  title: 'Пересобрать по действующему шаблону',
  text: [
    'Расчёт собирается заново по опросному листу и новому шаблону. Ручные количества, цены и выключенные узлы переносятся по названиям узлов — и когда узел переехал в другой раздел.',
    'Цены строк берутся из действующего прайса, сдвиги отмечаются «было … ₽». Расчёт сохраняется сразу.',
  ],
}
const CATALOG_NODE_HINT: Hint = {
  title: 'Узел каталога',
  text: 'Готовый набор строк с формулами от параметров — площадка, комплект, обвязка. Заполните параметры, проверьте строки и добавьте: узел ляжет в раздел целиком, его строки можно править и удалять.',
}
const SECTION_ON_HINT = 'Выключить раздел: его строки не войдут в итог, ручные значения сохранятся'
const SECTION_OFF_HINT = 'Раздел выключен и в итог не входит. Включить обратно — со всеми ручными значениями'

const rentText = computed(() => `${(e.value.profitability * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} %`)
const rentColor = computed(() => {
  const p = e.value.profitability * 100
  return p >= 25 ? 'var(--green)' : p >= 15 ? 'var(--amber)' : 'var(--acc)'
})

const anyFilter = computed(
  () => filters.q !== '' || filters.missing || filters.conflict || filters.override || filters.repriced,
)

// ── Навигация назад: в проект расчёта, а без проекта — к списку проектов ──
const backTarget = computed(() =>
  st.estimate?.projectId
    ? { name: 'project', params: { id: st.estimate.projectId } }
    : { name: 'dashboard' },
)
const backLabel = computed(() => (st.estimate?.projectId ? '← Проект' : '← Проекты'))

/** Русские подписи статусов; REVIEW/APPROVED — только у старых расчётов. */
const STATUS_RU: Record<string, string> = {
  DRAFT: 'Черновик', CALC: 'Расчёт', REVIEW: 'Проверка', APPROVED: 'Утверждено', REJECTED: 'Отклонён',
}
const statusLabel = computed(() => STATUS_RU[st.estimate?.status ?? 'DRAFT'] ?? st.estimate?.status)

// ── Топбар: заказчик и № заявки — из единого блока `common` surveyData.
// Fallback на `kns`/`form` — расчёты, сохранённые до унификации контракта.
const survey = computed(() => {
  const sd = st.estimate?.surveyData as
    | { common?: Record<string, string>; kns?: Record<string, string>; form?: Record<string, string> }
    | undefined
  return sd?.common ?? sd?.kns ?? sd?.form
})
const customer = computed(() => survey.value?.zakazchik ?? null)
const zayavka = computed(() => survey.value?.zayavka ?? null)

/** Версия прайса в формате прототипа: «НН v2 от 20.05». */
const priceListLabel = computed(() => {
  const v = st.tree?.priceListVersion ?? 1
  const d = st.estimate?.updatedAt
    ? new Date(st.estimate.updatedAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    : null
  return d ? `НН v${v} от ${d}` : `НН v${v}`
})

/** Версия прайса, по которой посчитаны цены строк. */
const treePriceVersion = computed(() => st.tree?.priceListVersion ?? 1)

/** Версия шаблона, по которой собран состав: без отметки — встроенный. */
const treeTemplateVersion = computed(() => st.tree?.templateVersion ?? 0)
const templateLabel = (v: number) => (v ? `v${v}` : 'встроенный')
/** «по шаблону v2» / «по встроенному шаблону» — для кнопки и тоста. */
const templateRef = (v: number) => (v ? `по шаблону v${v}` : 'по встроенному шаблону')
/** «v2 · ред. 3» / «встроенный · ред. 3»; редакции нет — прочерк. */
const compositionLabel = (v: number, rev: number | null | undefined) => `${templateLabel(v)} · ред. ${rev ?? '—'}`

const fmtRevDate = (iso: string) => iso.split('-').reverse().join('.')

/** Заголовок плашки: что именно устарело — версия шаблона или редакция кода. */
const outdatedTitle = computed(() => {
  if (st.templateChanged) {
    return `Состав расчёта собран ${templateRef(treeTemplateVersion.value)}, а действует ${st.activeTemplateVersion ? `v${st.activeTemplateVersion}` : 'встроенный шаблон'}.`
  }
  const rev = st.tree?.builtinRevision
  return rev == null
    ? `Состав расчёта собран до учёта редакций встроенных узлов, в программе — редакция ${st.activeBuiltinRevision}.`
    : `Состав расчёта собран встроенными узлами редакции ${rev}, а в программе — редакция ${st.activeBuiltinRevision}.`
})

/** Пояснение плашки: у новой редакции — что изменилось, по журналу редакций. */
const outdatedDetail = computed(() => {
  const after = 'Пересборка возьмёт состав по опросному листу; ручные правки перенесутся, а узлы, которых в шаблоне больше нет, уйдут из расчёта.'
  if (st.templateChanged) return `Шаблон изделия обновили. ${after}`
  const changes = st.builtinChanges.map((r) => `ред. ${r.version} от ${fmtRevDate(r.date)} — ${r.note}`)
  return changes.length ? `Что изменилось: ${changes.join('; ')}. ${after}` : after
})

/** Что даст пересчёт по действующему прайсу — словами (utils/reprice-text.ts). */
const repriceText = computed(() => (st.repricePreview ? repriceSummaryText(st.repricePreview) : ''))

/** Счётчик проблем — кнопка появляется только когда есть что показывать. */
const hasProblems = computed(() => st.missingPriceIds.size > 0 || st.conflictIds.size > 0)
const problemsText = computed(() => {
  const parts: string[] = []
  if (st.missingPriceIds.size) parts.push(`● ${st.missingPriceIds.size} без цены`)
  if (st.conflictIds.size) parts.push(`⚠ ${st.conflictIds.size} конфликт`)
  return parts.join(' · ')
})

function clearFilters() {
  filters.q = ''
  filters.missing = filters.conflict = filters.override = filters.repriced = filters.problems = false
}
function toggleProblems() {
  filters.problems = !filters.problems
  filters.missing = filters.conflict = filters.problems
}

/** Фильтрация строк компонента — единое правило для таблицы и счётчика. */
function visibleRows(c: CalcComponent): CalcRowNode[] {
  return c.rows.filter((r) => {
    const res = st.results.get(r.id)
    if (!res) return false
    if (!filters.ghosts && res.qty === 0 && !st.enabledFor(r)) return false
    if (filters.q && !r.name.toLowerCase().includes(filters.q.toLowerCase())) return false

    const chips = filters.missing || filters.conflict || filters.override || filters.repriced
    if (!chips) return true
    return (
      (filters.missing && st.missingPriceIds.has(r.id)) ||
      (filters.conflict && st.conflictIds.has(r.id)) ||
      (filters.override && st.overrideIds.has(r.id)) ||
      (filters.repriced && st.priceDeltaIds.has(r.id))
    )
  })
}

const visibleSections = computed(() => st.tree?.sections ?? [])
const shownCount = computed(() =>
  visibleSections.value.reduce((s, sec) => s + sec.components.reduce((n, c) => n + visibleRows(c).length, 0), 0),
)

function sumOf(rows: CalcRowNode[]): number {
  return rows.reduce((s, r) => s + (st.results.get(r.id)?.sum ?? 0), 0)
}
function sectionSum(code: string): string {
  const sec = st.tree?.sections.find((s) => s.code === code)
  if (!sec) return '—'
  const v = sumOf(sec.components.flatMap((c) => c.rows))
  return v >= 1e6 ? `${(v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} млн` : fmtInt(v)
}
function componentSum(c: CalcComponent): string {
  return fmtInt(sumOf(c.rows))
}

function secProblems(code: string) {
  const sec = st.tree?.sections.find((s) => s.code === code)
  if (!sec) return { red: 0, amber: 0 }
  const ids = sec.components.flatMap((c) => c.rows.map((r) => r.id))
  return {
    red: ids.filter((id) => st.missingPriceIds.has(id)).length,
    amber: ids.filter((id) => st.conflictIds.has(id)).length,
  }
}

const secTitle = (code: string) => st.tree?.sections.find((s) => s.code === code)?.title ?? code

/** «Было» в плашке конфликта — старое расчётное из снимка, не текущее. */
const prevCalcOf = (id: string): number | null => st.prevQtyCalc[id] ?? null

function goSection(code: string) {
  activeSec.value = code
  document.getElementById(`grp-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Scrollspy: активна группа, ближайшая к верху таблицы. */
function onScroll() {
  const el = tableEl.value
  if (!el) return
  const top = el.getBoundingClientRect().top
  for (const sec of visibleSections.value) {
    const n = document.getElementById(`grp-${sec.code}`)
    if (n && n.getBoundingClientRect().top - top <= 40) activeSec.value = sec.code
  }
}

/** Клавиатура: Enter — вниз, ↑↓ по строкам, ←→ кол-во ⇄ цена, Esc — отмена. */
/**
 * Клавиатура в таблице — как в Excel (utils/cell-nav.ts). Enter в последней
 * строке таблицы или фильтра снимает фокус: ввод ячейки фиксируется только
 * уходом из неё, и раньше цена, введённая туда, не применялась.
 */
function onNav(ev: KeyboardEvent, _id: string, col: 'qty' | 'price') {
  handleCellNav(ev, [...(tableEl.value?.querySelectorAll<HTMLInputElement>('.cell') ?? [])], col)
}

function onMarkup() {
  const v = tryEvalExpr(markupText.value)
  if (v == null || v < 0) { toast('Наценка должна быть числом ≥ 0', 'error'); markupText.value = String(st.markup).replace('.', ','); return }
  st.markup = v
}
function onTirage() {
  const v = tryEvalExpr(tirageText.value)
  if (v == null || v < 1) { toast('Корпусов — целое число ≥ 1', 'error'); tirageText.value = String(st.tirage); return }
  st.tirage = Math.floor(v)
  tirageText.value = String(st.tirage)
}

// ── Добавление строк (прототип: пунктирные кнопки под каждой сборкой) ──

const catalogOpen = ref(false)
const catalogSec = ref('1')
const catalogQ = ref('')

function openCatalog(sectionCode: string) {
  catalogSec.value = sectionCode
  catalogQ.value = ''
  catalogMode.value = 'price'
  pickedNode.value = null
  catalogOpen.value = true
}

/** Поиск по прайсу: категория · наименование · ЕИ · цена (README). */
const catalogHits = computed(() => {
  const q = catalogQ.value.trim().toLowerCase()
  if (q.length < 2) return []
  // Ограничиваем выдачу: прайс — 1040 позиций, показывать все бессмысленно.
  return st.catalog.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 40)
})

function addFromCatalog(p: { category: string; name: string; unit: string; priceRub: number | null }) {
  st.addRow(catalogSec.value, {
    category: p.category as CalcRowNode['category'],
    name: p.name,
    unit: p.unit,
    priceCatalog: p.priceRub,
    qtyManual: '1',
  })
  catalogOpen.value = false
  toast(`Добавлено: ${p.name}`, 'success')
}

// ── Узел каталога: параметры, предпросмотр строк, вставка ──

const catalogMode = ref<'price' | 'node'>('price')
const pickedNode = shallowRef<CatalogNode | null>(null)
const nodeValues = reactive<NodeParamValues>({})
const nodeCtx = shallowRef<MaterializeContext | null>(null)

/**
 * Выбрать узел: параметры — умолчания узла, а те, что названы как поле ОЛ
 * («dn», «depthMm»), — значения из опросного листа этого расчёта.
 */
async function pickNode(n: CatalogNode) {
  for (const k of Object.keys(nodeValues)) delete nodeValues[k]
  Object.assign(nodeValues, defaultParams(n.body))
  const tree = st.tree
  if (tree) {
    const scope = surveyScope({ device: tree.deviceType, survey: tree.survey } as unknown as DeviceEnv)
    for (const p of n.body.params) {
      const v = scope[p.key]
      if (v == null) continue
      if ((p.type === 'number' && typeof v === 'number') || (p.type === 'bool' && typeof v === 'boolean') || (p.type === 'text' && typeof v === 'string')) {
        nodeValues[p.key] = v
      }
    }
  }
  pickedNode.value = n
  nodeCtx.value = await st.ensureContext()
}

const nodeValueText = (p: NodeParamDef) => {
  const v = nodeValues[p.key]
  return typeof v === 'number' ? String(v).replace('.', ',') : typeof v === 'string' ? v : ''
}
function setNodeValue(p: NodeParamDef, text: string) {
  nodeValues[p.key] = p.type === 'number' ? (text.trim() === '' ? null : tryEvalExpr(text)) : text
}

/** Строки узла с текущими параметрами — то, что ляжет в раздел. */
const nodePreview = computed(() => {
  const n = pickedNode.value
  const ctx = nodeCtx.value
  if (!n || !ctx) return null
  const comp = materializeNode(ctx, n, { ...nodeValues })
  const rows = recalcFotSatellites(comp.rows)
  return {
    title: comp.title,
    rows: rows.map((r) => {
      const price = r.priceManual ?? r.priceCatalog
      return {
        id: r.id,
        name: r.kind === 'ФОТ' ? '↳ ФОТ' : r.name,
        qty: r.qtyCalc == null ? '—' : fmt(r.qtyCalc),
        unit: r.unit,
        price: price == null ? 'нет цены' : fmtInt(price),
        missing: price == null && r.qtyCalc !== 0,
      }
    }),
  }
})

function addNodeFromCatalog() {
  const n = pickedNode.value
  if (!n) return
  const comp = st.addCatalogNode(catalogSec.value, n, { ...nodeValues })
  if (!comp) { toast('Не удалось добавить узел', 'error'); return }
  catalogOpen.value = false
  pickedNode.value = null
  toast(`Добавлен узел «${comp.title}»`, 'success')
}

// ── Пересборка по действующему шаблону ──

const rebuilding = ref(false)

async function onRebuildTemplate() {
  const to = st.activeTemplateVersion
  const byTemplate = st.templateChanged
  const rev = st.activeBuiltinRevision
  const problem = st.rebuildByActiveTemplate()
  if (problem) { toast(problem, 'error'); return }
  const conflicts = st.conflictIds.size
  if (conflicts) filters.conflict = true
  rebuilding.value = true
  try {
    await st.save()
    toast(
      `Расчёт пересобран ${byTemplate ? templateRef(to) : `по редакции ${rev}`}: ручные правки перенесены` +
        (conflicts ? ` · конфликтов с расчётным: ${conflicts}` : ''),
      'success',
    )
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Расчёт пересобран, но сохранить его не удалось', 'error')
  } finally {
    rebuilding.value = false
  }
}

/** Свободная строка рождается «красной» — без цены (README). */
function addFreeRow(sectionCode: string) {
  st.addRow(sectionCode, { name: 'Новая строка', qtyManual: '1' })
  toast('Свободная строка добавлена — заполните наименование и цену')
}

async function onExport() {
  // Заявка на закупку — отчёт поверх этого же расчёта (ТЗ §9.6).
  // Сохраняем перед переходом: иначе заявка покажет данные до тюнинга.
  if (!st.estimate) return
  try {
    await st.save()
  } catch {
    // Не блокируем просмотр заявки: стор общий, строки посчитаются из памяти.
  }
  await router.push({ name: 'purchase-request', params: { id: st.estimate.id } })
}

/**
 * Пересчитать цены по действующему прайсу и сразу сохранить: это массовая
 * правка, и потерять её уходом с экрана было бы обидно. Изменившиеся строки
 * показываются фильтром — их и проверять.
 */
async function onReprice() {
  const summary = st.repriceToCurrent()
  if (!summary) return
  if (summary.changed) filters.repriced = true
  repricing.value = true
  try {
    await st.save()
    toast(repricedToastText(summary.changed, st.priceListVersion), 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Цены пересчитаны, но сохранить расчёт не удалось', 'error')
  } finally {
    repricing.value = false
  }
}

async function onSave() {
  saving.value = true
  try {
    await st.save()
    toast('Расчёт сохранён', 'success')
  } catch (err) {
    toast(err instanceof Error ? err.message : 'Не удалось сохранить', 'error')
  } finally {
    saving.value = false
  }
}

/**
 * Скачать печатную форму КП по конкретной редакции.
 *
 * Документ собирается на сервере из снапшота: расчёт после выпуска КП
 * продолжает правиться, поэтому печатать «текущее состояние» нельзя —
 * заказчик согласовывал зафиксированное.
 *
 * Доступно и наблюдателю: чтение КП шире правки расчёта.
 */
async function downloadKp(version: number, format: 'docx' | 'pdf') {
  if (!st.estimate) return
  kpDownload.value = `${version}:${format}`
  try {
    const blob = await estimatesApi.kpExport(st.estimate.id, format, version)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `КП_${st.estimate.title}_v${version}.${format}`
    a.click()
    URL.revokeObjectURL(url)
    toast(`КП v${version} выгружено (${format})`, 'success')
  } catch (err) {
    const r = (err as { response?: { data?: { message?: string } } }).response
    toast(r?.data?.message ?? 'Не удалось выгрузить КП', 'error')
  } finally {
    kpDownload.value = null
  }
}

/**
 * Выпуск КП — точка фиксации процесса (ТЗ §4.3 v1.5): гейт по красным строкам
 * и снапшот делает бэк. Печатная форма (docx/pdf) скачивается из окна «Версии»:
 * она строится из снапшота, а не из текущего дерева.
 */
async function onKp() {
  if (!st.estimate) return
  // Прайс обновился после сборки расчёта — КП по старым ценам выпускается
  // только осознанно: окно предлагает пересчитать.
  if (st.priceOutdated) {
    kpAsk.value = true
    return
  }
  await issueKp()
}

async function kpRepriceAndIssue() {
  kpAsk.value = false
  const summary = st.repriceToCurrent()
  if (summary?.changed) filters.repriced = true
  await issueKp()
}

async function kpIssueAsIs() {
  kpAsk.value = false
  await issueKp()
}

async function issueKp() {
  if (!st.estimate) return
  kpBusy.value = true
  try {
    await st.save()
    const data = await estimatesApi.kp(st.estimate.id)
    toast(`КП сформировано · снапшот v${data.snapshot.version} (прайс v${data.snapshot.priceListVersion})`, 'success')
  } catch (err) {
    const r = (err as { response?: { data?: { code?: string; count?: number; message?: string } } }).response
    if (r?.data?.code === 'ROWS_WITHOUT_PRICE') {
      toast(r.data.message ?? 'Есть строки без цены', 'error')
      filters.missing = true // сразу показываем, что чинить
    } else {
      toast(r?.data?.message ?? 'Не удалось сформировать КП', 'error')
    }
  } finally {
    kpBusy.value = false
  }
}

watch(() => st.markup, (v) => { markupText.value = String(v).replace('.', ',') }, { immediate: true })

// Отметок о новых ценах не осталось — фильтр по ним снимается вместе с его
// кнопкой, иначе таблица осталась бы пустой без видимой причины.
watch(() => st.priceDeltaIds.size, (n) => { if (!n) filters.repriced = false })

onMounted(() => {
  const id = route.params.id
  if (typeof id === 'string' && id) void st.load(id)
})
</script>

<style scoped>
.cw { display: flex; flex-direction: column; height: 100vh; background: var(--bg); color: var(--text); }

.tb { display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 7px 12px; border-bottom: 2px solid var(--line); background: var(--panel); flex: none; }
.tb-l { display: flex; align-items: center; gap: 12px; min-width: 0; }
.tb-t { font-size: 15.6px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-lnk { font-size: 13.2px; color: var(--muted); text-decoration: none; }
.tb-lnk:hover { color: var(--text); }
.badge { font-size: 11.4px; border: 1px solid var(--line2); color: var(--muted); padding: 1px 6px; }
.tb-r { display: flex; align-items: center; gap: 7px; flex: none; }
.tb-ro { font-size: 12.6px; color: var(--amber); border: 1px solid var(--amber); padding: 2px 8px; }
.tb-prob { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.2px; padding: 4px 9px; }
.tb-prob.on { border-color: var(--amber); color: var(--amber); }
.tb-pl { font-size: 12.6px; color: var(--faint); }
.tb-pl.old { color: var(--amber); }
.btn { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.8px; padding: 4px 10px; }
.btn:hover:not(:disabled) { color: var(--text); }
.btn:disabled { opacity: .4; }
.btn-acc { border-color: var(--acc); color: var(--acc); }

.fl { display: flex; align-items: center; gap: 8px; padding: 6px 12px;
  border-bottom: 1px solid var(--line); background: var(--panel); flex: none; }
.fl-q { width: 200px; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text); padding: 4px 8px; font-size: 13.8px; font-family: inherit; }
.chip-f { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 12.6px; padding: 3px 8px; }
.chip-red.on { border-color: var(--acc); color: var(--acc); background: var(--acc-bg); }
.chip-amber.on { border-color: var(--amber); color: var(--amber); background: var(--amber-bg); }
.chip-blue.on { border-color: var(--blue); color: var(--blue); background: var(--blue-bg); }
.fl-clear { background: transparent; border: none; color: var(--blue); font-size: 13.2px; text-decoration: underline; }
.fl-chk { display: flex; align-items: center; gap: 4px; font-size: 13.2px; color: var(--muted); }
.fl-cnt { margin-left: auto; font-size: 12.6px; color: var(--faint); }

/* Прайс обновился после сборки расчёта */
.pbar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 12px; padding: 7px 12px;
  border-bottom: 1px solid var(--amber); background: var(--amber-bg); font-size: 13.2px; flex: none; }
.pbar-t { color: var(--amber); font-weight: 600; }
.pbar-d { color: var(--muted); flex: 1 1 320px; min-width: 0; }
.kpa-t { font-size: 14.4px; color: var(--text); line-height: 1.5; margin: 0 0 10px; }

.state { padding: 24px; color: var(--muted); font-size: 14.4px; }
.state-err { color: var(--acc); }

/* История версий */
.ver-sub { font-size: 13.2px; color: var(--muted); margin-bottom: 10px; line-height: 1.5; }
.ver-state { font-size: 14.4px; color: var(--faint); padding: 12px 0; }
.ver-tbl { width: 100%; border-collapse: collapse; font-size: 13.8px; }
.ver-tbl th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--faint); padding: 4px 6px; border-bottom: 1px solid var(--line); }
.ver-tbl td { padding: 5px 6px; border-bottom: 1px solid var(--line); }
.ver-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
.ver-tpl { display: block; font-size: 12px; color: var(--muted); }
.ver-tbl th.ver-thw { white-space: normal; }
.ver-dl { white-space: nowrap; }
.ver-dl--none { color: var(--faint); text-align: center; }
.ver-reason { font-size: 12.6px; color: var(--muted); white-space: nowrap; }
.ver-dl .btn-xs { padding: 2px 7px; font-size: 13.2px; line-height: 1.5; }
.ver-dl .btn-xs + .btn-xs { margin-left: 4px; }

.body { flex: 1; display: flex; min-height: 0; }

/* Дерево сборок */
.tree { width: 224px; flex: none; border-right: 1px solid var(--line); background: var(--panel); overflow-y: auto; padding: 6px 0; }
.tr-s { display: flex; align-items: center; gap: 4px; padding: 0 8px 0 0; border-left: 3px solid transparent; }
.tr-s.active { border-left-color: var(--acc); background: var(--panel2); }
.tr-s.off { opacity: .5; }
.tr-chk { padding: 0 4px 0 6px; display: flex; }
.tr-n { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px;
  background: transparent; border: none; color: inherit; text-align: left; padding: 6px 2px; }
.tr-t { font-size: 13.8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.tr-sum { font-size: 12px; color: var(--muted); }
.tr-sum.struck { text-decoration: line-through; }
.bdg { font-size: 10.8px; padding: 0 4px; white-space: nowrap; }
.bdg-red { color: var(--acc); }
.bdg-amber { color: var(--amber); }

/* Таблица */
.tbl { flex: 1; overflow: auto; min-width: 0; }
.th, .gh, .ch { display: grid; grid-template-columns: 104px minmax(180px, 1fr) 96px 52px 96px 100px 168px; gap: 8px; padding: 0 8px; }
.th { position: sticky; top: 0; z-index: 3; height: 25px; align-items: center;
  background: var(--panel2); border-bottom: 1px solid var(--line2);
  font-size: 11.4px; text-transform: uppercase; letter-spacing: .06em; color: var(--faint); }
.th .num { text-align: right; }
.gh { position: sticky; top: 25px; z-index: 2; height: 26px; align-items: center;
  background: var(--panel); border-bottom: 1px solid var(--line2);
  font-size: 13.2px; font-weight: 700; grid-template-columns: 1fr auto; }
.gh.off { opacity: .5; }
.gh-sum { font-size: 12.6px; font-weight: 400; color: var(--muted); }
.ch { grid-template-columns: 1fr auto; height: 22px; align-items: center; font-size: 12.6px; color: var(--muted); background: var(--cellbg); }
.ch-sum { font-size: 12px; color: var(--faint); }
.empty { padding: 10px 14px; font-size: 13.2px; color: var(--faint); font-style: italic; }

/* Итоги */
.tot { width: 264px; flex: none; border-left: 2px solid var(--line); background: var(--panel);
  padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px; }
.tot-h { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--faint); }
.tot-r { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13.8px; }
.tot-r > span:first-child { color: var(--muted); }
.tot-cost { border-top: 2px solid var(--line2); padding-top: 5px; margin-top: 3px; font-weight: 700; }
.tot-cost > span:first-child { color: var(--text); }
.tot-price { font-size: 18px; font-weight: 700; }
.tot-price > span:first-child { color: var(--text); }
.tot-n { color: var(--muted); }
.tot-in { width: 62px; text-align: right; background: var(--cellbg); border: 1px solid var(--line2);
  color: var(--text); padding: 2px 6px; font-size: 14.4px; font-family: inherit; }
.tot-d { margin-top: 4px; border-top: 1px solid var(--line); padding-top: 5px; }
.tot-d summary { font-size: 12.6px; color: var(--faint); cursor: pointer; }
.tot-s { font-size: 12.6px; margin-top: 3px; }
.tot-note { font-size: 11.4px; color: var(--faint); margin-top: 4px; }
/* Легенда — точные значения прототипа: 10.5px, --faint, line-height 1.6,
   таблица клавиш сеткой auto/1fr с разделителем сверху. */
.tot-legend { margin-top: auto; padding-top: 12px; font-size: 12.6px; color: var(--faint); line-height: 1.6; }
.keys { margin-top: 8px; border-top: 1px solid var(--line); padding-top: 8px;
  display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.keys .k { color: var(--muted); white-space: nowrap; }

/* Заголовки зон «Сборки» / «Итоги» — 10px, letter-spacing .08em, --faint. */
.zone-h { padding: 4px 12px 6px; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }

/* Кнопки добавления строк — пунктирная рамка (прототип). */
.add { padding: 8px 12px; display: flex; gap: 8px; }
.add-b { background: transparent; border: 1px dashed var(--line2); padding: 5px 12px;
  color: var(--muted); font-size: 13.8px; }
.add-b:hover { color: var(--text); }

/* Модал каталога */
.cat-sub { font-size: 13.2px; color: var(--faint); margin-bottom: 8px; }
.cat-q { width: 100%; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text);
  padding: 6px 9px; font-size: 15px; font-family: inherit; }
.cat-list { margin-top: 8px; max-height: 46vh; overflow-y: auto; }
.cat-i { display: grid; grid-template-columns: 150px 1fr 44px 88px; gap: 8px; align-items: center;
  width: 100%; text-align: left; background: transparent; border: none;
  border-bottom: 1px solid var(--line); padding: 5px 4px; color: var(--text); font-size: 13.8px; }
.cat-i:hover { background: var(--panel2); }
.cat-c { font-size: 11.4px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cat-u { font-size: 12px; color: var(--muted); }
.cat-p { text-align: right; }
.cat-empty { padding: 10px 4px; font-size: 13.2px; color: var(--faint); }
.cat-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.cat-tab { background: transparent; border: 1px solid var(--line2); color: var(--muted); font-size: 13.2px; padding: 3px 10px; }
.cat-tab.on { border-color: var(--acc); color: var(--text); background: var(--acc-bg); }
.cat-node { display: flex; flex-direction: column; gap: 6px; }
.cat-nh { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 14.4px; }
.cat-pgrid { display: grid; grid-template-columns: 1fr; gap: 4px; }
.cat-pf { display: grid; grid-template-columns: minmax(0, 1fr) 120px; gap: 6px; align-items: center; font-size: 13.2px; color: var(--muted); }
.cat-in { width: 100%; background: var(--cellbg); border: 1px solid var(--line2); color: var(--text); padding: 3px 6px; font-size: 13.8px; font-family: inherit; }
.cat-in.num { text-align: right; }
.cat-pr { display: grid; grid-template-columns: minmax(0, 1fr) 56px 40px 72px; gap: 6px; padding: 3px 4px; border-bottom: 1px solid var(--line); font-size: 13.2px; }
.cat-pr.red .cat-n, .cat-pr.red span:last-child { color: var(--acc); }
.cat-pr .num { text-align: right; font-variant-numeric: tabular-nums; }
.ch-del { margin-left: 8px; background: transparent; border: none; color: var(--faint); font-size: 12px; cursor: pointer; }
.ch-del:hover { color: var(--acc); }

.tb-cust { font-size: 13.8px; color: var(--muted); }
.tb-zv { font-size: 13.2px; color: var(--faint); }

@media (max-width: 1100px) { .tree { display: none; } }
</style>
