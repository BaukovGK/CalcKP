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
      // Опросный лист КНС — вход в процесс: ОЛ → материализация → калькулятор.
      path: '/survey/kns',
      name: 'survey-kns',
      component: () => import('@/views/SurveyKnsView.vue'),
      meta: { requiresAuth: true, roles: ['ADMIN', 'MANAGER', 'ENGINEER'] },
    },
    {
      path: '/calculator/:id?',
      name: 'calculator',
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
