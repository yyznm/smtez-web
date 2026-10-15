<script setup lang="ts">
import { computed } from 'vue'
import { useMachineStore } from '@/stores/machine'
import { useOverviewStore } from '@/stores/overview'
import CameraView from './CameraView.vue'

const overview = useOverviewStore()
const machine = useMachineStore()

const tiles = computed(() => {
  const cameraCount = Math.max(1, machine.cameraOptions.length)

  return Array.from({ length: overview.tileCount }, (_, index) => {
    const cameraId = index % cameraCount
    return {
      id: index,
      frame: machine.frames[cameraId] ?? null,
    }
  })
})
</script>

<template>
  <div class="grid" :style="{ gridTemplateColumns: `repeat(${overview.columns}, 1fr)` }">
    <CameraView
      v-for="tile in tiles"
      :key="tile.id"
      :frame="tile.frame"
      :zoom="overview.grid.zoom / 100"
      compact
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: 4px;
}
</style>
