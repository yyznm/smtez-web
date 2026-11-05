import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { wsClient } from '@/api/ws-client'
import { useDatabaseStore } from '@/stores/database'
import type { DbBoard, DbPart } from '@/types/database'
import type { GridLayout, SpeedSample } from '@/types'

/** 曲线窗口（秒） */
export const WINDOW_SECONDS = 120

/** 宫格布局容量 */
export const LAYOUT_CAPACITY: Record<GridLayout, number> = {
  '1x1': 1,
  '2x2': 4,
  '3x3': 9,
}

/** Counter 事件类型 */
const COUNTER_START = 0
const COUNTER_PLACE = 1
const COUNTER_FAIL = 2

/** 速度取最近 N 个完成元件的间隔来算 */
const SPEED_SAMPLES = 10
/** 超过这个时间没有新元件，速度记为 0 */
const SPEED_IDLE_MS = 5000
/** 保留的完成时间戳上限，避免无限增长 */
const TIME_KEEP = 200

export const useOverviewStore = defineStore('overview', () => {
  const database = useDatabaseStore()

  /** 当前贴片周期内完成元件的时间戳（毫秒） */
  const placedTimes = ref<number[]>([])
  /** 当前周期失败元件数 */
  const rejected = ref(0)
  /** 曲线采样点，每秒一个 */
  const samples = ref<SpeedSample[]>([])
  const speedNow = ref(0)
  /** 当前贴片周期的起点 */
  let origin = Date.now()
  /** 上一秒的失败累计值，用于算每秒抛料柱 */
  let lastTickRejected = 0

  const grid = reactive({
    layout: '3x3' as GridLayout,
    zoom: 100,
  })

  const countOverride = ref<number | null>(null)

  /** 画面数量默认取数据库 /setting/infoImageCount */
  const infoImageCount = computed(() => database.getNumber('/setting/infoImageCount', 9))
  const count = computed(
    () => countOverride.value ?? Math.min(9, Math.max(1, Math.round(infoImageCount.value))),
  )

  /** 实际渲染的相机数量受布局容量限制 */
  const tileCount = computed(() => Math.min(count.value, LAYOUT_CAPACITY[grid.layout]))
  const columns = computed(() => Number(grid.layout.split('x')[0]))

  /** 计划贴装元件：启用板下的启用元件（不含基准点、隐藏项、与板面不同的元件） */
  const plannedParts = computed<DbPart[]>(() => {
    const boards = database.get<DbBoard[]>('/boards', [])
    const list: DbPart[] = []
    for (const board of boards) {
      if (!board.enable) continue
      for (const child of board.allchildparts ?? []) {
        for (const part of child.allparts ?? []) {
          if (part.PartType === 'Fiducial' || !part.enable || part.hide) continue
          if (board.Side && part.Side && part.Side !== board.Side) continue
          list.push(part)
        }
      }
    }
    return list
  })

  const total = computed(() => plannedParts.value.length)
  /** 已完成贴装的元件：status 为 done */
  const doneCount = computed(() => plannedParts.value.filter((part) => part.status === 'done').length)

  /** 进度：已完成贴装的元件 / 计划 */
  const currentProgress = computed(() =>
    total.value > 0 ? Math.min(100, Math.round((doneCount.value / total.value) * 100)) : 0,
  )

  const stats = computed(() => ({
    progress: currentProgress.value,
    speed: speedNow.value,
    reject: rejected.value,
    placed: doneCount.value,
    total: total.value,
  }))

  /** 用最近 N 个完成事件的到达间隔换算成每小时贴装点数 */
  function measureSpeed(): number {
    const times = placedTimes.value
    if (times.length < 2) return 0
    if (Date.now() - times[times.length - 1] > SPEED_IDLE_MS) return 0
    const recent = times.slice(-SPEED_SAMPLES)
    const span = recent[recent.length - 1] - recent[0]
    if (span <= 0) return 0
    return Math.round(((recent.length - 1) * 3600000) / span)
  }

  function handleCounter(type: number) {
    const now = Date.now()
    switch (type) {
      case COUNTER_START:
        origin = now
        rejected.value = 0
        placedTimes.value = []
        samples.value = []
        speedNow.value = 0
        lastTickRejected = 0
        break
      case COUNTER_PLACE:
        placedTimes.value.push(now)
        if (placedTimes.value.length > TIME_KEEP) placedTimes.value.shift()
        speedNow.value = measureSpeed()
        break
      case COUNTER_FAIL:
        rejected.value += 1
        break
      default:
        break
    }
  }

  wsClient.onMessage((message) => {
    if (message.event !== 'Counter') return
    const type = Number(message.type)
    if (Number.isFinite(type)) handleCounter(type)
  })

  function setCount(value: number) {
    countOverride.value = Math.min(9, Math.max(1, Math.round(value)))
  }

  let timer = 0

  function tick() {
    const now = Date.now()
    const t = Math.max(0, Math.round((now - origin) / 1000))
    speedNow.value = measureSpeed()
    const reject = Math.max(0, rejected.value - lastTickRejected)
    lastTickRejected = rejected.value

    samples.value.push({ t, progress: currentProgress.value, speed: speedNow.value, reject })
    while (samples.value.length && samples.value[0].t < t - WINDOW_SECONDS) samples.value.shift()
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
    rejectCount: rejected,
    doneCount,
    total,
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
