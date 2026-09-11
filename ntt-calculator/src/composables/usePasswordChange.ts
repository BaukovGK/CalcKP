import { reactive, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { passwordChangeErrorText, passwordFormError } from '@/utils/password-form'

/**
 * Форма смены своего пароля — общая для окна «Сменить пароль» в меню
 * пользователя и экрана обязательной смены (`views/PasswordView.vue`,
 * План_устранения 2.1): одни проверки, одни тексты ошибок.
 */
export function usePasswordChange() {
  const auth = useAuthStore()
  const form = reactive({ current: '', next: '', repeat: '' })
  const error = ref('')
  const busy = ref(false)

  /** Забыть введённое: пароли в памяти формы не задерживаются. */
  function reset() {
    form.current = ''
    form.next = ''
    form.repeat = ''
    error.value = ''
  }

  /** Сменить пароль. `true` — сменён, форма очищена; иначе текст — в `error`. */
  async function submit(): Promise<boolean> {
    if (busy.value) return false
    const problem = passwordFormError(form)
    if (problem) {
      error.value = problem
      return false
    }
    busy.value = true
    error.value = ''
    try {
      await auth.changePassword(form.current, form.next)
      reset()
      return true
    } catch (e) {
      error.value = passwordChangeErrorText(e)
      return false
    } finally {
      busy.value = false
    }
  }

  return { form, error, busy, reset, submit }
}
