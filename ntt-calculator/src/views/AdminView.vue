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
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'db' }"     @click="tab = 'db'; loadBackups()">База данных</button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">{{ tabTitle }}</div>
        <div class="tb-spacer"></div>
        <button v-if="tab === 'users'" class="btn" @click="newUserOpen = true">＋ Новый пользователь</button>
        <template v-if="tab === 'db'">
          <label class="btn" :class="{ 'is-busy': dbBusy }">
            ↑ Загрузить дамп
            <input type="file" accept=".dump" hidden :disabled="dbBusy" @change="onUpload" />
          </label>
          <button class="btn btn-acc" :disabled="dbBusy" @click="onCreateBackup">
            {{ dbBusy ? 'Работаем…' : '＋ Снять дамп' }}
          </button>
        </template>
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
              <td>
                {{ u.name }}
                <span v-if="u.mustChangePassword" v-hint="ADMIN_PASSWORD_HINTS.mustChange" class="adm-badge">сменит пароль при входе</span>
              </td>
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
              <td>
                <!-- Свой пароль — «Сменить пароль» в меню: сброс обошёл бы проверку текущего. -->
                <button
                  v-if="u.id !== auth.user?.id"
                  v-hint="ADMIN_PASSWORD_HINTS.reset"
                  class="btn btn-g adm-reset"
                  @click="resetTarget = u"
                >Сбросить пароль</button>
              </td>
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

      <!-- ── База данных ── -->
      <div v-if="tab === 'db'" class="calc-area">
        <p class="db-note">
          Дамп снимается автоматически перед применением миграций — у них нет обратного
          хода, и восстановление из дампа единственный путь назад. Здесь тот же каталог:
          файлы видны и скриптам на сервере.
        </p>
        <p v-if="dbError" class="db-err">{{ dbError }}</p>
        <p v-if="dbNote" class="db-ok">{{ dbNote }}</p>

        <div v-if="dbLoading" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <table v-else-if="backups.length" class="adm-table">
          <thead>
            <tr><th>Файл</th><th>Метка</th><th class="num">Размер</th><th>Снят</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="b in backups" :key="b.name">
              <td class="adm-entity">{{ b.name }}</td>
              <td><span class="adm-action">{{ b.label }}</span></td>
              <td class="num">{{ fmtSize(b.sizeBytes) }}</td>
              <td class="adm-date">{{ fmtDateTime(b.createdAt) }}</td>
              <td class="db-acts">
                <button class="btn btn-xs" :disabled="dbBusy" @click="onDownload(b)">скачать</button>
                <button class="btn btn-xs" :disabled="dbBusy" @click="askRestore(b)">восстановить</button>
                <button class="btn btn-xs" :disabled="dbBusy" @click="onDelete(b)">удалить</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="dash-state" style="height:auto;padding:40px 0">
          <div class="dash-state-txt">Дампов пока нет</div>
        </div>
      </div>
    </div>

    <!-- Подтверждение восстановления -->
    <BaseModal :show="restoreTarget !== null" title="Восстановление базы" @close="restoreTarget = null">
      <p class="db-warn">
        Содержимое базы будет заменено содержимым дампа. Всё, что появилось после
        {{ restoreTarget ? fmtDateTime(restoreTarget.createdAt) : '' }}, пропадёт: проекты,
        расчёты, выпущенные КП, изменения прайса.
      </p>
      <p class="db-note">
        Перед заменой сервер сам снимет дамп текущего состояния — вернуться будет куда.
        Аудит-лог хранится в этой же базе, поэтому он тоже вернётся к состоянию на момент
        дампа: записи о действиях после него исчезнут. Запись о самом восстановлении
        останется — она пишется после.
      </p>
      <div class="ff">
        <label class="fl">Для подтверждения введите имя файла</label>
        <input class="fi" v-model="restoreConfirm" :placeholder="restoreTarget?.name" />
      </div>
      <template #footer>
        <button class="btn" @click="restoreTarget = null">Отмена</button>
        <button
          class="btn btn-acc"
          :disabled="dbBusy || restoreConfirm.trim() !== restoreTarget?.name"
          @click="onRestore"
        >{{ dbBusy ? 'Восстанавливаем…' : 'Заменить базу' }}</button>
      </template>
    </BaseModal>

    <!-- Сброс пароля: подтверждение (План_устранения 2.1) -->
    <BaseModal :show="!!resetTarget && !resetPassword" title="Сбросить пароль" @close="closeReset">
      <p class="adm-p">
        Сбросить пароль пользователю «{{ resetTarget?.name }}» ({{ resetTarget?.email }})? Текущий пароль перестанет
        действовать, а система выдаст временный — он покажется один раз.
      </p>
      <div v-if="resetError" class="auth-err">{{ resetError }}</div>
      <template #footer>
        <button class="btn btn-g" @click="closeReset">Отмена</button>
        <button class="btn btn-am" :disabled="resetting" @click="doReset">{{ resetting ? 'Сбрасываем…' : 'Сбросить' }}</button>
      </template>
    </BaseModal>

    <!-- Сброс пароля: временный пароль — один раз -->
    <BaseModal :show="!!resetPassword" title="Временный пароль" @close="closeReset">
      <p class="adm-p">Временный пароль для «{{ resetTarget?.name }}»:</p>
      <div class="adm-temp">
        <code class="adm-temp-pw">{{ resetPassword }}</code>
        <button class="btn btn-g" @click="copyReset">{{ copied ? 'Скопировано' : 'Скопировать' }}</button>
      </div>
      <p class="adm-p adm-muted">
        Передайте его пользователю: при входе он задаст свой пароль. Больше этот пароль нигде не показывается — в
        журнал аудита он не пишется.
      </p>
      <template #footer>
        <button class="btn btn-am" @click="closeReset">Готово</button>
      </template>
    </BaseModal>

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
        <input class="fi" type="password" v-model="newForm.password" :placeholder="`Минимум ${MIN_PASSWORD_LENGTH} символов`" />
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
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { adminApi, type AdminUser, type AuditEntry, type DumpInfo } from '@/api/admin'
import BaseModal   from '@/components/ui/BaseModal.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import { ADMIN_PASSWORD_HINTS } from '@/hints/account'
import { useAuthStore } from '@/stores/auth'
import { MIN_PASSWORD_LENGTH } from '@/utils/password-form'

const router = useRouter()
const auth = useAuthStore()
const tab = ref<'users' | 'audit' | 'db'>('users')
const tabTitle = computed(
  () => ({ users: 'Пользователи', audit: 'Аудит-лог', db: 'База данных' })[tab.value],
)

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

// ── Сброс пароля (План_устранения 2.1) ──────────────────────────────────────
const resetTarget   = ref<AdminUser | null>(null)
/** Временный пароль из ответа сервера — живёт, пока открыто окно. */
const resetPassword = ref('')
const resetting     = ref(false)
const resetError    = ref('')
const copied        = ref(false)

/** Закрыть и забыть временный пароль: в памяти экрана он не задерживается. */
function closeReset() {
  resetTarget.value = null
  resetPassword.value = ''
  resetError.value = ''
  copied.value = false
}

async function doReset() {
  const target = resetTarget.value
  if (!target || resetting.value) return
  resetting.value = true
  resetError.value = ''
  try {
    resetPassword.value = (await adminApi.resetPassword(target.id)).temporaryPassword
    const idx = users.value.findIndex((u) => u.id === target.id)
    if (idx !== -1) users.value[idx] = { ...users.value[idx]!, mustChangePassword: true }
  } catch (e: unknown) {
    const r = (e as { response?: { data?: { message?: string } } }).response
    resetError.value = r?.data?.message ?? 'Не удалось сбросить пароль'
  } finally {
    resetting.value = false
  }
}

async function copyReset() {
  try {
    await navigator.clipboard.writeText(resetPassword.value)
    copied.value = true
  } catch {
    // Буфер обмена недоступен (не https) — пароль выделен, его можно скопировать вручную.
    const el = document.querySelector('.adm-temp-pw')
    if (el) window.getSelection()?.selectAllChildren(el)
  }
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
  if (newForm.password.length < MIN_PASSWORD_LENGTH) { newFormError.value = `Пароль — минимум ${MIN_PASSWORD_LENGTH} символов`; return }
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
    // Текст сервера — «пользователь с таким email уже есть» и подобные.
    const r = (e as { response?: { data?: { message?: string } } }).response
    newFormError.value = r?.data?.message ?? (e instanceof Error ? e.message : 'Ошибка создания')
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

// ── База данных: дампы ───────────────────────────────────────────────────────

const backups = ref<DumpInfo[]>([])
const dbLoading = ref(false)
const dbBusy = ref(false)
const dbError = ref('')
const dbNote = ref('')
const restoreTarget = ref<DumpInfo | null>(null)
const restoreConfirm = ref('')

const fmtSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

/** Текст ошибки от сервера важнее общей формулировки: он объясняет отказ. */
const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
  (e instanceof Error ? e.message : fallback)

async function loadBackups() {
  dbLoading.value = true; dbError.value = ''
  try { backups.value = await adminApi.listBackups() }
  catch (e) { dbError.value = errText(e, 'Не удалось получить список дампов') }
  finally { dbLoading.value = false }
}

async function onCreateBackup() {
  dbBusy.value = true; dbError.value = ''; dbNote.value = ''
  try {
    const info = await adminApi.createBackup()
    dbNote.value = `Снят дамп ${info.name} (${fmtSize(info.sizeBytes)})`
    await loadBackups()
  } catch (e) { dbError.value = errText(e, 'Не удалось снять дамп') }
  finally { dbBusy.value = false }
}

async function onDownload(b: DumpInfo) {
  dbBusy.value = true; dbError.value = ''
  try {
    const blob = await adminApi.downloadBackup(b.name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = b.name; a.click()
    URL.revokeObjectURL(url)
  } catch (e) { dbError.value = errText(e, 'Не удалось скачать дамп') }
  finally { dbBusy.value = false }
}

async function onDelete(b: DumpInfo) {
  dbBusy.value = true; dbError.value = ''; dbNote.value = ''
  try {
    await adminApi.deleteBackup(b.name)
    dbNote.value = `Удалён ${b.name}`
    await loadBackups()
  } catch (e) { dbError.value = errText(e, 'Не удалось удалить дамп') }
  finally { dbBusy.value = false }
}

/**
 * Загрузка кладёт файл в каталог, но НЕ применяет его: подмена базы должна
 * быть отдельным осознанным действием, а не побочным эффектом выбора файла.
 * Сервер перед сохранением проверяет содержимое архива.
 */
async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  input.value = '' // чтобы повторный выбор того же файла снова сработал

  dbBusy.value = true; dbError.value = ''; dbNote.value = ''
  try {
    const info = await adminApi.uploadBackup(file)
    dbNote.value = `Загружен ${info.name}. Чтобы применить, нажмите «восстановить».`
    await loadBackups()
  } catch (err) { dbError.value = errText(err, 'Не удалось загрузить дамп') }
  finally { dbBusy.value = false }
}

function askRestore(b: DumpInfo) {
  restoreTarget.value = b
  restoreConfirm.value = ''
  dbError.value = ''; dbNote.value = ''
}

async function onRestore() {
  const target = restoreTarget.value
  if (!target) return

  dbBusy.value = true; dbError.value = ''
  try {
    const r = await adminApi.restoreBackup(target.name)
    restoreTarget.value = null
    dbNote.value =
      `База восстановлена из ${r.restored}. Состояние до замены сохранено в ${r.safetyDump}.` +
      (r.restarting
        ? ` Дамп старше программы: сервер перезапускается и применит миграции (${(r.missingMigrations ?? []).join(', ')}) — обновите страницу через минуту.`
        : '')
    await loadBackups()
  } catch (e) { dbError.value = errText(e, 'Не удалось восстановить базу') }
  finally { dbBusy.value = false }
}

onMounted(loadUsers)
</script>

<style scoped>
.adm-table { width: 100%; border-collapse: collapse; font-size: 13.2px; }
.adm-table th {
  text-align: left; padding: 5px 12px; font-size: 10.8px; font-weight: 600;
  color: var(--tx3); background: var(--bg1); border-bottom: 1px solid var(--border);
  position: sticky; top: 0; z-index: 1;
}
.adm-table td { padding: 6px 12px; border-bottom: 1px solid var(--border); color: var(--tx2); vertical-align: middle; }
.adm-table tr:hover td { background: var(--bg3); }

.adm-email  { font-family: Archivo, system-ui, sans-serif; font-size: 12px; color: var(--tx3); }
.adm-date   { font-size: 10.8px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; white-space: nowrap; }
.adm-entity { font-family: Archivo, system-ui, sans-serif; font-size: 10.8px; color: var(--tx3); }
.adm-action { font-family: Archivo, system-ui, sans-serif; font-size: 12px; color: var(--accent); }

.adm-role-sel { padding: 2px 5px; height: 24px; font-size: 12px; width: 140px; }

/* Пароль задан не самим пользователем — сменит при входе (2.1) */
.adm-badge { margin-left: 6px; font-size: 10.8px; padding: 1px 6px; border-radius: 10px; white-space: nowrap;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
.adm-reset { padding: 2px 8px; height: 24px; font-size: 12px; white-space: nowrap; }
.adm-p { margin: 0 0 10px; font-size: 13.2px; line-height: 1.5; color: var(--tx2); }
.adm-muted { color: var(--tx3); }
.adm-temp { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.adm-temp-pw { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 18px; letter-spacing: .06em;
  padding: 6px 10px; border: 1px solid var(--border); background: var(--bg3); color: var(--tx1); user-select: all; }

.adm-toggle {
  font-size: 10.8px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: none; cursor: pointer; transition: all .15s;
}
.adm-toggle--on  { background: color-mix(in srgb, #10b981 20%, transparent); color: #10b981; }
.adm-toggle--off { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }

.nav-section { font-size: 10.8px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--tx3); padding: 10px 8px 4px; }
.nav-link    { display: block; width: 100%; text-align: left; padding: 5px 8px; border-radius: 4px; font-size: 13.2px; color: var(--tx2); cursor: pointer; background: transparent; border: none; transition: background .12s, color .12s; }
.nav-link:hover    { background: var(--bg3); color: var(--tx1); }
.nav-link--active  { background: var(--bg3); color: var(--accent); font-weight: 600; }

.dash-state    { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; opacity: .6; }
.dash-state-txt { font-size: 14.4px; color: var(--tx3); }
.dash-err      { color: var(--danger); }

/* Вкладка «База данных» */
.db-note { font-size: 13.2px; color: var(--tx3); line-height: 1.5; margin: 0 0 10px; max-width: 78ch; }
.db-err  { font-size: 13.8px; color: var(--danger); margin: 0 0 10px; white-space: pre-line; }
.db-ok   { font-size: 13.8px; color: var(--tx2); margin: 0 0 10px; }
.db-warn { font-size: 14.4px; color: var(--danger); line-height: 1.5; margin: 0 0 8px; }
.adm-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.db-acts { white-space: nowrap; text-align: right; }
.db-acts .btn-xs { padding: 2px 7px; font-size: 12.6px; line-height: 1.5; }
.db-acts .btn-xs + .btn-xs { margin-left: 4px; }
.btn.is-busy { opacity: .5; pointer-events: none; }
</style>
