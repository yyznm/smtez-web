<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CameraFrameSource } from '@/api/camera-stream'
import AppIcon from './AppIcon.vue'

const props = withDefaults(
  defineProps<{
    /** 解码后的实时画面；为空时不显示任何画面 */
    frame?: CameraFrameSource | null
    /** 失败原因，直接显示在画面上 */
    error?: string | null
    /** 宫格模式：不显示失败文字 */
    compact?: boolean
    /** 光学放大倍率 */
    zoom?: number
    /** 相机灯状态；传入时在画面右上角显示开关 */
    light?: boolean | null
  }>(),
  { frame: null, error: null, compact: false, zoom: 1, light: null },
)

const emit = defineEmits<{ 'toggle-light': [] }>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
const hasFrame = computed(() => Boolean(props.frame))
const liveStyle = computed(() => ({ transform: `scale(${props.zoom})` }))

function sizeOf(source: CameraFrameSource) {
  return 'naturalWidth' in source
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height }
}

/** 把解码后的画面绘制到画布，避免每帧创建对象地址 */
function draw(source: CameraFrameSource | null | undefined) {
  const canvas = canvasEl.value
  if (!canvas || !source) return
  const { width, height } = sizeOf(source)
  if (!width || !height) return
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const context = canvas.getContext('2d')
  if (!context) return
  // 裸图像帧直接写入像素，JPEG 帧走 drawImage
  if (source instanceof ImageData) context.putImageData(source, 0, 0)
  else context.drawImage(source, 0, 0, width, height)
}

watch(() => props.frame, draw, { immediate: true })
</script>

<template>
  <div class="camera" :class="{ 'is-compact': compact }">
    <canvas v-show="hasFrame" ref="canvasEl" class="camera-media" :style="liveStyle" />
    <div v-if="!hasFrame && error && !compact" class="camera-empty">
      <span class="camera-error">{{ error }}</span>
    </div>
    <!-- 画面中心十字标记（宫格小图不画，避免噪声） -->
    <div v-if="hasFrame && !compact" class="camera-cross" aria-hidden="true">
      <span class="cross-line cross-h" />
      <span class="cross-line cross-v" />
    </div>
    <!-- 右上角相机灯开关 -->
    <button
      v-if="light !== null"
      class="camera-light"
      :class="{ 'is-on': light }"
      :title="light ? '关闭相机灯' : '打开相机灯'"
      @click="emit('toggle-light')"
    >
      <AppIcon :name="light ? 'bulb' : 'bulb-off'" :size="16" />
    </button>
  </div>
</template>

<style scoped>
.camera {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: var(--r-md);
  overflow: hidden;
  background: #050506;
  border: 1px solid var(--line);
  max-height: 40vh;
}

.camera-media {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 0.2s ease;
}

.camera-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  text-align: center;
}

.camera-cross {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.cross-line {
  position: absolute;
  background: rgba(255, 45, 45, 0.9);
  box-shadow: 0 0 2px rgba(0, 0, 0, 0.65);
}

.cross-h {
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  transform: translateY(-0.5px);
}

.cross-v {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-0.5px);
}

.camera-light {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: 1px solid var(--line-2);
  background: rgba(5, 5, 6, 0.55);
  color: var(--text-2);
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.camera-light.is-on {
  color: var(--accent);
  border-color: var(--accent-line);
  background: rgba(5, 5, 6, 0.65);
}

.camera-light:active {
  background: rgba(5, 5, 6, 0.8);
}

.camera-error {
  font-size: 12px;
  line-height: 1.5;
  color: var(--danger);
  word-break: break-word;
}

.camera.is-compact {
  border-radius: var(--r-sm);
}
</style>
