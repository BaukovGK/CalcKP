<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo">Администрирование</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Разделы</div>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'users' }"  @click="tab = 'users'">Пользователи</button>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'audit' }"  @click="tab = 'audit'; loadAudit()">Журнал действий</button>
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
              <th v-hint="ACCOUNT_HINTS.name">ФИО</th>
              <th v-hint="ACCOUNT_HINTS.position">Должность</th>
              <th v-hint="ACCOUNT_HINTS.phone">Телефон</th>
              <th>Email</th><th>Роль</th><th>Активен</th><th>Зарегистрирован</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id">
              <td>
                <input
                  class="fi adm-inline"
                  :value="u.name"
                  placeholder="Иванов Сергей Владимирович"
                  @change="patchName(u, $event)"
                />
                <span v-if="u.mustChangePassword" v-hint="ADMIN_PASSWORD_HINTS.mustChange" class="adm-badge">сменит пароль при входе</span>
              </td>
              <td>
                <input
                  class="fi adm-inline"
                  :value="u.position ?? ''"
                  placeholder="Ведущий инженер"
                  @change="patchUser(u.id, { position: ($event.target as HTMLInputElement).value.trim() })"
                />
              </td>
              <td>
                <input
                  class="fi adm-inline"
                  :value="u.phone ?? ''"
                  placeholder="+7 (499) 000-00-00 доб. 000"
                  @change="patchUser(u.id, { phone: ($event.target as HTMLInputElement).value.trim() })"
                />
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

      <!-- ── Журнал действий ──
           Кто, что и когда сделал. Таблица кодов («estimate.kp.export») читалась
           только автором кода, поэтому здесь: понятные названия, отбор по
           сотруднику, разделу и периоду, подробности события по щелчку. -->
      <div v-if="tab === 'audit'" class="calc-area">
        <div class="aud-filters">
          <input
            v-model="auditFilter.q"
            v-hint="AUDIT_HINTS.search"
            class="fi aud-search"
            placeholder="Поиск по сотруднику, действию, объекту…"
            @keyup.enter="reloadAudit"
          />
          <select v-model="auditFilter.user" v-hint="AUDIT_HINTS.user" class="fi" @change="reloadAudit">
            <option value="">Все сотрудники</option>
            <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
          </select>
          <select v-model="auditFilter.action" v-hint="AUDIT_HINTS.action" class="fi" @change="reloadAudit">
            <option value="">Все разделы</option>
            <optgroup label="Раздел целиком">
              <option v-for="g in auditGroupsPresent" :key="g.key" :value="g.key">{{ g.label }}</option>
            </optgroup>
            <optgroup label="Отдельное действие">
              <option v-for="a in auditActions" :key="a.action" :value="a.action">
                {{ auditLabel(a.action) }} ({{ a.count }})
              </option>
            </optgroup>
          </select>
          <label class="aud-period" v-hint="AUDIT_HINTS.period">
            с <input v-model="auditFilter.from" class="fi" type="date" @change="reloadAudit" />
            по <input v-model="auditFilter.to" class="fi" type="date" @change="reloadAudit" />
          </label>
          <button class="btn btn-g" @click="resetAuditFilter">Сбросить</button>
          <span class="aud-total">{{ auditTotalLabel }}</span>
        </div>

        <!-- Что отобрано сейчас. Отбор по объекту задаётся щелчком в таблице —
             поля для него нет: идентификатор объекта руками не набирают. -->
        <div v-if="auditChips.length" class="aud-chosen">
          <span class="aud-chosen-lbl">Отобрано:</span>
          <button
            v-for="c in auditChips" :key="c.key"
            v-hint.plain="'Снять это условие'"
            class="aud-chosen-chip"
            @click="dropAuditFilter(c.key)"
          >{{ c.label }} ✕</button>
        </div>

        <div v-if="auditLoading && !auditLog.length" class="dash-state"><div class="dash-state-txt">Загрузка…</div></div>
        <div v-else-if="auditError" class="dash-state">
          <div class="dash-state-txt dash-err">{{ auditError }}</div>
          <button class="btn btn-g" @click="reloadAudit">Повторить</button>
        </div>
        <div v-else-if="!auditLog.length" class="dash-state" style="height:auto;padding:40px 0">
          <div class="dash-state-txt">По этому отбору записей нет</div>
        </div>
        <template v-else>
          <table class="adm-table aud-table">
            <thead>
              <tr><th>Когда</th><th>Сотрудник</th><th>Раздел</th><th>Действие</th><th>Подробности</th></tr>
            </thead>
            <tbody>
              <tr v-for="e in auditLog" :key="e.id" :class="{ 'aud-row--alarm': isAlarming(e.action) }">
                <td class="adm-date">{{ fmtDateTime(e.createdAt) }}</td>
                <td>
                  <button
                    v-if="e.user"
                    v-hint="AUDIT_HINTS.byUser"
                    class="aud-link"
                    @click="filterBy('user', e.user.id)"
                  >{{ e.user.name }}</button>
                  <template v-else>—</template>
                  <span v-if="e.user?.position" class="aud-pos">{{ e.user.position }}</span>
                </td>
                <td class="aud-group">{{ auditGroupLabel(e.action) }}</td>
                <td>
                  <span class="adm-action">{{ auditLabel(e.action) }}</span>
                  <button
                    v-if="e.entityId && entityLabel(e.entityType)"
                    v-hint="AUDIT_HINTS.byEntity"
                    class="aud-link aud-entity"
                    @click="filterBy('entity', e.entityId)"
                  >{{ entityLabel(e.entityType) }} {{ shortId(e.entityId) }}</button>
                  <button
                    v-hint="AUDIT_HINTS.byAction"
                    class="aud-link aud-only"
                    @click="filterBy('action', e.action)"
                  >только такие</button>
                </td>
                <td class="aud-meta">
                  <span v-for="d in auditDetails(e.meta)" :key="d.label" class="aud-chip">
                    {{ d.label }}: {{ d.value }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="auditLog.length < auditTotal" class="aud-more">
            <button class="btn btn-g" :disabled="auditLoading" @click="loadMoreAudit">
              {{ auditLoading ? 'Загрузка…' : `Показать ещё (осталось ${auditTotal - auditLog.length})` }}
            </button>
          </div>
        </template>
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
        Журнал действий хранится в этой же базе, поэтому он тоже вернётся к состоянию на момент
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
        <label v-hint="ACCOUNT_HINTS.name" class="fl">ФИО <span style="color:var(--danger)">*</span></label>
        <input class="fi" v-model="newForm.name" placeholder="Иванов Сергей Владимирович" />
      </div>
      <div class="ff">
        <label v-hint="ACCOUNT_HINTS.position" class="fl">Должность</label>
        <input class="fi" v-model="newForm.position" placeholder="Ведущий инженер" />
      </div>
      <div class="ff">
        <label v-hint="ACCOUNT_HINTS.phone" class="fl">Телефон</label>
        <input class="fi" v-model="newForm.phone" placeholder="+7 (499) 000-00-00 доб. 000" />
      </div>
      <div class="ff">
        <label class="fl">Email <span style="color:var(--danger)">*</span></label>
        <!-- Логин латиницей: иначе учётную запись заведут так, что в неё
             никто не войдёт (utils/latin-input.ts). -->
        <input
          class="fi"
          type="email"
          v-model="newForm.email"
          placeholder="user@example.com"
          data-latin
          @latin-blocked="onLatinBlocked"
        />
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
import { adminApi, type AdminUser, type AuditActionCount, type AuditEntry, type DumpInfo } from '@/api/admin'
import {
  AUDIT_GROUPS,
  auditDetails,
  auditGroupKey,
  auditGroupLabel,
  auditLabel,
  entityLabel,
  isAlarming,
} from '@/utils/audit-labels'
import { AUDIT_HINTS } from '@/hints/account'
import BaseModal   from '@/components/ui/BaseModal.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import UserMenu from '@/components/ui/UserMenu.vue'
import { ADMIN_PASSWORD_HINTS } from '@/hints/account'
import { useAuthStore } from '@/stores/auth'
import { hasNonLatin, LATIN_ONLY_HINT } from '@/utils/latin-input'
import { MIN_PASSWORD_LENGTH } from '@/utils/password-form'

const router = useRouter()
const auth = useAuthStore()
const tab = ref<'users' | 'audit' | 'db'>('users')
const tabTitle = computed(
  () => ({ users: 'Пользователи', audit: 'Журнал действий', db: 'База данных' })[tab.value],
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
const newForm = reactive({
  name: '',
  position: '',
  phone: '',
  email: '',
  role: 'ENGINEER' as AdminUser['role'],
  password: '',
})

/**
 * Сноски полей учётной записи.
 *
 * ФИО и должность — не украшение карточки: их печатает блок исполнителя в КП
 * (`backend/utils/kp-terms.ts`), а инициалы выводятся из ФИО автоматически.
 */
const ACCOUNT_HINTS = {
  name: 'Фамилия, имя и отчество полностью — в этом порядке. В КП из них получается «Иванов С.В.», поэтому «Иван Иванов» даст неверные инициалы',
  position: 'Должность сотрудника: печатается в блоке исполнителя КП под его фамилией. Пусто — строки должности в документе не будет',
  phone: 'Рабочий телефон с добавочным — по нему заказчик звонит исполнителю КП. Пусто — печатается общий телефон отдела',
} as const

/** ФИО пустым не бывает: сервер такую правку отклонит, а строка таблицы осиротеет. */
function patchName(u: AdminUser, e: Event) {
  const name = (e.target as HTMLInputElement).value.trim()
  if (!name) { (e.target as HTMLInputElement).value = u.name; return }
  if (name !== u.name) void patchUser(u.id, { name })
}

function closeNewUser() {
  newUserOpen.value = false
  newForm.name = ''; newForm.email = ''; newForm.password = ''; newForm.role = 'ENGINEER'
  newForm.position = ''; newForm.phone = ''
  newFormError.value = ''
}

function onLatinBlocked(e: Event) {
  if ((e as CustomEvent<{ blocked: boolean }>).detail.blocked) newFormError.value = LATIN_ONLY_HINT
  else if (newFormError.value === LATIN_ONLY_HINT) newFormError.value = ''
}

async function createUser() {
  if (!newForm.name.trim())     { newFormError.value = 'Укажите имя';  return }
  if (!newForm.email.trim())    { newFormError.value = 'Укажите email'; return }
  // Логин латиницей: сервер держит то же правило (admin.routes.ts).
  if (hasNonLatin(newForm.email.trim())) { newFormError.value = LATIN_ONLY_HINT; return }
  if (newForm.password.length < MIN_PASSWORD_LENGTH) { newFormError.value = `Пароль — минимум ${MIN_PASSWORD_LENGTH} символов`; return }
  creating.value = true; newFormError.value = ''
  try {
    const user = await adminApi.createUser({
      name:     newForm.name.trim(),
      position: newForm.position.trim() || null,
      phone:    newForm.phone.trim() || null,
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
const auditTotal   = ref(0)
const auditActions = ref<AuditActionCount[]>([])
let auditLoaded = false

/**
 * Отбор: пустые поля в запрос не уходят.
 *
 * `entity` полем не показывается: идентификатор расчёта руками не набирают —
 * он ставится щелчком по объекту в строке журнала. Так строится цепочка «всё,
 * что происходило с этим расчётом», а из неё — «всё, что делал этот
 * сотрудник».
 */
const auditFilter = reactive({ q: '', user: '', action: '', entity: '', from: '', to: '' })

/** Короткий вид идентификатора: в журнале он uuid, читать его целиком незачем. */
const shortId = (id: string) => id.slice(0, 8)

/** Сколько записей просим за раз — «Показать ещё» добавляет столько же. */
const AUDIT_PAGE = 50

/**
 * Разделы, которые в журнале действительно есть.
 *
 * Предлагать в отборе «Шаблоны», когда технолог ещё ничего не правил, —
 * обещать пустой список.
 */
const auditGroupsPresent = computed(() =>
  AUDIT_GROUPS.filter((g) => auditActions.value.some((a) => auditGroupKey(a.action) === g.key)),
)

const auditTotalLabel = computed(() =>
  auditTotal.value === 0 ? '' : `показано ${auditLog.value.length} из ${auditTotal.value}`,
)

/**
 * Границы периода — полными моментами по часам пользователя.
 *
 * Поле даты даёт «2026-09-17», а сервер живёт по UTC: без явного момента у
 * московского пользователя день начинался бы в три часа ночи.
 */
function dayStart(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
function dayEnd(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(`${value}T23:59:59.999`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

async function fetchAudit(offset: number) {
  auditLoading.value = true
  auditError.value = ''
  try {
    const page = await adminApi.listAudit({
      q: auditFilter.q.trim() || undefined,
      user: auditFilter.user || undefined,
      action: auditFilter.action || undefined,
      entity: auditFilter.entity || undefined,
      from: dayStart(auditFilter.from),
      to: dayEnd(auditFilter.to),
      limit: AUDIT_PAGE,
      offset,
    })
    auditLog.value = offset === 0 ? page.items : [...auditLog.value, ...page.items]
    auditTotal.value = page.total
    auditLoaded = true
  } catch (e: unknown) {
    const r = (e as { response?: { data?: { message?: string } } }).response
    auditError.value = r?.data?.message ?? (e instanceof Error ? e.message : 'Ошибка загрузки')
  } finally {
    auditLoading.value = false
  }
}

/** Первый заход на вкладку: список событий для отбора — заодно. */
async function loadAudit() {
  if (auditLoaded) return
  void adminApi.auditActions().then((list) => { auditActions.value = list }).catch(() => {})
  await fetchAudit(0)
}

const reloadAudit = () => fetchAudit(0)
const loadMoreAudit = () => fetchAudit(auditLog.value.length)

function resetAuditFilter() {
  auditFilter.q = ''; auditFilter.user = ''; auditFilter.action = ''; auditFilter.entity = ''
  auditFilter.from = ''; auditFilter.to = ''
  void reloadAudit()
}

/** Отобрать по значению из строки журнала: сотрудник, объект, действие. */
function filterBy(key: 'user' | 'entity' | 'action', value: string) {
  auditFilter[key] = value
  void reloadAudit()
}

/** Снять одно условие, не трогая остальные. */
function dropAuditFilter(key: keyof typeof auditFilter) {
  auditFilter[key] = ''
  void reloadAudit()
}

/** Что отобрано сейчас — подписями, которые можно снять по одной. */
const auditChips = computed(() => {
  const chips: Array<{ key: keyof typeof auditFilter; label: string }> = []
  if (auditFilter.user) {
    const u = users.value.find((x) => x.id === auditFilter.user)
    chips.push({ key: 'user', label: `Сотрудник: ${u?.name ?? shortId(auditFilter.user)}` })
  }
  if (auditFilter.action) {
    const isGroup = !auditFilter.action.includes('.')
    chips.push({
      key: 'action',
      label: isGroup
        ? `Раздел: ${AUDIT_GROUPS.find((g) => g.key === auditFilter.action)?.label ?? auditFilter.action}`
        : `Действие: ${auditLabel(auditFilter.action)}`,
    })
  }
  if (auditFilter.entity) chips.push({ key: 'entity', label: `Объект: ${shortId(auditFilter.entity)}` })
  if (auditFilter.q) chips.push({ key: 'q', label: `Поиск: ${auditFilter.q}` })
  if (auditFilter.from) chips.push({ key: 'from', label: `С ${auditFilter.from}` })
  if (auditFilter.to) chips.push({ key: 'to', label: `По ${auditFilter.to}` })
  return chips
})

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

.adm-email  { font-family: Archivo, system-ui, sans-serif; font-size: 12.5px; color: var(--tx3); }

/* Журнал действий */
.aud-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px;
  border-bottom: 1px solid var(--bd); }
.aud-search  { flex: 1; min-width: 220px; }
.aud-period  { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--tx3); }
.aud-period input { width: 140px; }
.aud-total   { margin-left: auto; font-size: 12.5px; color: var(--tx3); white-space: nowrap; }
.aud-table td { vertical-align: top; }
.aud-row--alarm td:first-child { box-shadow: inset 2px 0 0 var(--danger); }
.aud-pos     { display: block; font-size: 12px; color: var(--tx3); }
.aud-group   { font-size: 12.5px; color: var(--tx3); white-space: nowrap; }
.aud-entity  { margin-left: 6px; font-size: 12px; color: var(--tx3); border-bottom: 1px dotted var(--bd2); }
.aud-meta    { display: flex; flex-wrap: wrap; gap: 4px; }
.aud-chip    { font-size: 12px; color: var(--tx2); background: var(--bg3); border: 1px solid var(--bd);
  border-radius: 3px; padding: 1px 5px; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }
.aud-more    { display: flex; justify-content: center; padding: 12px; }
.aud-chosen  { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 7px 12px;
  border-bottom: 1px solid var(--bd); background: var(--bg2); }
.aud-chosen-lbl  { font-size: 12px; color: var(--tx3); }
.aud-chosen-chip { font: inherit; font-size: 12px; color: var(--am); background: transparent;
  border: 1px solid var(--am); border-radius: 3px; padding: 1px 6px; cursor: pointer; }
.aud-chosen-chip:hover { background: var(--bg3); }
.aud-link    { font: inherit; font-size: inherit; color: var(--tx1); background: transparent; border: none;
  padding: 0; cursor: pointer; text-align: left; border-bottom: 1px dotted var(--bd2); }
.aud-link:hover { color: var(--am); border-bottom-color: var(--am); }
.aud-only    { margin-left: 6px; font-size: 12px; color: var(--tx3); }
/* ФИО, должность и телефон правятся прямо в таблице: заводятся они редко, а
   дополнять их приходится у всех учётных записей сразу. */
.adm-inline { width: 100%; min-width: 120px; font-size: 12.5px; padding: 2px 6px; }
.adm-date   { font-size: 11.5px; color: var(--tx3); font-family: Archivo, system-ui, sans-serif; white-space: nowrap; }
.adm-entity { font-family: Archivo, system-ui, sans-serif; font-size: 11.5px; color: var(--tx3); }
.adm-action { font-family: Archivo, system-ui, sans-serif; font-size: 12.5px; color: var(--accent); }

.adm-role-sel { padding: 2px 5px; height: 24px; font-size: 12.5px; width: 140px; }

/* Пароль задан не самим пользователем — сменит при входе (2.1) */
.adm-badge { margin-left: 6px; font-size: 11.5px; padding: 1px 6px; border-radius: 10px; white-space: nowrap;
  background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--accent); }
.adm-reset { padding: 2px 8px; height: 24px; font-size: 12.5px; white-space: nowrap; }
.adm-p { margin: 0 0 10px; font-size: 13.5px; line-height: 1.5; color: var(--tx2); }
.adm-muted { color: var(--tx3); }
.adm-temp { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.adm-temp-pw { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 18px; letter-spacing: .06em;
  padding: 6px 10px; border: 1px solid var(--border); background: var(--bg3); color: var(--tx1); user-select: all; }

.adm-toggle {
  font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 10px; border: none; cursor: pointer; transition: all .15s;
}
.adm-toggle--on  { background: var(--green-bg); color: var(--green); }
.adm-toggle--off { background: color-mix(in srgb, var(--danger) 20%, transparent); color: var(--danger); }



/* Вкладка «База данных» */
.db-note { font-size: 13.5px; color: var(--tx3); line-height: 1.5; margin: 0 0 10px; max-width: 78ch; }
.db-err  { font-size: 13.5px; color: var(--danger); margin: 0 0 10px; white-space: pre-line; }
.db-ok   { font-size: 13.5px; color: var(--tx2); margin: 0 0 10px; }
.db-warn { font-size: 14.5px; color: var(--danger); line-height: 1.5; margin: 0 0 8px; }
.adm-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.db-acts { white-space: nowrap; text-align: right; }
.btn.is-busy { opacity: .5; pointer-events: none; }
</style>
