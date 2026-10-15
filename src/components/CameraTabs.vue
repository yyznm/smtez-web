<script setup lang="ts">
export interface CameraTab {
  id: number
  label: string
}

const props = defineProps<{ modelValue: number; channels: CameraTab[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
</script>

<template>
  <div class="channels">
    <button
      v-for="item in props.channels"
      :key="item.id"
      class="channel"
      :class="{ 'is-active': item.id === props.modelValue }"
      @click="emit('update:modelValue', item.id)"
    >
      {{ item.label }}
    </button>
  </div>
</template>

<style scoped>
.channels {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--line);
}

.channels::-webkit-scrollbar {
  display: none;
}

.channel {
  position: relative;
  flex: none;
  padding: 10px 12px 11px;
  font-size: 13px;
  color: var(--text-3);
  white-space: nowrap;
  transition: color 0.15s;
}

.channel.is-active {
  color: var(--text);
  font-weight: 600;
}

.channel.is-active::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: -1px;
  height: 2px;
  border-radius: 1px;
  background: var(--accent);
}
</style>
