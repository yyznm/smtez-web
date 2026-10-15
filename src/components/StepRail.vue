<script setup lang="ts">
import { computed, ref } from 'vue'
import { STEP_PRESETS } from '@/stores/machine'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const trackEl = ref<HTMLElement | null>(null)
let dragging = false

const STEP_MIN = STEP_PRESETS[STEP_PRESETS.length - 1]
const STEP_MAX = STEP_PRESETS[0]
const LOG_MAX = Math.log10(STEP_MAX)
const LOG_MIN = Math.log10(STEP_MIN)

/** 档位按对数刻度均匀分布，非档位值也能落在正确位置上 */
function positionOf(value: number) {
  const clamped = Math.min(STEP_MAX, Math.max(STEP_MIN, value))
  return ((LOG_MAX - Math.log10(clamped)) / (LOG_MAX - LOG_MIN)) * 100
}

const thumbPct = computed(() => positionOf(props.modelValue))

const displayValue = computed(() =>
  Number.isInteger(props.modelValue)
    ? String(props.modelValue)
    : String(Number(props.modelValue.toFixed(4))),
)

const ticks = computed(() =>
  STEP_PRESETS.map((value) => ({
    value,
    label: String(value),
    pct: positionOf(value),
  })),
)

function apply(clientY: number) {
  const el = trackEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
  // 顶部为大档位，与 thumbPct 的刻度方向保持一致
  const i = Math.round(ratio * (STEP_PRESETS.length - 1))
  emit('update:modelValue', STEP_PRESETS[i])
}

function onDown(event: PointerEvent) {
  dragging = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  apply(event.clientY)
}

function onMove(event: PointerEvent) {
  if (dragging) apply(event.clientY)
}

function onUp() {
  dragging = false
}
</script>

<template>
  <div class="rail">
    <div class="rail-head">
      <span class="rail-title">步进</span>
      <span class="rail-value num">{{ displayValue }}<i>/mm</i></span>
    </div>
    <div class="rail-body">
      <div class="rail-ticks">
        <button
          v-for="tick in ticks"
          :key="tick.value"
          class="rail-tick num"
          :class="{ 'is-on': tick.value === modelValue }"
          :style="{ top: `${tick.pct}%` }"
          @click="emit('update:modelValue', tick.value)"
        >
          {{ tick.label }}
        </button>
      </div>
      <div
        ref="trackEl"
        class="rail-track"
        @pointerdown.prevent="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <span class="rail-fill" :style="{ top: `${thumbPct}%` }" />
        <span class="rail-thumb" :style="{ top: `${thumbPct}%` }" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.rail-head {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.rail-title {
  font-size: 11px;
  color: var(--text-3);
}

.rail-value {
  font-size: 15px;
  font-weight: 650;
  color: var(--accent);
  line-height: 1.1;
}

.rail-value i {
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  color: var(--text-3);
}

.rail-body {
  display: flex;
  gap: 8px;
  flex: 1;
  min-height: 0;
  padding: 4px 0;
}

.rail-ticks {
  position: relative;
  width: 28px;
  flex: none;
}

.rail-tick {
  position: absolute;
  right: 0;
  transform: translateY(-50%);
  font-size: 10px;
  color: var(--text-3);
  padding: 1px 2px;
}

.rail-tick.is-on {
  color: var(--accent);
  font-weight: 700;
}

.rail-track {
  position: relative;
  width: 18px;
  flex: none;
  border-radius: 6px;
  background: var(--surface-3);
  border: 1px solid var(--line);
  touch-action: none;
  overflow: hidden;
}

.rail-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--accent-soft);
}

.rail-thumb {
  position: absolute;
  left: 0;
  right: 0;
  height: 5px;
  transform: translateY(-2.5px);
  background: var(--accent);
  border-radius: 2px;
}
</style>
