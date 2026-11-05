<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import CameraTabs from '@/components/CameraTabs.vue'
import CameraView from '@/components/CameraView.vue'
import CoordBar from '@/components/CoordBar.vue'
import JogPad from '@/components/JogPad.vue'
import NozzleSwitch from '@/components/NozzleSwitch.vue'
import SpeedRail from '@/components/SpeedRail.vue'
import StepRail from '@/components/StepRail.vue'
import type { IconName } from '@/components/icons'
import { useMachineStore } from '@/stores/machine'

const machine = useMachineStore()

const channels = computed(() =>
  machine.cameraOptions.map((camera) => ({ id: camera.id, label: camera.label })),
)

const currentFrame = computed(() => machine.frames[machine.cameraId] ?? null)

/** 辅助动作：均对应文档中已确认的指令或数据库字段 */
const AUX: { id: string; icon: IconName; label: string; active: () => boolean; run: () => void }[] = [
  // { id: 'park', icon: 'home', label: '停靠', active: () => false, run: () => machine.park() },
  {
    id: 'to-camera',
    icon: 'nozzle',
    label: '吸嘴到相机',
    active: () => false,
    run: () => machine.nozzleToCamera(),
  },
  {
    id: 'to-nozzle',
    icon: 'crosshair',
    label: '相机到吸嘴',
    active: () => false,
    run: () => machine.cameraToNozzle(),
  },
  { id: 'reset-z', icon: 'arrow-down', label: '高度归0', active: () => false, run: () => machine.resetZ() },
  { id: 'reset-r', icon: 'rotate-cw', label: '旋转归0', active: () => false, run: () => machine.resetR() },
  { id: 'origin', icon: 'origin', label: '回零点', active: () => false, run: () => machine.goOrigin() },
  { id: 'reset', icon: 'rotate-ccw', label: '复位', active: () => false, run: () => machine.reset() },
]
</script>

<template>
  <div class="page">
    <div class="page-body">
      <CameraView
        :frame="currentFrame"
        :error="machine.cameraError"
        :light="machine.cameraLight"
        @toggle-light="machine.setCameraLight(!machine.cameraLight)"
      />

      <CameraTabs
        v-if="channels.length"
        :model-value="machine.cameraId"
        :channels="channels"
        @update:model-value="machine.setCamera"
      />

      <div class="nozzle-row">
        <NozzleSwitch
          :model-value="machine.nozzleIndex"
          :nozzles="machine.nozzleOptions"
          :streaming="machine.cameraActive"
          @update:model-value="machine.setNozzle"
        />
        <div class="chips">
          <span class="chip">步进 {{ machine.step }}mm</span>
          <span class="chip">速度 {{ machine.speed }}%</span>
        </div>
      </div>

      <div class="aux-row">
        <button
          v-for="item in AUX"
          :key="item.id"
          class="aux-btn"
          :class="{ 'is-active': item.active() }"
          @click="item.run()"
        >
          <AppIcon :name="item.icon" :size="18" />
          <span class="aux-label">{{ item.label }}</span>
        </button>
      </div>

      <div class="controls">
        <JogPad />
        <div class="rails">
          <StepRail :model-value="machine.step" @update:model-value="machine.setStepValue" />
          <SpeedRail :model-value="machine.speed" @update:model-value="machine.setSpeed" />
        </div>
      </div>

      <CoordBar />
    </div>
  </div>
</template>

<style scoped>
.page-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-body > * {
  flex: none;
}

.nozzle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.nozzle-row .chips {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex: none;
}

.aux-row {
  display: flex;
  gap: 6px;
}

.aux-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 48px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text-2);
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.aux-btn:active {
  background: var(--surface-3);
}

.aux-btn.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}

.aux-label {
  font-size: 9px;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: stretch;
  /* 点动区高度：过高会挤掉下面的内容，过矮按键不好按 */
  height: 216px;
}

.rails {
  display: flex;
  gap: 8px;
  flex: none;
}
</style>
