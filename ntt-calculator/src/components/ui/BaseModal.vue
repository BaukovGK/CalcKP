<template>
  <div v-if="show" class="mo" @click.self="closeOnBackdrop !== false && emit('close')">
    <div class="mo-box" @click.stop>
      <div class="mo-hd">
        <span class="mo-tt">{{ title }}</span>
        <button class="ib" @click="emit('close')">✕</button>
      </div>
      <div class="mo-bd">
        <slot />
      </div>
      <div class="mo-ft">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ show: boolean; title: string; closeOnBackdrop?: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>
