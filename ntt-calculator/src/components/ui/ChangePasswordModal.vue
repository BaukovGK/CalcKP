<template>
  <BaseModal :show="show" title="Смена пароля" @close="close">
    <div class="ff">
      <label v-hint="ACCOUNT_HINTS.current" class="fl" for="pw-current">Текущий пароль</label>
      <input id="pw-current" v-model="form.current" class="fi" type="password" autocomplete="current-password" />
    </div>
    <div class="ff">
      <label v-hint="ACCOUNT_HINTS.next" class="fl" for="pw-next">Новый пароль</label>
      <input id="pw-next" v-model="form.next" class="fi" type="password" autocomplete="new-password" />
    </div>
    <div class="ff">
      <label v-hint="ACCOUNT_HINTS.repeat" class="fl" for="pw-repeat">Новый пароль ещё раз</label>
      <input
        id="pw-repeat"
        v-model="form.repeat"
        class="fi"
        type="password"
        autocomplete="new-password"
        @keydown.enter="submit"
      />
    </div>
    <div v-if="error" class="auth-err" role="alert">{{ error }}</div>
    <template #footer>
      <button class="btn btn-g" @click="close">Отмена</button>
      <button class="btn btn-am" :disabled="busy" @click="submit">{{ busy ? 'Сохраняем…' : 'Сменить пароль' }}</button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import { useAuthStore } from '@/stores/auth'
import { toast } from '@/composables/useToast'
import { ACCOUNT_HINTS } from '@/hints/account'
import { passwordChangeErrorText, passwordFormError } from '@/utils/password-form'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
const form = reactive({ current: '', next: '', repeat: '' })
const error = ref('')
const busy = ref(false)

/** Закрыть и забыть введённое: пароли в памяти формы не задерживаются. */
function close() {
  form.current = ''
  form.next = ''
  form.repeat = ''
  error.value = ''
  emit('close')
}

async function submit() {
  if (busy.value) return
  const problem = passwordFormError(form)
  if (problem) {
    error.value = problem
    return
  }
  busy.value = true
  error.value = ''
  try {
    await auth.changePassword(form.current, form.next)
    toast('Пароль изменён', 'success')
    close()
  } catch (e) {
    error.value = passwordChangeErrorText(e)
  } finally {
    busy.value = false
  }
}
</script>
