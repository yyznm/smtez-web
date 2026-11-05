<script setup lang="ts">
import { useMachineStore } from '@/stores/machine'
import type { JogAxis } from '@/types'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

const machine = useMachineStore()

interface PadCell {
  id: string
  icon: IconName
  key: string
  axis: JogAxis
  dir: 1 | -1
  /** grid-area: row / column */
  area: string
}

/** 3×3 键位：Z 轴升降 · XY 点动 · R 轴旋转，中心为回停留点 */
const CELLS: PadCell[] = [
  { id: 'z+', icon: 'arrow-up', key: 'Z', axis: 'z', dir: 1, area: '1 / 1' },
  { id: 'y+', icon: 'arrow-up', key: 'Y', axis: 'y', dir: 1, area: '1 / 2' },
  { id: 'r+', icon: 'rotate-cw', key: 'R', axis: 'r', dir: 1, area: '1 / 3' },
  { id: 'x-', icon: 'arrow-left', key: 'X', axis: 'x', dir: -1, area: '2 / 1' },
  { id: 'x+', icon: 'arrow-right', key: 'X', axis: 'x', dir: 1, area: '2 / 3' },
  { id: 'z-', icon: 'arrow-down', key: 'Z', axis: 'z', dir: -1, area: '3 / 1' },
  { id: 'y-', icon: 'arrow-down', key: 'Y', axis: 'y', dir: -1, area: '3 / 2' },
  { id: 'r-', icon: 'rotate-ccw', key: 'R', axis: 'r', dir: -1, area: '3 / 3' },
]

function buzz() {
  navigator.vibrate?.(8)
}

/** 单次点动：点击触发，不连发 */
function press(cell: PadCell) {
  machine.jog(cell.axis, cell.dir)
  buzz()
}

/** 中心键：回到数据库中的停留点 */
function goPark() {
  machine.park()
  buzz()
}
</script>

<template>
  <div class="pad">
    <button
      v-for="cell in CELLS"
      :key="cell.id"
      class="pad-btn"
      :style="{ gridArea: cell.area }"
      @click="press(cell)"
      @contextmenu.prevent
    >
      <AppIcon :name="cell.icon" :size="19" />
      <span class="pad-key">{{ cell.key }}</span>
    </button>

    <button class="pad-btn pad-home" @click="goPark()">
      <AppIcon name="home" :size="19" />
    </button>
  </div>
</template>

<style scoped>
.pad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 6px;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.pad-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text);
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  touch-action: none;
}

.pad-btn:active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent);
}

.pad-key {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-3);
}

.pad-btn:active .pad-key {
  color: var(--accent);
}

.pad-home {
  grid-area: 2 / 2;
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}

.pad-home .pad-key {
  color: var(--accent);
}
</style>
