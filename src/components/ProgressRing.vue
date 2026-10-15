<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    value: number
    size?: number
    label?: string
  }>(),
  { size: 118, label: '进度' },
)

const RADIUS = 42
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const dash = computed(() => (props.value / 100) * CIRCUMFERENCE)
</script>

<template>
  <div class="ring" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg viewBox="0 0 100 100" class="ring-svg">
      <circle class="ring-track" cx="50" cy="50" :r="RADIUS" />
      <circle
        class="ring-value"
        cx="50"
        cy="50"
        :r="RADIUS"
        :stroke-dasharray="`${dash} ${CIRCUMFERENCE}`"
      />
    </svg>
    <div class="ring-center">
      <b class="ring-num num">{{ value }}%</b>
      <span class="ring-label">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.ring {
  position: relative;
  flex: none;
}

.ring-svg {
  width: 100%;
  height: 100%;
  transform: rotate(-90deg);
}

.ring-track,
.ring-value {
  fill: none;
  stroke-width: 9;
}

.ring-track {
  stroke: var(--surface-3);
}

.ring-value {
  stroke: var(--accent);
  stroke-linecap: round;
  transition: stroke-dasharray 0.4s ease;
}

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
}

.ring-num {
  font-size: 22px;
  font-weight: 700;
  color: var(--text);
}

.ring-label {
  font-size: 10px;
  color: var(--text-3);
  letter-spacing: 0.08em;
}
</style>
