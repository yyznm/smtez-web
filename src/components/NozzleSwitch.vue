<script setup lang="ts">
import type { NozzleOption } from '@/stores/machine'

const props = defineProps<{
  modelValue: number
  nozzles: NozzleOption[]
  /** 实时画面是否在推流，用于角标提示 */
  streaming: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <div class="nozzles">
    <button
      v-for="item in props.nozzles"
      :key="item.slot"
      class="nozzle"
      :class="{ 'is-active': item.index === props.modelValue }"
      @click="emit('update:modelValue', item.index)"
    >
      <span class="nozzle-id">{{ item.slot }}</span>
      <span class="nozzle-bore num">{{ item.nozzleid || '空' }}</span>
      <span v-if="item.index === props.modelValue && props.streaming" class="nozzle-dot" />
    </button>
    <span v-if="!props.nozzles.length" class="nozzle-empty">未配置吸嘴</span>
  </div>
</template>

<style scoped>
.nozzles {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.nozzles::-webkit-scrollbar {
  display: none;
}

.nozzle {
  display: flex;
  align-items: baseline;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface);
  color: var(--text-3);
  flex: none;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}

.nozzle-id {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.nozzle-bore {
  font-size: 11px;
}

.nozzle.is-active {
  color: var(--text);
  background: var(--surface-3);
  border-color: var(--line-2);
}

.nozzle.is-active .nozzle-bore {
  color: var(--accent);
}

.nozzle-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  align-self: center;
}

.nozzle-empty {
  font-size: 12px;
  color: var(--text-3);
}
</style>
