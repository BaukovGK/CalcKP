<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-top">
        <button class="back-link" @click="router.push('/')">← Проекты</button>
        <div class="logo" style="margin-top:4px">Настройки</div>
        <div class="logo-sub">{{ auth.user?.name }}</div>
      </div>
      <div class="sidebar-scroll">
        <div class="nav-section">Разделы</div>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'profile' }" @click="tab = 'profile'">
          Личные данные
        </button>
        <button class="nav-link" :class="{ 'nav-link--active': tab === 'security' }" @click="tab = 'security'">
          Безопасность
        </button>
      </div>
      <div class="sidebar-footer">
        <ThemeToggle />
      </div>
    </aside>

    <div class="main-col">
      <div class="topbar">
        <div class="tb-title">{{ tab === 'profile' ? 'Личные данные' : 'Безопасность' }}</div>
        <div class="tb-spacer"></div>
        <button v-if="tab === 'profile'" class="btn btn-am" :disabled="saving || !dirty" @click="save">
          {{ saving ? 'Сохранение…' : 'Сохранить' }}
        </button>
      </div>

      <!-- ── Личные данные ── -->
      <div v-if="tab === 'profile'" class="calc-area">
        <div class="set-card">
          <p class="set-note">
            ФИО, должность и телефон печатаются в коммерческом предложении — в блоке исполнителя
            под подписью. Заполните их так, как заказчик должен их прочитать.
          </p>

          <div class="ol-grid">
            <label class="fld fld--6">
              <span v-hint="SETTINGS_HINTS.name">ФИО <b class="req">*</b></span>
              <input v-model="form.name" placeholder="Иванов Сергей Владимирович" :class="{ 'is-missing': !form.name.trim() }" />
            </label>
            <label class="fld fld--6">
              <span v-hint="SETTINGS_HINTS.position">Должность</span>
              <input v-model="form.position" placeholder="Инженер-конструктор" />
            </label>
            <label class="fld fld--6">
              <span v-hint="SETTINGS_HINTS.phone">Рабочий телефон</span>
              <input v-model="form.phone" placeholder="+7 (499) 000-00-00 доб. 000" />
            </label>
            <label class="fld fld--6">
              <span v-hint="SETTINGS_HINTS.email">Почта (логин)</span>
              <input :value="auth.user?.email ?? ''" disabled />
            </label>
            <label class="fld fld--6">
              <span v-hint="SETTINGS_HINTS.role">Роль</span>
              <input :value="roleLabel" disabled />
            </label>
          </div>

          <p class="set-preview">
            В документе: <b>{{ previewName }}</b><template v-if="form.position.trim()">, {{ form.position.trim() }}</template>
          </p>
          <div v-if="error" class="auth-err">{{ error }}</div>
        </div>
      </div>

      <!-- ── Безопасность ── -->
      <div v-else class="calc-area">
        <div class="set-card">
          <p class="set-note">
            Пароль меняется только себе и только после ввода текущего. Вход на других устройствах
            после смены завершается — там войдут уже с новым паролем.
          </p>
          <div class="set-actions">
            <button v-hint="ACCOUNT_HINTS.changePassword" class="btn" @click="passwordOpen = true">
              Сменить пароль
            </button>
            <button v-hint="ACCOUNT_HINTS.logoutAll" class="btn" :disabled="leavingAll" @click="logoutAll">
              Выйти на всех устройствах
            </button>
          </div>
        </div>
      </div>
    </div>

    <ChangePasswordModal :show="passwordOpen" @close="passwordOpen = false" />
    <ToastHost />
  </div>
</template>

<script setup lang="ts">
/**
 * Настройки учётной записи: личные данные и безопасность.
 *
 * Раньше в блоке пользователя была одна кнопка — «Сменить пароль», а ФИО,
 * должность и телефон правил только администратор. Эти три поля печатает блок
 * исполнителя в КП (`backend/utils/kp-terms.ts`), и заполнять их через
 * администратора — лишний посредник: сотрудник правит их сам.
 *
 * Роль и почта остаются за администратором: иначе любой поднял бы себе права.
 */
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChangePasswordModal from '@/components/ui/ChangePasswordModal.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import { useAuthStore } from '@/stores/auth'
import { useProjectsStore } from '@/stores/projects'
import { ACCOUNT_HINTS, SETTINGS_HINTS } from '@/hints/account'
import { shortName } from '@/utils/person-name'
import { toast } from '@/composables/useToast'
import '@/assets/survey-form.css'

const router = useRouter()
const auth = useAuthStore()
const projects = useProjectsStore()

const tab = ref<'profile' | 'security'>('profile')
const passwordOpen = ref(false)
const leavingAll = ref(false)
const saving = ref(false)
const error = ref('')

const form = reactive({ name: '', position: '', phone: '' })

/** Форма живёт из сессии: профиль сервер отдаёт при входе и на `/auth/me`. */
watch(
  () => auth.user,
  (u) => {
    form.name = u?.name ?? ''
    form.position = u?.position ?? ''
    form.phone = u?.phone ?? ''
  },
  { immediate: true, deep: true },
)

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер',
  ENGINEER: 'Инженер',
  TECHNOLOG: 'Технолог',
  BUYER: 'Снабженец',
  VIEWER: 'Наблюдатель',
}
const roleLabel = computed(() => ROLE_LABELS[auth.role ?? ''] ?? auth.role ?? '—')

/** Как ФИО будет выглядеть в документе: «Иванов С.В.». */
const previewName = computed(() => shortName(form.name) ?? '—')

const dirty = computed(
  () =>
    form.name.trim() !== (auth.user?.name ?? '') ||
    form.position.trim() !== (auth.user?.position ?? '') ||
    form.phone.trim() !== (auth.user?.phone ?? ''),
)

async function save() {
  if (!form.name.trim()) {
    error.value = 'Укажите ФИО: без него в КП нечего печатать'
    return
  }
  saving.value = true
  error.value = ''
  try {
    await auth.updateProfile({
      name: form.name.trim(),
      position: form.position.trim() || null,
      phone: form.phone.trim() || null,
    })
    toast('Личные данные сохранены', 'success')
  } catch (e) {
    const r = (e as { response?: { data?: { message?: string } } }).response
    error.value = r?.data?.message ?? 'Не удалось сохранить — сервер недоступен'
  } finally {
    saving.value = false
  }
}

/** Выйти на всех устройствах — все сессии отозваны, эта тоже (План 2.3). */
async function logoutAll() {
  leavingAll.value = true
  try {
    await auth.logoutAll()
    projects.clear()
    await router.push('/login')
  } catch {
    toast('Не удалось выйти на всех устройствах — сервер недоступен, попробуйте ещё раз', 'error')
  } finally {
    leavingAll.value = false
  }
}
</script>

<style scoped>
.set-card { max-width: 720px; margin: 16px auto 0; padding: 16px 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  display: flex; flex-direction: column; gap: 14px; }
.set-note { font-size: 12.6px; color: var(--muted); line-height: 1.5; }
.set-preview { font-size: 12.6px; color: var(--muted); }
.set-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.req { color: var(--acc); }
</style>
