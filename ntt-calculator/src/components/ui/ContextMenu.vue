<template>
  <div
    v-if="show"
    class="ctx"
    :style="{ left: x + 'px', top: y + 'px' }"
    @click.stop
  >
    <template v-for="(it, i) in items" :key="i">
      <div v-if="it.head" class="ctx-hd">{{ it.head }}</div>
      <div v-else-if="it.sep" class="ctx-sep"></div>
      <div
        v-else
        class="ctx-i"
        :class="{ d: it.danger }"
        @click="it.action?.(); emit('close')"
      >{{ it.label }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { CtxItem } from '@/types/ui'

defineProps<{ show: boolean; x: number; y: number; items: CtxItem[] }>()
const emit = defineEmits<{ close: [] }>()
</script>
