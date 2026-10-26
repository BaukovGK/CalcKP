<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo">Инструкции</div>
        <div class="logo-sub">{{ auth.user?.name }}</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Инструкции</div>
        <button
          v-for="d in HELP_DOCS"
          :key="d.slug"
          class="nav-link"
          :class="{ 'nav-link--active': d.slug === slug }"
          @click="open(d.slug)"
        >{{ d.label }}</button>
      </div>
      <div class="sidebar-footer">
        <BugReportButton />
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">{{ doc?.title ?? 'Инструкции' }}</div>
      </div>

      <div ref="area" class="calc-area">
        <div v-if="!doc" class="hp-empty">Инструкция не найдена.</div>
        <template v-else>
          <!-- Оглавление — в тексте, а не в боковой панели: во вкладке Битрикс24
               панель ложится строкой сверху, и длинный список её бы раздул. -->
          <nav v-if="toc.length" class="hp-toc" aria-label="Содержание">
            <div class="hp-toc-h">Содержание</div>
            <a
              v-for="t in toc"
              :key="t.id"
              href="#"
              class="hp-toc-i"
              @click.prevent="scrollTo(t.id)"
            >{{ t.text }}</a>
          </nav>
          <!-- Текст инструкции из репозитория, HTML экранирован (utils/markdown.ts). -->
          <article class="hp" @click="onArticleClick" v-html="doc.html"></article>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BugReportButton from '@/components/ui/BugReportButton.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import { useAuthStore } from '@/stores/auth'
import { defaultHelpDoc, HELP_DOCS, renderHelpDoc } from '@/utils/help-docs'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const area = ref<HTMLElement | null>(null)

/** Какая инструкция: из адреса, без него — по роли. */
const slug = computed(() => {
  const p = route.params.doc
  return typeof p === 'string' && p ? p : defaultHelpDoc(auth.role)
})
const doc = computed(() => renderHelpDoc(slug.value))
/** В оглавлении — только разделы второго уровня: подразделы его раздувают. */
const toc = computed(() => doc.value?.toc.filter((t) => t.level === 2) ?? [])

function open(s: string) {
  void router.push({ name: 'help', params: { doc: s } })
}

function scrollTo(id: string) {
  area.value?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Ссылки между инструкциями — переход внутри экрана, без перезагрузки. */
function onArticleClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-doc]')
  if (!a) return
  e.preventDefault()
  open(a.dataset.doc!)
}

watch(slug, async () => {
  await nextTick()
  area.value?.scrollTo({ top: 0 })
})
</script>

<style scoped>
.hp-empty { color: var(--muted); font-size: 13.5px; padding: 20px 4px; }

.hp-toc {
  max-width: 980px; margin: 4px 0 18px; padding: 10px 14px 12px;
  background: var(--panel); border: 1px solid var(--line);
  display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 2px 18px;
}
.hp-toc-h {
  grid-column: 1 / -1; font-size: 11px; font-weight: 600; letter-spacing: .08em;
  text-transform: uppercase; color: var(--faint); margin-bottom: 4px;
}
.hp-toc-i { font-size: 13.5px; color: var(--muted); text-decoration: none; padding: 2px 0; }
.hp-toc-i:hover { color: var(--acc); }

/* ── Текст инструкции ─────────────────────────────────────────────────────── */
.hp { max-width: 980px; font-size: 14px; line-height: 1.55; color: var(--text); }
.hp :deep(h2) {
  font-family: Archivo, system-ui, sans-serif; font-size: 17px; font-weight: 700;
  margin: 26px 0 10px; padding-bottom: 5px; border-bottom: 1px solid var(--line); scroll-margin-top: 10px;
}
.hp :deep(h3) { font-size: 15px; font-weight: 700; margin: 20px 0 8px; scroll-margin-top: 10px; }
.hp :deep(h4) { font-size: 14px; font-weight: 700; margin: 16px 0 6px; }
.hp :deep(p) { margin: 0 0 10px; }
.hp :deep(ul),
.hp :deep(ol) { margin: 0 0 10px; padding-left: 22px; }
.hp :deep(li) { margin: 3px 0; }
.hp :deep(li > ul),
.hp :deep(li > ol) { margin: 4px 0 2px; }
.hp :deep(strong) { font-weight: 700; }
.hp :deep(a) { color: var(--blue); text-decoration: none; border-bottom: 1px dotted currentColor; }
.hp :deep(a:hover) { color: var(--acc); }
.hp :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12.5px;
  background: var(--panel2); padding: 1px 4px;
}
.hp :deep(pre) {
  background: var(--panel); border: 1px solid var(--line); padding: 10px 14px; margin: 0 0 12px;
  overflow-x: auto; font-size: 12.5px; line-height: 1.45;
}
.hp :deep(pre code) { background: none; padding: 0; }
.hp :deep(hr) { border: none; border-top: 1px solid var(--line); margin: 20px 0; }

/* Примечание — как пояснения в опросном листе: полоса слева, без заливки «тревоги». */
.hp :deep(blockquote) {
  margin: 0 0 12px; padding: 8px 12px; border-left: 3px solid var(--blue);
  background: var(--blue-bg); color: var(--text);
}
.hp :deep(blockquote p:last-child) { margin-bottom: 0; }

/* Таблицы — как в администрировании: подписи столбцов мелкими прописными. */
.hp :deep(.tbl-wrap) { overflow-x: auto; margin: 0 0 14px; }
.hp :deep(table) { border-collapse: collapse; width: 100%; font-size: 13.5px; background: var(--cellbg); }
.hp :deep(th) {
  text-align: left; font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--faint); padding: 7px 10px; border-bottom: 1px solid var(--line2); background: var(--panel);
}
.hp :deep(td) { padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
.hp :deep(.al-center) { text-align: center; }
.hp :deep(.al-right) { text-align: right; font-variant-numeric: tabular-nums; }

/* Рисунок: во всю ширину текста, щелчок открывает полный размер. */
.hp :deep(figure) { margin: 6px 0 18px; }
.hp :deep(figure a) { border: none; display: block; }
.hp :deep(figure img) {
  display: block; max-width: 100%; height: auto; border: 1px solid var(--line);
  background: var(--cellbg); cursor: zoom-in;
}
.hp :deep(figcaption) { font-size: 12.5px; color: var(--muted); margin-top: 6px; }
</style>
