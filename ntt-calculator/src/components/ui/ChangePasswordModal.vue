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
import BaseModal from '@/components/ui/BaseModal.vue'
import { usePasswordChange } from '@/composables/usePasswordChange'
import { toast } from '@/composables/useToast'
import { ACCOUNT_HINTS } from '@/hints/account'

defineProps<{ show: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { form, error, busy, reset, submit: change } = usePasswordChange()

/** Закрыть и забыть введённое: пароли в памяти формы не задерживаются. */
function close() {
  reset()
  emit('close')
}

async function submit() {
  if (!(await change())) return
  toast('Пароль изменён', 'success')
  close()
}
</script>
