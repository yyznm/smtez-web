import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { useDatabaseStore } from '@/stores/database'
import type { GridLayout, SpeedSample } from '@/types'

/** 曲线窗口（秒） */
export const WINDOW_SECONDS = 120

/** 宫格布局容量 */
export const LAYOUT_CAPACITY: Record<GridLayout, number> = {
  '1x1': 1,
  '2x2': 4,
  '3x3': 9,
}

function seedSamples(): SpeedSample[] {
  const list: SpeedSample[] = []
  for (let t = 0; t <= WINDOW_SECONDS; t += 2) {
    const wave = Math.sin(t / 9) * 0.85 + Math.sin(t / 3.1) * 0.3
    list.push({
      t,
      progress: Math.min(100, Math.round((t / WINDOW_SECONDS) * 100)),
      speed: Math.max(0.4, Number((8.4 + wave).toFixed(2))),
      reject: Math.floor(t / 40),
    })
  }
  return list
}

export const useOverviewStore = defineStore('overview', () => {
  const database = useDatabaseStore()

  const samples = ref<SpeedSample[]>(seedSamples())
  const currentProgress = ref(100)
  const speedNow = ref(8.4)
  const rejectCount = ref(3)
  const countOverride = ref<number | null>(null)

  const grid = reactive({
    layout: '3x3' as GridLayout,
    zoom: 100,
  })

  /** 画面数量默认取数据库 /setting/infoImageCount */
  const infoImageCount = computed(() => database.getNumber('/setting/infoImageCount', 9))
  const count = computed(
    () => countOverride.value ?? Math.min(9, Math.max(1, Math.round(infoImageCount.value))),
  )

  /** 实际渲染的相机数量受布局容量限制 */
  const tileCount = computed(() => Math.min(count.value, LAYOUT_CAPACITY[grid.layout]))
  const columns = computed(() => Number(grid.layout.split('x')[0]))

  const stats = computed(() => ({
    progress: currentProgress.value,
    speed: speedNow.value,
    reject: rejectCount.value,
    placed: 4820,
    total: 4820,
  }))

  function setCount(value: number) {
    countOverride.value = Math.min(9, Math.max(1, Math.round(value)))
  }

  let timer = 0
  let cursor = 0

  function tick() {
    const last = samples.value[samples.value.length - 1]
    const t = last ? last.t + 1 : 1
    const wave = Math.sin(t / 9) * 0.85 + Math.sin(t / 3.1) * 0.3
    const speed = Math.max(0.4, Number((8.4 + wave).toFixed(2)))
    const progress = Math.round(60 + Math.sin(t / 14) * 30 + 10)
    cursor += 1

    samples.value.push({
      t,
      progress,
      speed,
      reject: cursor % 7 === 0 ? 1 : 0,
    })

    // 仅保留窗口内的数据
    if (t > WINDOW_SECONDS) samples.value.shift()

    currentProgress.value = progress
    speedNow.value = speed
    if (cursor % 7 === 0) rejectCount.value += 1
  }

  function startLiveFeed() {
    if (timer) return
    timer = window.setInterval(tick, 1000)
  }

  function stopLiveFeed() {
    window.clearInterval(timer)
    timer = 0
  }

  return {
    samples,
    progress: currentProgress,
    speedNow,
    rejectCount,
    grid,
    count,
    tileCount,
    columns,
    stats,
    setCount,
    startLiveFeed,
    stopLiveFeed,
  }
})
