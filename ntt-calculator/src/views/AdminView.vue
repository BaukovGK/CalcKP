<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">Администрирование</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Разделы</div>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'users' }"  @click="tab = 'users'">Пользователи</button>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'audit' }"  @click="tab = 'audit'; loadAudit()">Аудит-лог</button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">{{ tab === 'users' ? 'Пользователи' : 'Аудит-лог' }}</div>
        <div class="tb-spacer"></div>
        <button v-if="tab === 'users'" class="btn" @click="newUserOpen = true">＋ Новый пользователь</button>
      </div>

      <!-- ── Users ── -->
      <div v-if="tab === 'users'" class="calc-area">
        <div v-if="usersLoading" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <div v-else-if="usersError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ usersError }}</div>
          <button class="btn btn-g" @click="loadUsers">Повторить</button>
        </div>
        <table v-else class="adm-table">
          <thead>
            <tr>
              <th>Имя</th><th>Email</th><th>Роль</th><th>Активен</th><th>Зарегистрирован</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>{{ u.name }}</td>
              <td class="adm-email">{{ u.email }}</td>
              <td>
                <select
                  class="fi adm-role-sel"
                  :value="u.role"
                  @change="patchUser(u.id, { role: ($event.target as HTMLSelectElement).value as AdminUser['role'] })"
                >
                  <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
                </select>
              </td>
              <td>
                <button
                  class="adm-toggle"
                  :class="u.isActive ? 'adm-toggle--on' : 'adm-toggle--off'"
                  @click="patchUser(u.id, { isActive: !u.isActive })"
                >{{ u.isActive ? 'Да' : 'Нет' }}</button>
              </td>
              <td class="adm-date">{{ fmtDate(u.createdAt) }}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ── Audit ── -->
      <div v-if="tab === 'audit'" class="calc-area">
        <div v-if="auditLoading" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <div v-else-if="auditError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ auditError }}</div>
        </div>
        <table v-else class="adm-table">
          <thead>
            <tr><th>Действие</th><th>Объект</th><th>Пользователь</th><th>Дата</th></tr>
          </thead>
          <tbody>
            <tr v-for="e in auditLog" :key="e.id">
              <td><span class="adm-action">{{ e.action }}</span></td>
              <td class="adm-entity">{{ e.entityType ? `${e.entityType}:${e.entityId}` : '—' }}</td>
              <td>{{ e.user ? e.user.name : '—' }}</td>
              <td class="adm-date">{{ fmtDateTime(e.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!auditLoading && auditLog.length === 0" class="dash-state" style="height:auto;padding:40px 0">
          <div class="dash-state-txt">Записей нет</div>
        </div>
      </div>
    </div>

    <!-- Новый пользователь -->
    <BaseModal :show="newUserOpen" title="Новый пользователь" @close="closeNewUser">
      <div class="ff">
        <label class="fl">Имя <span style="color:var(--danger)">*</span></label>
        <input class="fi" v-model="newForm.name" placeholder="Иван Иванов" />
      </div>
      <div class="ff">
        <label class="fl">Email <span style="color:var(--danger)">*</span></label>
        <input class="fi" type="email" v-model="newForm.email" placeholder="user@example.com" />
      </div>
      <div class="ff">
        <label class="fl">Роль</label>
        <select class="fi" v-model="newForm.role">
          <option v-for="r in ROLES" :key="r" :value="r">{{ ROLE_LABELS[r] }}</option>
        </select>
      </div>
      <div class="ff">
        <label class="fl">Пароль <span style="color:var(--danger)">*</span></label>
        <input class="fi" type="password" v-model="newForm.password" placeholder="Минимум 6 символов" />
      </div>
      <div v-if="newFormError" class="auth-err" style="margin-top:8px">{{ newFormError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="closeNewUser">Отмена</button>
        <button class="btn btn-am" :disabled="creating" @click="createUser">
          {{ creating ? 'Создание…' : 'Создать' }}
        </button>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { adminApi, type AdminUser, type AuditEntry } from '@/api/admin'
import BaseModal   from '@/components/ui/BaseModal.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'

const router = useRouter()
const tab = ref<'users' | 'audit'>('users')

// ── Users ────────────────────────────────────────────────────────────────────
const users        = ref<AdminUser[]>([])
const usersLoading = ref(false)
const usersError   = ref('')

const ROLES = ['ADMIN', 'MANAGER', 'ENGINEER', 'TECHNOLOG', 'BUYER', 'VIEWER'] as const
const ROLE_LABELS: Record<AdminUser['role'], string> = {
  ADMIN: 'Администратор', MANAGER: 'Менеджер', ENGINEER: 'Инженер',
  TECHNOLOG: 'Технолог', BUYER: 'Снабженец', VIEWER: 'Наблюдатель',
}

async function loadUsers() {
  usersLoading.value = true; usersError.value = ''
  try { users.value = await adminApi.listUsers() }
  catch (e: unknown) { usersError.value = e instanceof Error ? e.message : 'Ошибка загрузки' }
  finally { usersLoading.value = false }
}

async function patchUser(id: string, dto: Parameters<typeof adminApi.patchUser>[1]) {
  try {
    const updated = await adminApi.patchUser(id, dto)
    const idx = users.value.findIndex(u => u.id === id)
    if (idx !== -1) users.value[idx] = updated
  } catch { /* silent — user sees no feedback, but role/active didn't change */ }
}

// ── New user form ─────────────────────────────────────────────────────────────
const newUserOpen  = ref(false)
const creating     = ref(false)
const newFormError = ref('')
const newForm = reactive({ name: '', email: '', role: 'ENGINEER' as AdminUser['role'], password: '' })

function closeNewUser() {
  newUserOpen.value = false
  newForm.name = ''; newForm.email = ''; newForm.password = ''; newForm.role = 'ENGINEER'
  newFormError.value = ''
}

async function createUser() {
  if (!newForm.name.trim())     { newFormError.value = 'Укажите имя';  return }
  if (!newForm.email.trim())    { newFormError.value = 'Укажите email'; return }
  if (newForm.password.length < 6) { newFormError.value = 'Пароль минимум 6 символов'; return }
  creating.value = true; newFormError.value = ''
  try {
    const user = await adminApi.createUser({
      name:     newForm.name.trim(),
      email:    newForm.email.trim(),
      role:     newForm.role,
      password: newForm.password,
    })
    users.value.unshift(user)
    closeNewUser()
  } catch (e: unknown) {
    newFormError.value = e instanceof Error ? e.message : 'Ошибка создания'
  } finally {
    creating.value = false
  }
}

// ── Audit ─────────────────────────────────────────────────────────────────────
const auditLog     = ref<AuditEntry[]>([])
const auditLoading = ref(false)
const auditError   = ref('')
let auditLoaded = false

async function loadAudit() {
  if (auditLoaded) return
  auditLoading.value = true; auditError.value = ''
  try { auditLog.value = await adminApi.listAudit(); auditLoaded = true }
  catch (e: unknown) { auditError.value = e instanceof Error ? e.message : 'Ошибка загрузки' }
  finally { auditLoading.value = false }
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(loadUsers)
</script>

<style scoped>
.adm-table { width: 100%; border-collapse: collapse; font-size: 11px; }
.adm-table th {
  text-align: left; padding: 5px 12px; font-size: 9px; font-weight: 600;
  color: var(--tx3); background: var(--bg1); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1;
}
.adm-table td { padding: 6px 12px; border-bottom: 1px solid var(--border); color: var(--tx2); vertical-align: middle; }
.adm-table tr:hover td { background: var(--bg3); }

.adm-email  { font-family: Archivo, system-ui, sans-serif; font-size: 10px; color: var(--tx3); }
.adm-date   { font-size: 9px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; white-space: nowrap; }
.adm-entity { font-family: Archivo, system-ui, sans-serif; font-size: 9px; color: var(--tx3); }
.adm-action { font-family: Archivo, system-ui, sans-serif; font-size: 10px; color: var(--accent); }

.adm-role-sel { padding: 2px 5px; height: 24px; font-size: 10px; width: 140px; }

.adm-toggle {
  font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: none; cursor: pointer; transition: all .15s;
}
.adm-toggle--on  { background: color-mix(in srgb, #10b981 20%, transparent); color: #10b981; }
.adm-toggle--off { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }

.nav-section { font-size: 9px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }
.nav-link    { display: block; width: 100%; text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 11px; color: var(--tx2); cursor: pointer; background: transparent; border: none; transition: background .12s, color .12s; }
.nav-link:hover    { background: var(--bg3); color: var(--tx1); }
.nav-link--active  { background: var(--bg3); color: var(--accent); font-weight: 600; }

.dash-state    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 12px; color: var(--tx3); }
.dash-err      { color: var(--danger); }
</style>
