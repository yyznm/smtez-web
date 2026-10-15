<script setup lang="ts">
import { useMachineStore } from '@/stores/machine'
import type { AxisKey } from '@/types'

const machine = useMachineStore()

const ITEMS: { key: AxisKey; label: string }[] = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'z1', label: 'Z1' },
  { key: 'z2', label: 'Z2' },
  { key: 'r1', label: 'R1' },
  { key: 'r2', label: 'R2' },
]

/** 位置未知时显示 -- */
const format = (value: number | null) => (value === null ? '--' : value.toFixed(2))
</script>

<template>
  <div class="coords">
    <div v-for="item in ITEMS" :key="item.key" class="coord">
      <span class="coord-label">{{ item.label }}</span>
      <span class="coord-value num">{{ format(machine.pos[item.key]) }}</span>
    </div>
  </div>
</template>

<style scoped>
.coords {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px 8px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}

.coord {
  display: flex;
  align-items: baseline;
  gap: 5px;
  min-width: 0;
}

.coord-label {
  font-size: 11px;
  color: var(--text-3);
  flex: none;
}

.coord-value {
  font-size: 13px;
  color: var(--text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
