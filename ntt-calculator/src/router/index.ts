import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { UserRole } from '@/stores/auth'

// ── Views (lazy-loaded except the most common ones) ────────────────────────
import LoginView      from '@/views/LoginView.vue'
import DashboardView  from '@/views/DashboardView.vue'
const ProjectView = () => import('@/views/ProjectView.vue')
const PricesView  = () => import('@/views/PricesView.vue')
const AdminView   = () => import('@/views/AdminView.vue')

// ── Route meta types ───────────────────────────────────────────────────────
declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    roles?: UserRole[]   // if set, only these roles can access
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresAuth: false },
    },
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
      meta: { requiresAuth: true },
    },
    {
      path: '/projects/:id',
      name: 'project',
      component: ProjectView,
      meta: { requiresAuth: true },
    },
    {
      // Единый опросный лист — вход в процесс: ОЛ → материализация →
      // калькулятор. Один экран, ветвление по типу изделия (ТЗ §5.6).
      // Без :id — создание (?type=KNS|EMK|KOL, ?project=<id> привязывает
      // к проекту); с :id — редактирование ОЛ существующего расчёта.
      path: '/survey/:id?',
      name: 'survey',
      component: () => import('@/views/SurveyView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    // Прежние адреса трёх отдельных ОЛ — редиректы на единый экран.
    { path: '/survey/kns', redirect: { name: 'survey', query: { type: 'KNS' } } },
    { path: '/survey/emk', redirect: { name: 'survey', query: { type: 'EMK' } } },
    { path: '/survey/kol', redirect: { name: 'survey', query: { type: 'KOL' } } },
    {
      // Конфигуратор расчёта по прототипу «Калькулятор v2»: материализованное
      // дерево «Сборка→Компонент→Строка» (§9).
      path: '/calculator/:id?',
      name: 'calculator',
      component: () => import('@/views/CalculatorTreeView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    {
      // Заявка на закупку — отчёт поверх расчёта (ТЗ §9.6), поэтому вложена
      // в его маршрут. BUYER ведёт закупку по чужим расчётам.
      path: '/calculator/:id/purchase',
      name: 'purchase-request',
      component: () => import('@/views/PurchaseRequestView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER', 'BUYER'] },
    },
    {
      path: '/prices',
      name: 'prices',
      component: PricesView,
      meta: { requiresAuth: true, roles: ['ADMIN', 'BUYER'] },
    },
    {
      // Редактор шаблонов (ТЗ §2): технолог правит справочники, из которых
      // материализуются шаблоны — нормы патрубков, веса труб, матрицы.
      path: '/templates',
      name: 'templates',
      component: () => import('@/views/TemplatesView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'TECHNOLOG'] },
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: { requiresAuth: true, roles: ['ADMIN'] },
    },
    // Catch-all → dashboard
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

// ── Navigation guard ───────────────────────────────────────────────────────
router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // Run checkAuth once on first navigation
  if (!auth.isLoggedIn && auth.accessToken) {
    await auth.checkAuth()
  }

  // Public route — redirect logged-in users away from login
  if (to.meta.requiresAuth === false) {
    if (auth.isLoggedIn && to.name === 'login') return { name: 'dashboard' }
    return true
  }

  // Protected route — redirect to login if not authenticated
  if (!auth.isLoggedIn) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Role check
  const allowed = to.meta.roles
  if (allowed && auth.role && !allowed.includes(auth.role)) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
