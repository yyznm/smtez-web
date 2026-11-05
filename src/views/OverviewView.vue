<script setup lang="ts">
import { computed } from 'vue'
import ProgressRing from '@/components/ProgressRing.vue'
import SpeedChart from '@/components/SpeedChart.vue'
import { useOverviewStore } from '@/stores/overview'

const overview = useOverviewStore()

const KPIS = computed(() => [
  { id: 'speed', label: '速度', value: String(overview.stats.speed), unit: '点/时' },
  { id: 'reject', label: '抛料', value: String(overview.stats.reject), unit: '次' },
  { id: 'placed', label: '已贴装', value: String(overview.stats.placed), unit: '点' },
  { id: 'target', label: '计划', value: String(overview.stats.total), unit: '点' },
])
</script>

<template>
  <div class="page">
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
            <i class="legend-dot is-progress" />进度
            <i class="legend-dot is-speed" />速度
            <i class="legend-dot is-reject" />抛料
          </span>
        </div>
        <SpeedChart :samples="overview.samples" />
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

.legend-dot.is-progress {
  background: var(--accent);
}

.legend-dot.is-speed {
  background: var(--info);
}

.legend-dot.is-reject {
  background: var(--danger);
}
</style>
