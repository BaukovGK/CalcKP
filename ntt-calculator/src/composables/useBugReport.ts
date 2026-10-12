import { computed, onBeforeUnmount, onMounted, readonly, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'

/**
 * «Сообщить о проблеме»: одно окно на всё приложение и кнопка в оболочке
 * каждого экрана.
 *
 * Окно (`components/ui/BugReportDialog.vue`) живёт в `App.vue`, поверх любого
 * экрана. Кнопка (`components/ui/BugReportButton.vue`) стоит в оболочке
 * экрана — там же, где переключатель темы: в подвале боковой панели или в
 * шапке рабочего экрана. Плавающая кнопка в углу закрывала содержимое —
 * «Цену продажи» в опросном листе, кнопки строк в таблицах справочников.
 *
 * Экран без своей кнопки — обязательная смена пароля, загрузка и ошибка
 * опросного листа, новый экран, в который её забыли поставить, — получает
 * запасную в правом нижнем углу (`BugReportFab.vue`). Для этого кнопки
 * оболочки отмечаются в счётчике: пока хоть одна на экране, запасной нет.
 *
 * Кто может отправить отчёт, решает `App.vue`: окно он монтирует только
 * вошедшему сотруднику и не на экране входа. Кнопки смотрят на само окно —
 * нет его, нет и кнопок, — поэтому хранилище авторизации им не нужно.
 */

const isOpen = ref(false)
/** Сколько кнопок «Сообщить о проблеме» сейчас в оболочке экрана. */
const shellButtons = ref(0)
/** Окно отчёта смонтировано: отправить есть куда. */
const dialogs = ref(0)

/** Окно открыто. */
export const bugReportOpen = readonly(isOpen)

/** На экране есть своя кнопка — запасная не нужна. */
export const hasShellButton = computed(() => shellButtons.value > 0)

/** Окно отчёта есть в приложении — кнопкам есть что открывать. */
export const bugReportReady = computed(() => dialogs.value > 0)

export function openBugReport(): void {
  isOpen.value = true
}

export function closeBugReport(): void {
  isOpen.value = false
}

/** Отметить кнопку оболочки на время, пока она на экране. */
export function useShellButton(): void {
  onMounted(() => {
    shellButtons.value++
  })
  onBeforeUnmount(() => {
    shellButtons.value--
  })
}

/** Отметить окно отчёта на время, пока оно смонтировано. */
export function useDialogPresence(): void {
  onMounted(() => {
    dialogs.value++
  })
  onBeforeUnmount(() => {
    dialogs.value--
  })
}

/**
 * Отправить отчёт может вошедший сотрудник. Демо-вход работает без сервера —
 * отправлять ему некуда. По этому правилу `App.vue` монтирует окно.
 */
export function useBugReportAvailable() {
  const auth = useAuthStore()
  return computed(() => auth.isLoggedIn && auth.accessToken !== 'demo-token')
}

/** Сноска у кнопки — одна для кнопки оболочки и запасной. */
export const BUG_REPORT_HINT = {
  title: 'Сообщить о проблеме',
  text: 'Что-то посчитано неверно, не сохраняется или непонятно — опишите это и приложите скриншот. Отчёт уйдёт администратору вместе с адресом экрана.',
}
