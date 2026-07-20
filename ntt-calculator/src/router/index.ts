import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import type { UserRole } from '@/stores/auth'

// ── Views (lazy-loaded except the most common ones) ────────────────────────
import LoginView      from '@/views/LoginView.vue'
import DashboardView  from '@/views/DashboardView.vue'
import CalculatorView from '@/views/CalculatorView.vue'
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
      // Опросные листы — вход в процесс: ОЛ → материализация → калькулятор.
      // Три изделия, три набора полей (ТЗ §5.6); каркас экрана общий.
      path: '/survey/kns',
      name: 'survey-kns',
      component: () => import('@/views/SurveyKnsView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    {
      path: '/survey/emk',
      name: 'survey-emk',
      component: () => import('@/views/SurveyEmkView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    {
      path: '/survey/kol',
      name: 'survey-kol',
      component: () => import('@/views/SurveyKolView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
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
      // Прежний экран свободного дерева — оставлен до переноса ручных строк
      // и DnD, недоступен из навигации.
      path: '/calculator-legacy/:id?',
      name: 'calculator-legacy',
      component: CalculatorView,
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    {
      path: '/prices',
      name: 'prices',
      component: PricesView,
      meta: { requiresAuth: true, roles: ['ADMIN', 'BUYER'] },
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
