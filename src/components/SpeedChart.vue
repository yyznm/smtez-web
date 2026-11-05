<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { init, use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import type { SpeedSample } from '@/types'

use([LineChart, BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ samples: SpeedSample[] }>()

const el = ref<HTMLElement | null>(null)
let chart: ReturnType<typeof init> | null = null

/* 与 tokens.css 的主题保持一致（ECharts 需要具体色值） */
const AXIS_LINE = '#26262d'
const AXIS_TEXT = '#666d7a'
const GRID_LINE = '#1b1b20'
const TOOLTIP_BG = '#141418'
const TOOLTIP_TEXT = '#eceff3'
const SERIES_PROGRESS = '#1fbf72'
const SERIES_SPEED = '#4c9aff'
const SERIES_REJECT = '#ff5b5f'

function buildOption() {
  const list = props.samples
  return {
    grid: { left: 2, right: 2, top: 32, bottom: 2, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      itemWidth: 12,
      itemHeight: 3,
      itemGap: 14,
      textStyle: { color: AXIS_TEXT, fontSize: 10 },
      data: ['进度', '速度', '抛料'],
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: TOOLTIP_BG,
      borderColor: AXIS_LINE,
      textStyle: { color: TOOLTIP_TEXT, fontSize: 11 },
      axisPointer: { lineStyle: { color: AXIS_LINE } },
    },
    xAxis: {
      type: 'category',
      boundaryGap: true,
      data: list.map((item) => String(item.t)),
      axisLine: { lineStyle: { color: AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: { color: AXIS_TEXT, fontSize: 10, interval: 29 },
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        splitLine: { lineStyle: { color: GRID_LINE } },
        axisLabel: { color: AXIS_TEXT, fontSize: 10 },
      },
      {
        type: 'value',
        min: 0,
        max: 100,
        position: 'right',
        splitLine: { show: false },
        axisLabel: { color: AXIS_TEXT, fontSize: 10, formatter: '{value}%' },
      },
    ],
    series: [
      {
        name: '进度',
        type: 'line',
        yAxisIndex: 1,
        data: list.map((item) => item.progress),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.6, color: SERIES_PROGRESS },
        itemStyle: { color: SERIES_PROGRESS },
      },
      {
        name: '速度',
        type: 'line',
        yAxisIndex: 0,
        data: list.map((item) => item.speed),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.6, color: SERIES_SPEED },
        itemStyle: { color: SERIES_SPEED },
        areaStyle: { color: 'rgba(76, 154, 255, 0.12)' },
      },
      {
        name: '抛料',
        type: 'bar',
        yAxisIndex: 0,
        data: list.map((item) => item.reject),
        barWidth: 5,
        itemStyle: { color: SERIES_REJECT, borderRadius: [2, 2, 0, 0] },
      },
    ],
  }
}

function render() {
  chart?.setOption(buildOption())
}

function resize() {
  chart?.resize()
}

onMounted(() => {
  if (!el.value) return
  chart = init(el.value)
  render()
  window.addEventListener('resize', resize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
  chart = null
})

watch(() => props.samples, render, { deep: true })
</script>

<template>
  <div ref="el" class="chart" />
</template>

<style scoped>
.chart {
  width: 100%;
  height: 190px;
}
</style>
