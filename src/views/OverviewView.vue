<script setup lang="ts">
import { computed } from 'vue'
import CameraGrid from '@/components/CameraGrid.vue'
import ProgressRing from '@/components/ProgressRing.vue'
import SpeedChart from '@/components/SpeedChart.vue'
import { LAYOUT_CAPACITY, useOverviewStore } from '@/stores/overview'
import type { GridLayout } from '@/types'

const overview = useOverviewStore()

const LAYOUTS = Object.keys(LAYOUT_CAPACITY) as GridLayout[]

const KPIS = computed(() => [
  { id: 'speed', label: '速度', value: overview.stats.speed.toFixed(2), unit: 'mm/s' },
  { id: 'reject', label: '抛料', value: String(overview.stats.reject), unit: '次' },
  { id: 'placed', label: '已贴装', value: String(overview.stats.placed), unit: '点' },
  { id: 'target', label: '计划', value: String(overview.stats.total), unit: '点' },
])

function setCount(value: boolean | number | string) {
  overview.setCount(Number(value))
}

function setZoom(value: number | number[]) {
  overview.grid.zoom = Array.isArray(value) ? value[0] : value
}
</script>

<template>
  <div class="page">
    <header class="topbar">
      <span class="dot is-run" />
      <span class="topbar-title">总览</span>
      <span class="topbar-spacer" />
      <span class="chip is-ok">实时</span>
    </header>

    <div class="page-body">
      <div class="kpi">
        <ProgressRing :value="overview.progress" />
        <div class="kpi-list">
          <div v-for="item in KPIS" :key="item.id" class="kpi-item">
            <span class="kpi-label">{{ item.label }}</span>
            <b class="kpi-value num">{{ item.value }}<i>{{ item.unit }}</i></b>
          </div>
        </div>
      </div>

      <section class="panel">
        <div class="panel-head">
          <span class="panel-title">速度 / 进度</span>
          <span class="panel-sub">近 120s</span>
          <span class="topbar-spacer" />
          <span class="legend">
            <i class="legend-dot" style="background: #3ddc97" />进度
            <i class="legend-dot" style="background: #4c9aff" />速度
            <i class="legend-dot" style="background: #ff5b5f" />抛料
          </span>
        </div>
        <SpeedChart :samples="overview.samples" />
      </section>

      <section class="panel grid-panel">
        <div class="panel-head">
          <span class="panel-title">相机</span>
          <span class="panel-sub">{{ overview.tileCount }} 路</span>
        </div>

        <div class="controls">
          <div class="ctl">
            <span class="ctl-label">数量</span>
            <van-stepper
              :model-value="overview.count"
              :min="1"
              :max="9"
              input-width="34px"
              button-size="24px"
              @update:model-value="setCount($event)"
            />
          </div>

          <div class="ctl">
            <span class="ctl-label">布局</span>
            <div class="seg">
              <button
                v-for="layout in LAYOUTS"
                :key="layout"
                class="seg-item"
                :class="{ 'is-active': layout === overview.grid.layout }"
                @click="overview.grid.layout = layout"
              >
                {{ layout }}
              </button>
            </div>
          </div>

          <div class="ctl ctl-zoom">
            <span class="ctl-label">缩放</span>
            <van-slider
              :model-value="overview.grid.zoom"
              :min="40"
              :max="200"
              bar-height="4px"
              @update:model-value="setZoom($event)"
            />
            <span class="ctl-value num">{{ overview.grid.zoom }}%</span>
          </div>
        </div>

        <div class="grid-wrap">
          <CameraGrid />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.kpi {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 16px 4px 4px;
}

.kpi-list {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px 10px;
}

.kpi-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.kpi-label {
  font-size: 11px;
  color: var(--text-3);
}

.kpi-value {
  font-size: 16px;
  font-weight: 650;
  color: var(--text);
  white-space: nowrap;
}

.kpi-value i {
  font-size: 10px;
  font-style: normal;
  font-weight: 400;
  color: var(--text-3);
  margin-left: 3px;
}

.panel {
  margin-top: 14px;
}

.legend {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-3);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-left: 4px;
}

.grid-panel {
  padding-bottom: 12px;
}

.controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.ctl {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ctl-label {
  width: 32px;
  flex: none;
  font-size: 12px;
  color: var(--text-3);
}

.ctl .seg {
  flex: 1;
  min-width: 0;
}

.ctl-zoom :deep(.van-slider) {
  flex: 1;
  min-width: 0;
}

.ctl-value {
  width: 44px;
  flex: none;
  text-align: right;
  font-size: 12px;
  color: var(--text-2);
}

.controls :deep(.van-stepper__input) {
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text);
  background: var(--surface-2);
}

.grid-wrap {
  padding: 0 12px;
  padding-top: 4px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
</style>
