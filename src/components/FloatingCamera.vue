<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useMachineStore } from '@/stores/machine'
import CameraView from './CameraView.vue'

const machine = useMachineStore()

/** 三档宽度：屏幕宽度的 25% / 50% / 95% */
const RATIOS = [0.33, 0.55, 0.95] as const
const MARGIN = 12
/** 导航栏高度 + 间距，小窗默认停在它上面 */
const BOTTOM_OFFSET = 54 + 12
/** 指针移动小于该距离视为点击（切换大小） */
const TAP_THRESHOLD = 6

const ratioIndex = ref(0)
const dragging = ref(false)
const viewport = reactive({ width: window.innerWidth, height: window.innerHeight })
const position = reactive({ x: 0, y: 0 })

const ratio = computed(() => RATIOS[ratioIndex.value])
const width = computed(() => Math.round(viewport.width * ratio.value))
const height = computed(() => Math.round((width.value * 9) / 16))
/** 接近整屏宽度时不再保留左右边距 */
const nearFull = computed(() => ratio.value >= 0.9)

const frame = computed(() => machine.frames[machine.cameraId] ?? null)

function clamp(x: number, y: number) {
  const padY = height.value >= viewport.height ? 0 : MARGIN
  const maxY = Math.max(padY, viewport.height - height.value - padY)
  const nextY = Math.min(Math.max(padY, y), maxY)
  // 接近整屏宽度时左右居中固定，只允许上下拖动
  if (nearFull.value) {
    return { x: Math.round((viewport.width - width.value) / 2), y: nextY }
  }
  const maxX = Math.max(MARGIN, viewport.width - width.value - MARGIN)
  return { x: Math.min(Math.max(MARGIN, x), maxX), y: nextY }
}

function apply(x: number, y: number) {
  const next = clamp(x, y)
  position.x = next.x
  position.y = next.y
}

/** 默认停在右下角、导航栏上方 */
function resetPosition() {
  apply(viewport.width - width.value - MARGIN, viewport.height - height.value - BOTTOM_OFFSET)
}

let moved = 0
let originPointer = { x: 0, y: 0 }
let originPosition = { x: 0, y: 0 }

function onPointerDown(event: PointerEvent) {
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  dragging.value = true
  moved = 0
  originPointer = { x: event.clientX, y: event.clientY }
  originPosition = { x: position.x, y: position.y }
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const dx = event.clientX - originPointer.x
  const dy = event.clientY - originPointer.y
  moved = Math.max(moved, Math.hypot(dx, dy))
  apply(originPosition.x + dx, originPosition.y + dy)
}

function onPointerUp() {
  if (!dragging.value) return
  dragging.value = false
  if (moved < TAP_THRESHOLD) cycleSize()
}

/** 点击在 25% → 50% → 95% 之间循环 */
function cycleSize() {
  const center = { x: position.x + width.value / 2, y: position.y + height.value / 2 }
  ratioIndex.value = (ratioIndex.value + 1) % RATIOS.length
  apply(center.x - width.value / 2, center.y - height.value / 2)
}

function onResize() {
  viewport.width = window.innerWidth
  viewport.height = window.innerHeight
  apply(position.x, position.y)
}

onMounted(() => {
  resetPosition()
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => window.removeEventListener('resize', onResize))
</script>

<template>
  <div
    class="floating"
    :class="{ 'is-large': ratio > 0.5, 'is-dragging': dragging }"
    :style="{
      left: `${position.x}px`,
      top: `${position.y}px`,
      width: `${width}px`,
      height: `${height}px`,
    }"
    @pointerdown.prevent="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @contextmenu.prevent
  >
    <CameraView :frame="frame" :error="machine.cameraError" :compact="ratio < 0.5" />
  </div>
</template>

<style scoped>
.floating {
  position: fixed;
  z-index: 80;
  border-radius: var(--r-md);
  overflow: hidden;
  border: 1px solid var(--line-2);
  background: #050506;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  touch-action: none;
}

/* 拖动时不做过渡，切换大小时平滑变化 */
.floating:not(.is-dragging) {
  transition:
    width 0.18s ease,
    height 0.18s ease,
    left 0.18s ease,
    top 0.18s ease,
    box-shadow 0.15s ease;
}

.floating.is-dragging {
  box-shadow: 0 14px 34px rgba(0, 0, 0, 0.6);
}

/* 画面铺满整个小窗，尺寸完全由容器决定 */
.floating :deep(.camera) {
  height: 100%;
  aspect-ratio: auto;
  border: 0;
  border-radius: 0;
}
</style>
