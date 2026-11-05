<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import JogPad from '@/components/JogPad.vue'
import SpeedRail from '@/components/SpeedRail.vue'
import StepRail from '@/components/StepRail.vue'
import { useCameraWindowStore } from '@/stores/camera-window'
import { useFeederStore, type FeederFilter, type FeederView } from '@/stores/feeder'
import { useMachineStore } from '@/stores/machine'
import { useNotifyStore } from '@/stores/notify'
import { usePlacementStore } from '@/stores/placement'
import type { DbFeederPoint, FeederType } from '@/types/database'

const feeder = useFeederStore()
const machine = useMachineStore()
const notify = useNotifyStore()
const placement = usePlacementStore()
const cameraWindow = useCameraWindowStore()

const FILTERS: { value: FeederFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'manualauto', label: '自动' },
  { value: 'loose', label: '散料' },
  { value: 'strip', label: '料带' },
  { value: 'tray', label: '托盘' },
]

const editing = ref(false)
const activeIndex = ref(-1)
const active = computed(() => feeder.feeders.find((item) => item.index === activeIndex.value) ?? null)

const isStrip = computed(() => active.value?.type === 'stripfeeder')
const isTray = computed(() => active.value?.type === 'trayfeeder')
const isAuto = computed(() => active.value?.type === 'manualautofeeder')
const isLoose = computed(() => active.value?.type === 'loosepartsfeeder')

/** 托盘飞达的三个定位角 */
const TRAY_POINTS = ['A', 'B', 'C'] as const

/** 料带 / 托盘上的全部取料点（一个点对应一个元件位） */
const points = computed<DbFeederPoint[]>(() => {
  const parts = active.value?.data?.parts as unknown
  if (!Array.isArray(parts) || !parts.length) return []
  const first = parts[0]
  // 料带是二维（parts[0] 为一条料带），托盘是平铺的一维数组
  return Array.isArray(first) ? (first as DbFeederPoint[]) : (parts as DbFeederPoint[])
})

/** 当前定位到的取料点下标 */
const locateIndex = ref(-1)

/** 编辑弹窗里展开的机器控制面板 */
const showMachine = ref(false)

/** 托盘坐标说明弹窗 */
const trayHelp = ref(false)

/** 量弹窗顶边：用高度算，避免受弹出动画的位移影响 */
function popupTop(): number | null {
  const popup = document.querySelector('.feeder-popup') as HTMLElement | null
  return popup ? window.innerHeight - popup.offsetHeight : null
}

/** 机器控制面板的固定高度（与 .machine-enter-to 的 max-height 一致） */
const MACHINE_PANEL_HEIGHT = 212

/** 悬浮视频窗最大档的高度（宽度 95% × 9/16），弹窗要给它的留出空间 */
const VIDEO_MAX_HEIGHT = Math.round(window.innerWidth * 0.95 * (9 / 16))
/** 弹窗最大高度：屏幕高度减去视频窗最大高度与上下间距 */
const popupMaxHeight = computed(() =>
  Math.max(260, Math.min(window.innerHeight * 0.86, window.innerHeight - VIDEO_MAX_HEIGHT - 5)),
)
/** 表单区高度：再减去标题栏（展开机器控制时还要减去控制面板） */
const bodyMaxHeight = computed(() =>
  Math.max(160, popupMaxHeight.value - 42 - (showMachine.value ? MACHINE_PANEL_HEIGHT : 0)),
)

/** 展开 / 收起机器控制：放大停靠，收起后回到展开前的位置 */
async function toggleMachine() {
  showMachine.value = !showMachine.value
  if (!showMachine.value) {
    cameraWindow.relax()
    return
  }
  // 面板高度固定，直接按「当前高度 + 面板高度」算出展开后的顶边，不等动画
  await nextTick()
  const popup = document.querySelector('.feeder-popup') as HTMLElement | null
  if (!popup) return
  cameraWindow.dock(window.innerHeight - (popup.offsetHeight + MACHINE_PANEL_HEIGHT))
}

/** 打开编辑弹窗：视频窗被挡住时自动飞到弹窗上方（不改变大小） */
watch(editing, async (open) => {
  if (!open) {
    showMachine.value = false
    trayHelp.value = false
    cameraWindow.undock()
    return
  }
  await nextTick()
  const top = popupTop()
  if (top !== null) cameraWindow.avoid(top)
})

// 切走页面时也释放，避免下次进来自动停靠
onBeforeUnmount(() => cameraWindow.undock())

/** 点击取料点：把相机（头部）移过去 */
function locatePoint(index: number) {
  const point = points.value[index]
  if (!point) return
  locateIndex.value = index
  machine.headTo(point.x, point.y)
}

/** 料带已使用比例，用于进度条 */
const usedPercent = computed(() => {
  const item = active.value
  if (!item || !item.holes) return 0
  return Math.min(100, Math.round((item.used / item.holes) * 100))
})

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** 读飞达 data 里的数值字段 */
function field(key: string): number {
  const value = Number(active.value?.data?.[key])
  return Number.isFinite(value) ? value : 0
}

function format(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function openEditor(item: FeederView) {
  activeIndex.value = item.index
  locateIndex.value = -1
  // 每次打开都收起机器控制
  showMachine.value = false
  cameraWindow.undock()
  editing.value = true
}

function typeTone(item: FeederView): string {
  if (item.type === 'manualautofeeder') return 'is-accent'
  if (item.type === 'stripfeeder' || item.type === 'trayfeeder') return 'is-info'
  return ''
}

/** 当前贴装板是否用到这个飞达：元件与封装同时匹配 */
function usedByBoard(item: FeederView): boolean {
  if (!item.value) return false
  return placement.usedFeederKeys.has(`${item.value.trim()}=${item.package.trim()}`)
}

/** 只显示当前贴装板用到的飞达 */
const onlyBoard = ref(false)

const rows = computed(() =>
  onlyBoard.value ? feeder.visibleFeeders.filter((item) => usedByBoard(item)) : feeder.visibleFeeders,
)

/* ---------------- 新增飞达 ---------------- */

const CREATE_TYPES: { value: FeederType; label: string }[] = [
  { value: 'stripfeeder', label: '料带' },
  { value: 'manualautofeeder', label: '自动' },
  { value: 'trayfeeder', label: '托盘' },
  { value: 'loosepartsfeeder', label: '散料' },
]

const creating = ref(false)

function openCreator() {
  creating.value = true
}

/** 只选类型就新增一台空飞达，等机器下发 database 事件后再打开编辑弹窗 */
function createFeeder(type: FeederType) {
  const before = feeder.feeders.length
  creating.value = false
  if (!feeder.addFeeder(type, '', '')) {
    notify.push('未连接机器，无法新增飞达', 'warn')
    return
  }
  const stop = watch(
    () => feeder.feeders.length,
    (length) => {
      if (length <= before) return
      stop()
      window.clearTimeout(timer)
      feeder.filter = 'all'
      feeder.query = ''
      notify.push('已新增飞达', 'ok', 2)
      const item = feeder.feeders[feeder.feeders.length - 1]
      if (item) openEditor(item)
    },
  )
  const timer = window.setTimeout(stop, 5000)
}

/* ---------------- 从贴装选元件 ---------------- */

const picking = ref(false)
const pickQuery = ref('')

/** 贴装列表里的元件去重，按使用数量排序 */
const pickOptions = computed(() => {
  const keyword = pickQuery.value.trim().toLowerCase()
  const map = new Map<string, { value: string; package: string; count: number }>()
  for (const part of placement.parts) {
    if (part.kind !== 'part') continue
    const key = `${part.value}|${part.package}`
    const item = map.get(key)
    if (item) item.count += 1
    else map.set(key, { value: part.value, package: part.package, count: 1 })
  }
  return [...map.values()]
    .filter((item) => !keyword || `${item.value} ${item.package}`.toLowerCase().includes(keyword))
    .sort((a, b) => b.count - a.count)
})

function openPicker() {
  pickQuery.value = ''
  picking.value = true
}

/** 选中后同时写入元件和封装 */
function pickPart(option: { value: string; package: string }) {
  const item = active.value
  if (!item) return
  feeder.setPart(item.index, option.value, option.package)
  picking.value = false
}

/* ---------------- 表单写回 ---------------- */

function commitNumber(key: string, event: Event) {
  const item = active.value
  if (!item) return
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) return
  feeder.setData(item.index, { [key]: round3(value) })
}

function commitText(field: 'value' | 'package', event: Event) {
  const item = active.value
  if (!item) return
  const raw = (event.target as HTMLInputElement).value.trim()
  if (field === 'value') feeder.setPart(item.index, raw, item.package)
  else feeder.setPart(item.index, item.value, raw)
}

/* ---------------- 坐标取点 / 移动 ---------------- */

/** 取当前坐标写入坐标A / 坐标B / 坐标C：camera 取相机，nozzle 取吸嘴 */
function teach(point: 'A' | 'B' | 'C', source: 'camera' | 'nozzle') {
  const item = active.value
  if (!item) return
  const position = source === 'camera' ? feeder.cameraPoint() : feeder.nozzlePoint()
  if (!position) {
    notify.push('还没有收到机器位置', 'warn')
    return
  }
  const prefix = pointPrefix(point)
  feeder.setData(item.index, {
    [`${prefix}_x`]: round3(position.x),
    [`${prefix}_y`]: round3(position.y),
  })
  notify.push(`已取坐标${point}`, 'ok', 2)
}

/** 坐标点在 data 里的前缀：料带 A/B，托盘 A/B/C */
function pointPrefix(point: 'A' | 'B' | 'C'): string {
  if (isTray.value) return `pos_${point === 'A' ? 1 : point === 'B' ? 2 : 3}`
  return point === 'A' ? 'tmp_pos0_1' : 'tmp_pos0_2'
}

/** 高度字段名（托盘与料带不同） */
const heightKey = computed(() => {
  if (isTray.value) return 'part_z'
  if (isLoose.value) return 'feederz'
  return 'part_0_z'
})

/** 取当前吸嘴高度写入高度 */
function teachHeight() {
  const item = active.value
  if (!item) return
  const z = machine.pos[machine.activeZ]
  if (z === null) {
    notify.push('还没有收到吸嘴高度', 'warn')
    return
  }
  feeder.setData(item.index, { [heightKey.value]: round3(z) })
  notify.push('已取当前高度', 'ok', 2)
}

/** 移动相机（头部）到坐标A / 坐标B / 坐标C */
function moveCamera(point: 'A' | 'B' | 'C') {
  if (!active.value) return
  const prefix = pointPrefix(point)
  feeder.moveCameraTo(field(`${prefix}_x`), field(`${prefix}_y`))
}

/** 移动吸嘴到坐标A / 坐标B / 坐标C */
function moveNozzle(point: 'A' | 'B' | 'C') {
  if (!active.value) return
  const prefix = pointPrefix(point)
  feeder.moveNozzleTo(field(`${prefix}_x`), field(`${prefix}_y`))
}

/** 移动吸嘴到设定高度 */
function moveHeight() {
  if (!active.value) return
  feeder.moveNozzleZ(field(heightKey.value))
}

/* ---------------- 散料飞达的中心 / 识别区域 ---------------- */

/** 散料飞达的中心、识别区域、元件角度都存在 pos 里 */
function loosePoint(key: 'x' | 'y' | 'w' | 'h' | 'pr'): number {
  return Number(active.value?.data?.pos?.[key]) || 0
}

function commitLoose(key: 'x' | 'y' | 'w' | 'h' | 'pr', event: Event) {
  const item = active.value
  if (!item) return
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) return
  const patch: Partial<DbFeederPoint> = {}
  patch[key] = round3(value)
  feeder.setLoosePoint(item.index, patch)
}

/** 取当前相机坐标写入中心（散料飞达以相机位置取点） */
function teachCenter() {
  const item = active.value
  if (!item) return
  const position = feeder.cameraPoint()
  if (!position) {
    notify.push('还没有收到机器位置', 'warn')
    return
  }
  feeder.setLoosePoint(item.index, { x: round3(position.x), y: round3(position.y) })
  notify.push('已取当前坐标', 'ok', 2)
}

/** 移动相机到中心坐标 */
function moveCenter() {
  if (!active.value) return
  feeder.moveCameraTo(loosePoint('x'), loosePoint('y'))
}

/* ---------------- 自动飞达的元件坐标 ---------------- */

/** 取当前坐标写入自动飞达的元件坐标 */
function teachAuto(source: 'camera' | 'nozzle') {
  const item = active.value
  if (!item) return
  const position = source === 'camera' ? feeder.cameraPoint() : feeder.nozzlePoint()
  if (!position) {
    notify.push('还没有收到机器位置', 'warn')
    return
  }
  feeder.setAutoPosition(item.index, { x: round3(position.x), y: round3(position.y) })
  notify.push('已取当前坐标', 'ok', 2)
}

/** 自动飞达元件坐标（pos_0） */
function autoPoint(axis: 'x' | 'y' | 'z'): number {
  return Number(active.value?.data?.pos_0?.[axis]) || 0
}

function commitAuto(axis: 'x' | 'y' | 'z', event: Event) {
  const item = active.value
  if (!item) return
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) return
  feeder.setAutoPosition(item.index, { [axis]: round3(value) })
}

function moveAutoCamera() {
  feeder.moveCameraTo(autoPoint('x'), autoPoint('y'))
}

function moveAutoNozzle() {
  feeder.moveNozzleTo(autoPoint('x'), autoPoint('y'))
}

/** 取当前吸嘴高度写入自动飞达的 Z */
function teachAutoHeight() {
  const item = active.value
  if (!item) return
  const z = machine.pos[machine.activeZ]
  if (z === null) {
    notify.push('还没有收到吸嘴高度', 'warn')
    return
  }
  feeder.setAutoPosition(item.index, { z: round3(z) })
  notify.push('已取当前高度', 'ok', 2)
}

/** 移动吸嘴到自动飞达的 Z */
function moveAutoHeight() {
  feeder.moveNozzleZ(autoPoint('z'))
}

/** 飞达角度存在 pos.r 里 */
function commitFeederAngle(event: Event) {
  const item = active.value
  if (!item) return
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) return
  feeder.setFeederAngle(item.index, round3(value))
}
</script>

<template>
  <div class="page">
    <div class="page-body">
      <section class="panel">
        <div class="panel-head">
          <span class="panel-title">飞达</span>
          <span class="panel-sub">{{ feeder.stats.total }} 台</span>
          <span class="topbar-spacer" />
          <button class="add-btn" title="新增飞达" @click="openCreator">
            <AppIcon name="plus" :size="14" />
            新增飞达
          </button>
          <span class="chip is-ok">{{ feeder.stats.enabled }} 启用</span>
          <span v-if="feeder.stats.usedUp" class="chip is-danger">{{ feeder.stats.usedUp }} 已用完</span>
        </div>

        <div class="toolbar">
          <div class="seg">
            <button
              v-for="item in FILTERS"
              :key="item.value"
              class="seg-item"
              :class="{ 'is-active': feeder.filter === item.value }"
              @click="feeder.filter = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <div class="search-row">
          <div class="search">
            <AppIcon name="search" :size="16" />
            <input v-model="feeder.query" type="search" placeholder="搜索元件 / 封装 / 编号" />
          </div>
          <label class="board-toggle" title="只显示当前贴装板用到的飞达">
            <van-checkbox v-model="onlyBoard" shape="square" icon-size="16" />
            <span>本板</span>
          </label>
        </div>

        <ul class="feeder-list">
          <li
            v-for="item in rows"
            :key="item.path"
            class="feeder"
            :class="{ 'is-used-up': item.usedUp, 'is-off': !item.enable, 'is-board': usedByBoard(item) }"
            @click="openEditor(item)"
          >
            <span class="feeder-check" @click.stop>
              <van-switch
                :model-value="item.enable"
                size="18"
                @update:model-value="feeder.setEnabled(item.index, Boolean($event))"
              />
            </span>

            <div class="feeder-main">
              <div class="feeder-line">
                <b class="feeder-part">{{ item.value || '—' }}</b>
                <span class="chip" :class="typeTone(item)">{{ item.typeLabel }}</span>
                <span v-if="item.usedUp" class="chip is-danger">已用完</span>
                <span v-else-if="item.low" class="chip is-warn">将用完</span>
                <span v-if="item.name" class="feeder-name num">{{ item.name }}</span>
              </div>
              <div class="feeder-line feeder-params">
                <span v-if="item.package" class="num">{{ item.package }}</span>
                <span v-if="item.type === 'stripfeeder'" class="num">
                  已用 {{ item.used }} / {{ item.holes }}
                </span>
                <span v-else class="num">已用 {{ item.used }}</span>
                <span v-if="item.label">{{ item.label }}</span>
              </div>
            </div>

            <AppIcon name="arrow-right" :size="15" class="feeder-arrow" />
          </li>
          <li v-if="!rows.length" class="list-empty">没有匹配的飞达</li>
        </ul>
      </section>
    </div>

    <!-- 飞达编辑 -->
    <van-popup
      v-model:show="editing"
      position="bottom"
      round
      :style="{ maxHeight: `${popupMaxHeight}px` }"
      class="feeder-popup"
    >
      <template v-if="active">
        <!-- 机器控制：放在标题栏上方，点动 + 步进 / 速度 -->
        <Transition name="machine">
          <div v-if="showMachine" class="machine-panel">
            <div class="machine-layout">
              <JogPad />
              <div class="machine-rails">
                <StepRail :model-value="machine.step" @update:model-value="machine.setStepValue" />
                <SpeedRail :model-value="machine.speed" @update:model-value="machine.setSpeed" />
              </div>
            </div>
          </div>
        </Transition>

        <div class="panel-head">
          <!-- <span class="panel-title">编辑飞达</span> -->
          <span class="panel-title">{{ active.value || '未命名' }}</span>
          <span class="panel-sub">{{ active.typeLabel }}</span>
          <van-switch
            :model-value="active.enable"
            size="20"
            @update:model-value="feeder.setEnabled(active.index, Boolean($event))"
          />
          <span class="topbar-spacer" />
          <button v-if="isTray" class="help-btn" title="坐标说明" @click="trayHelp = true">
            ABC
          </button>
          <button
            class="machine-toggle"
            :class="{ 'is-active': showMachine }"
            @click="toggleMachine"
          >
            <AppIcon name="sliders" :size="15" />
            <span>控制</span>
          </button>
          <button class="close-btn" title="关闭" @click="editing = false">
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <div class="sheet-body" :style="{ maxHeight: `${bodyMaxHeight}px` }">
          <!-- 料带飞达：完整参数 -->
          <template v-if="isStrip">
            <div class="row is-split">
              <div class="field">
                <span class="row-label">元件</span>
                <input class="input" :value="active.value" @change="commitText('value', $event)" />
                <button class="pt-btn is-pick" title="从贴装选择元件" @click="openPicker">
                  <AppIcon name="list" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">封装</span>
                <input class="input" :value="active.package" @change="commitText('package', $event)" />
              </div>
            </div>

            <p class="tip">绿色取当前相机坐标，红色把相机 / 吸嘴移动到该坐标</p>

            <div class="coord-row">
              <span class="row-label">坐标A</span>
              <span class="axis">
                <i>X</i>
                <input
                  class="input is-num num"
                  :value="format(field('tmp_pos0_1_x'))"
                  @change="commitNumber('tmp_pos0_1_x', $event)"
                />
              </span>
              <span class="axis">
                <i>Y</i>
                <input
                  class="input is-num num"
                  :value="format(field('tmp_pos0_1_y'))"
                  @change="commitNumber('tmp_pos0_1_y', $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前相机坐标" @click="teach('A', 'camera')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <!-- <button class="pt-btn is-get" title="获取当前吸嘴坐标" @click="teach('A', 'nozzle')">
                  <AppIcon name="nozzle" :size="15" />
                </button> -->
                <button class="pt-btn is-move" title="移动相机到坐标" @click="moveCamera('A')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到坐标" @click="moveNozzle('A')">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="coord-row">
              <span class="row-label">坐标B</span>
              <span class="axis">
                <i>X</i>
                <input
                  class="input is-num num"
                  :value="format(field('tmp_pos0_2_x'))"
                  @change="commitNumber('tmp_pos0_2_x', $event)"
                />
              </span>
              <span class="axis">
                <i>Y</i>
                <input
                  class="input is-num num"
                  :value="format(field('tmp_pos0_2_y'))"
                  @change="commitNumber('tmp_pos0_2_y', $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前相机坐标" @click="teach('B', 'camera')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <!-- <button class="pt-btn is-get" title="获取当前吸嘴坐标" @click="teach('B', 'nozzle')">
                  <AppIcon name="nozzle" :size="15" />
                </button> -->
                <button class="pt-btn is-move" title="移动相机到坐标" @click="moveCamera('B')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到坐标" @click="moveNozzle('B')">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="coord-row">
              <span class="row-label">高度</span>
              <span class="axis">
                <i>Z</i>
                <input
                  class="input is-num num"
                  :value="format(field('part_0_z'))"
                  @change="commitNumber('part_0_z', $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前吸嘴高度" @click="teachHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到该高度" @click="moveHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">间距</span>
                <input
                  class="input is-num num"
                  :value="format(field('part_0_dis'))"
                  @change="commitNumber('part_0_dis', $event)"
                />
              </div>
              <div class="field">
                <span class="row-label">角度</span>
                <input
                  class="input is-num num"
                  :value="format(field('part_0_r'))"
                  @change="commitNumber('part_0_r', $event)"
                />
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">已使用</span>
                <input
                  class="input is-num num"
                  :value="format(active.used)"
                  @change="commitNumber('usecount_0', $event)"
                />
                <button class="pt-btn is-reset" title="已使用清零" @click="feeder.resetUsed(active.index)">
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">最大数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('count_0'))"
                  @change="commitNumber('count_0', $event)"
                />
              </div>
            </div>

            <div class="row">
              <span class="row-label">禁用预取</span>
              <van-switch
                :model-value="Boolean(active.data.disablePreTake)"
                size="20"
                @update:model-value="feeder.setData(active.index, { disablePreTake: Boolean($event) })"
              />
            </div>

            <p v-if="active.usedUp" class="tip is-danger">这条料带已经用完，请更换料带后再清零已使用。</p>

            <!-- 取料点：一个格子对应一个元件位，点击把相机移过去 -->
            <div v-if="points.length" class="parts-block">
              <div class="parts-head">
                <span class="row-label">取料点</span>
                <div class="usage-bar">
                  <i
                    :class="{ 'is-danger': active.usedUp, 'is-warn': active.low }"
                    :style="{ width: `${usedPercent}%` }"
                  />
                </div>
                <span class="parts-count num">共 {{ points.length }} 个 · 已用 {{ active.used }}</span>
              </div>
              <div class="parts-rail">
                <button
                  v-for="(_, index) in points"
                  :key="index"
                  class="part-cell num"
                  :class="{
                    'is-used': index < active.used,
                    'is-locate': index === locateIndex,
                  }"
                  @click="locatePoint(index)"
                >
                  {{ index + 1 }}
                </button>
              </div>
            </div>
          </template>

          <!-- 托盘飞达：A / B / C 三点 + XY 数量 -->
          <template v-else-if="isTray">
            <div class="row is-split">
              <div class="field">
                <span class="row-label">元件</span>
                <input class="input" :value="active.value" @change="commitText('value', $event)" />
                <button class="pt-btn is-pick" title="从贴装选择元件" @click="openPicker">
                  <AppIcon name="list" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">封装</span>
                <input class="input" :value="active.package" @change="commitText('package', $event)" />
              </div>
            </div>

            <p class="tip">绿色取当前相机坐标，红色把相机 / 吸嘴移动到该坐标</p>
            <div v-for="point in TRAY_POINTS" :key="point" class="coord-row">
              <span class="row-label">坐标{{ point }}</span>
              <span class="axis">
                <i>X</i>
                <input
                  class="input is-num num"
                  :value="format(field(`${pointPrefix(point)}_x`))"
                  @change="commitNumber(`${pointPrefix(point)}_x`, $event)"
                />
              </span>
              <span class="axis">
                <i>Y</i>
                <input
                  class="input is-num num"
                  :value="format(field(`${pointPrefix(point)}_y`))"
                  @change="commitNumber(`${pointPrefix(point)}_y`, $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前相机坐标" @click="teach(point, 'camera')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <!-- <button class="pt-btn is-get" title="获取当前吸嘴坐标" @click="teach(point, 'nozzle')">
                  <AppIcon name="nozzle" :size="15" />
                </button> -->
                <button class="pt-btn is-move" title="移动相机到坐标" @click="moveCamera(point)">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到坐标" @click="moveNozzle(point)">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split3">
              <div class="field">
                <span class="row-label">角度</span>
                <input
                  class="input is-num num"
                  :value="format(field('part_r'))"
                  @change="commitNumber('part_r', $event)"
                />
                </div>
                <div class="field">
                <span class="row-label">高度</span>
                <span class="axis">
                  <i>Z</i>
                  <input
                    class="input is-num num"
                    :value="format(field('part_z'))"
                    @change="commitNumber('part_z', $event)"
                  />
                </span>
              </div>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前吸嘴高度" @click="teachHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到该高度" @click="moveHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">X 数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('count_x'))"
                  @change="commitNumber('count_x', $event)"
                />
              </div>
              <div class="field">
                <span class="row-label">Y 数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('count_y'))"
                  @change="commitNumber('count_y', $event)"
                />
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">已使用</span>
                <input
                  class="input is-num num"
                  :value="format(active.used)"
                  @change="commitNumber('usecount', $event)"
                />
                <button class="pt-btn is-reset" title="已使用清零" @click="feeder.resetUsed(active.index)">
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">最大数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('partcount'))"
                  @change="commitNumber('partcount', $event)"
                />
              </div>
            </div>

            <p v-if="active.usedUp" class="tip is-danger">这一盘已经用完，请更换托盘后再清零已使用。</p>

            <!-- 取料点：一个格子对应一个元件位，点击把相机移过去 -->
            <div v-if="points.length" class="parts-block">
              <div class="parts-head">
                <span class="row-label">取料点</span>
                <div class="usage-bar">
                  <i
                    :class="{ 'is-danger': active.usedUp, 'is-warn': active.low }"
                    :style="{ width: `${usedPercent}%` }"
                  />
                </div>
                <span class="parts-count num">共 {{ points.length }} 个 · 已用 {{ active.used }}</span>
              </div>
              <div class="parts-rail">
                <button
                  v-for="(_, index) in points"
                  :key="index"
                  class="part-cell num"
                  :class="{
                    'is-used': index < active.used,
                    'is-locate': index === locateIndex,
                  }"
                  @click="locatePoint(index)"
                >
                  {{ index + 1 }}
                </button>
              </div>
            </div>
          </template>

          <!-- 自动飞达：元件坐标 + 参数 + 前进 / 后退 -->
          <template v-else-if="isAuto">
            <div class="row is-split3">
              <div class="field">
                <span class="row-label">元件</span>
                <input class="input" :value="active.value" @change="commitText('value', $event)" />
              </div>
              <div class="field">
                <span class="row-label">封装</span>
                <input class="input" :value="active.package" @change="commitText('package', $event)" />
              </div>
              <div class="coord-actions">
                <button class="pt-btn is-pick" title="从贴装选择元件" @click="openPicker">
                  <AppIcon name="list" :size="15" />
                </button>
              </div>
            </div>
            <p class="tip">绿色取当前相机坐标，红色把相机 / 吸嘴移动到该坐标</p>

            <div class="coord-row">
              <span class="row-label">元件</span>
              <span class="axis">
                <i>X</i>
                <input
                  class="input is-num num"
                  :value="format(autoPoint('x'))"
                  @change="commitAuto('x', $event)"
                />
              </span>
              <span class="axis">
                <i>Y</i>
                <input
                  class="input is-num num"
                  :value="format(autoPoint('y'))"
                  @change="commitAuto('y', $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前相机坐标" @click="teachAuto('camera')">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <!-- <button class="pt-btn is-get" title="获取当前吸嘴坐标" @click="teachAuto('nozzle')">
                  <AppIcon name="nozzle" :size="15" />
                </button> -->
                <button class="pt-btn is-move" title="移动相机到坐标" @click="moveAutoCamera">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到坐标" @click="moveAutoNozzle">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="coord-row">
              <span class="row-label">高度</span>
              <span class="axis">
                <i>Z</i>
                <input
                  class="input is-num num"
                  :value="format(autoPoint('z'))"
                  @change="commitAuto('z', $event)"
                />
              </span>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前吸嘴高度" @click="teachAutoHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到该高度" @click="moveAutoHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">间距</span>
                <input
                  class="input is-num num"
                  :value="format(field('part_0_dis'))"
                  @change="commitNumber('part_0_dis', $event)"
                />
              </div>
              <div class="field">
                <span class="row-label">角度</span>
                <input
                  class="input is-num num"
                  :value="format(field('part_0_r'))"
                  @change="commitNumber('part_0_r', $event)"
                />
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">已使用</span>
                <input
                  class="input is-num num"
                  :value="format(active.used)"
                  @change="commitNumber('usecount_0', $event)"
                />
                <button class="pt-btn is-reset" title="已使用清零" @click="feeder.resetUsed(active.index)">
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">最大数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('count_0'))"
                  @change="commitNumber('count_0', $event)"
                />
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">飞达id</span>
                <input
                  class="input is-num num"
                  :value="format(field('feederid'))"
                  @change="commitNumber('feederid', $event)"
                />
              </div>
              <div class="field">
                <span class="row-label">飞达角度</span>
                <input
                  class="input is-num num"
                  :value="format(Number(active.data.pos?.r) || 0)"
                  @change="commitFeederAngle($event)"
                />
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">最小拾取间隔</span>
                <input
                  class="input is-num num"
                  :value="format(field('minwaittime'))"
                  @change="commitNumber('minwaittime', $event)"
                />
                <span class="row-unit">ms</span>
              </div>
              <div class="field">
                <span class="row-label">禁用预取</span>
                <van-switch
                  :model-value="Boolean(active.data.disablePreTake)"
                  size="20"
                  @update:model-value="feeder.setData(active.index, { disablePreTake: Boolean($event) })"
                />
              </div>
            </div>

            <span class="row-label">飞达控制</span>
            <div class="feed-actions">
              <button class="feed-btn" @click="feeder.feed(active, -1)">
                <AppIcon name="arrow-left" :size="18" />
                <span>后退</span>
              </button>
              <button class="feed-btn" @click="feeder.feed(active, 1)">
                <AppIcon name="arrow-right" :size="18" />
                <span>前进</span>
              </button>
            </div>
            <p class="tip is-warn">注意：后退会一直退，触发一下前进才会停止。(为什么呢，问问瀚海吧(/▽＼))</p>
          </template>

          <!-- 散料飞达：中心 + 识别区域 + 灯光 -->
          <template v-else-if="isLoose">
            <div class="row is-split3">
              <div class="field">
                <span class="row-label">元件</span>
                <input class="input" :value="active.value" @change="commitText('value', $event)" />
              </div>
              <div class="field">
                <span class="row-label">封装</span>
                <input class="input" :value="active.package" @change="commitText('package', $event)" />
              </div>
              
              <div class="coord-actions">
                <button class="pt-btn is-pick" title="从贴装选择元件" @click="openPicker">
                  <AppIcon name="list" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split3">
              <div class="field">
                <span class="row-label">中心</span>
                <span class="axis">
                  <i>X</i>
                  <input
                    class="input is-num num"
                    :value="format(loosePoint('x'))"
                    @change="commitLoose('x', $event)"
                  />
                </span>
              </div>
              <div class="field">
                <span class="axis">
                  <i>Y</i>
                  <input
                    class="input is-num num"
                    :value="format(loosePoint('y'))"
                    @change="commitLoose('y', $event)"
                  />
                </span>
              </div>
              
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前相机坐标" @click="teachCenter">
                  <AppIcon name="crosshair" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动相机到该坐标" @click="moveCenter">
                  <AppIcon name="crosshair" :size="15" />
                </button>
              </div>
            </div>
            <div class="row is-split3">
              <div class="field">
                <span class="row-label">元件角度</span>
                <span class="axis">
                  <i>R</i>
                  <input
                    class="input is-num num"
                    :value="format(loosePoint('pr'))"
                    @change="commitLoose('pr', $event)"
                  />
                </span>
              </div>
              <div class="field">
                <span class="row-label">平台高度</span>
                <span class="axis">
                  <i>Z</i>
                  <input
                    class="input is-num num"
                    :value="format(field('feederz'))"
                    @change="commitNumber('feederz', $event)"
                  />
                </span>
              </div>
              <div class="coord-actions">
                <button class="pt-btn is-get" title="获取当前吸嘴高度" @click="teachHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
                <button class="pt-btn is-move" title="移动吸嘴到该高度" @click="moveHeight">
                  <AppIcon name="nozzle" :size="15" />
                </button>
              </div>
            </div>

            <div class="row is-split">
              <div class="field">
                <span class="row-label">识别区域</span>
                <span class="axis">
                  <i>宽</i>
                  <input
                    class="input is-num num"
                    :value="format(loosePoint('w'))"
                    @change="commitLoose('w', $event)"
                  />
                </span>
              </div>
              <div class="field">
                <span class="axis">
                  <i>长</i>
                  <input
                    class="input is-num num"
                    :value="format(loosePoint('h'))"
                    @change="commitLoose('h', $event)"
                  />
                </span>
              </div>
            </div>


            <div class="row is-split">
              <div class="field">
                <span class="row-label">已使用</span>
                <input
                  class="input is-num num"
                  :value="format(active.used)"
                  @change="commitNumber('usecount_0', $event)"
                />
                <button class="pt-btn is-reset" title="已使用清零" @click="feeder.resetUsed(active.index)">
                  <AppIcon name="trash" :size="15" />
                </button>
              </div>
              <div class="field">
                <span class="row-label">最大数量</span>
                <input
                  class="input is-num num"
                  :value="format(field('count_0'))"
                  @change="commitNumber('count_0', $event)"
                />
              </div>
            </div>

            <div class="row">
                <span class="row-label">启用上视觉灯光</span>
                <van-switch
                  :model-value="Boolean(active.data.enableUpLight)"
                  size="20"
                  @update:model-value="feeder.setData(active.index, { enableUpLight: Boolean($event) })"
                />
            </div>
            <div class="row">
                <span class="row-label">启用背光</span>
                <van-switch
                  :model-value="Boolean(active.data.enableBacklight)"
                  size="20"
                  @update:model-value="feeder.setData(active.index, { enableBacklight: Boolean($event) })"
                />
            </div>

            <div class="row">
              <span class="row-label">禁用预取</span>
              <van-switch
                :model-value="Boolean(active.data.disablePreTake)"
                size="20"
                @update:model-value="feeder.setData(active.index, { disablePreTake: Boolean($event) })"
              />
            </div>
          </template>
        </div>
      </template>
    </van-popup>

    <!-- 托盘坐标说明 -->
    <van-popup v-model:show="trayHelp" round :z-index="2600" class="help-popup">
      <div class="panel-head">
        <span class="panel-title">托盘坐标</span>
        <span class="topbar-spacer" />
        <button class="close-btn" title="关闭" @click="trayHelp = false">
          <AppIcon name="close" :size="16" />
        </button>
      </div>
      <div class="help-body">
        <div class="tray-figure">
          <svg viewBox="0 0 220 140" role="img" aria-label="托盘坐标示意图">
            <rect class="tray-outline" x="8" y="8" width="204" height="124" rx="12" />
            <g class="tray-box">
              <rect x="22" y="20" width="30" height="28" rx="6" />
              <text x="37" y="39">A</text>
              <rect x="168" y="20" width="30" height="28" rx="6" />
              <text x="183" y="39">B</text>
              <rect x="168" y="88" width="30" height="28" rx="6" />
              <text x="183" y="107">C</text>
              <rect x="22" y="88" width="30" height="28" rx="6" />
            </g>
            <g class="tray-dim">
              <path d="M37 52v32" />
              <path d="M32 57l5-5 5 5" />
              <path d="M32 79l5 5 5-5" />
              <text x="46" y="72">Y</text>
            </g>
            <g class="tray-dim">
              <path d="M60 102h100" />
              <path d="M65 97l-5 5 5 5" />
              <path d="M155 97l5 5-5 5" />
              <text x="110" y="96">X</text>
            </g>
          </svg>
        </div>
        <ul class="help-list">
          <li>坐标A 为左上角元件，坐标B 为右上角</li>
          <li>坐标C 为右下角，左下角由 A + C − B 推出</li>
          <li>X 数量沿 A→B 排列，Y 数量沿 A→左下角排列</li>
        </ul>
      </div>
    </van-popup>

    <!-- 从贴装选择元件：选中后同时填元件和封装 -->
    <van-popup
      v-model:show="picking"
      position="bottom"
      round
      :z-index="2600"
      :style="{ maxHeight: '72%' }"
      class="pick-popup"
    >
      <div class="panel-head">
        <span class="panel-title">选择元件</span>
        <span class="panel-sub">{{ pickOptions.length }} 个</span>
        <span class="topbar-spacer" />
        <button class="close-btn" title="关闭" @click="picking = false">
          <AppIcon name="close" :size="16" />
        </button>
      </div>

      <div class="search">
        <AppIcon name="search" :size="16" />
        <input v-model="pickQuery" type="search" placeholder="搜索元件 / 封装" />
      </div>

      <ul v-if="pickOptions.length" class="pick-list">
        <li v-for="option in pickOptions" :key="`${option.value}|${option.package}`">
          <button class="pick-item" @click="pickPart(option)">
            <span class="pick-value">{{ option.value || '—' }}</span>
            <span class="pick-package num">{{ option.package || '—' }}</span>
            <span class="pick-count num">×{{ option.count }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="tip">贴装列表里没有可选元件。</p>
    </van-popup>

    <!-- 新增飞达：居中弹窗，只选类型 -->
    <van-popup v-model:show="creating" round :z-index="2600" class="create-dialog">
      <div class="create-head">
        <span class="panel-title">新增飞达</span>
        <span class="topbar-spacer" />
        <button class="close-btn" title="关闭" @click="creating = false">
          <AppIcon name="close" :size="16" />
        </button>
      </div>
      <p class="create-tip">选择飞达类型，元件 / 封装和坐标稍后在编辑弹窗里填</p>
      <div class="create-types">
        <button
          v-for="type in CREATE_TYPES"
          :key="type.value"
          class="create-type"
          @click="createFeeder(type.value)"
        >
          {{ type.label }}
        </button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
.toolbar {
  padding: 10px 12px 0;
}

.search {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 0;
  padding: 0 10px;
  height: 36px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text-3);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: none;
  color: var(--text);
  font-size: 13px;
}

.search input::placeholder {
  color: var(--text-3);
}

/* 搜索框 + 「本板」筛选 */
.search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 12px 0;
}

.search-row .search {
  flex: 1;
  min-width: 0;
  margin: 0;
}

.board-toggle {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

/* 标题栏的新增飞达按钮 */
.add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  /* width: 26px; */
  height: 26px;
  padding: 0 8px;
  font-size: 10px;
  gap: 3px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
}

.add-btn:active {
  color: var(--accent);
  border-color: var(--accent-line);
}

/* ---------- 新增飞达（居中弹窗，只选类型） ---------- */

.create-dialog {
  width: 280px;
  padding: 14px;
  border-radius: var(--r-md);
  background: var(--surface);
}

.create-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.create-head .panel-title {
  flex: none;
  font-size: 14px;
  font-weight: 600;
}

.create-tip {
  margin: 8px 0 12px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.create-types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.create-type {
  height: 44px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--text);
  font-size: 13px;
}

.create-type:active {
  border-color: var(--accent-line);
  color: var(--accent);
}

/* ---------- 从贴装选元件 ---------- */

.pick-popup {
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

.pick-list {
  list-style: none;
  margin: 10px 12px 14px;
  padding: 0;
  border-top: 1px solid var(--line);
}

.pick-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.pick-item:active {
  background: var(--surface-2);
}

.pick-value {
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-package {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.pick-count {
  flex: none;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
}

.pick-popup .tip {
  margin: 14px;
}

/* ---------- 托盘示意图 ---------- */

.tray-figure {
  margin: 2px 0 12px;
}

.tray-figure svg {
  display: block;
  width: 100%;
  max-width: 230px;
  height: auto;
  margin: 0 auto;
}

.tray-outline {
  fill: none;
  stroke: var(--line-2);
  stroke-width: 2;
}

.tray-box rect {
  fill: var(--surface-2);
  stroke: var(--line-2);
  stroke-width: 2;
}

.tray-box text {
  fill: var(--text);
  font-size: 15px;
  font-weight: 600;
  text-anchor: middle;
}

.tray-dim path {
  fill: none;
  stroke: var(--ok);
  stroke-width: 2;
  stroke-linecap: round;
}

.tray-dim text {
  fill: var(--ok);
  font-size: 13px;
  font-weight: 600;
  text-anchor: middle;
}

/* ---------- 托盘坐标说明弹窗 ---------- */

.help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 26px;
  gap: 2px;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--text-3);
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.help-btn:active {
  color: var(--text);
  background: var(--surface-3);
}

.help-popup {
  width: min(320px, 86vw);
  overflow: hidden;
}

.help-body {
  padding: 12px 14px 16px;
}

.help-body .tray-figure {
  margin: 0 0 10px;
}

.help-list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-3);
}

/* ---------- 列表 ---------- */

.feeder-list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.feeder {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line);
  transition: background 0.15s;
}

.feeder:last-child {
  border-bottom: 0;
}

.feeder:active {
  background: var(--surface-2);
}


/* 料带用完：只留一点点红 */
.feeder.is-used-up {
  background: rgba(255, 91, 95, 0.05);
  box-shadow: inset 2px 0 0 rgba(255, 91, 95, 0.5);
}
/* 当前贴装板用到的飞达：浅浅的绿底 */
.feeder.is-board {
  background: rgba(31, 191, 114, 0.08);
}
.feeder.is-used-up.is-board {
  background: rgba(125, 217, 13, 0.08);
}

.feeder.is-off .feeder-main {
  opacity: 0.6;
}

.feeder-check {
  display: flex;
  align-items: center;
  flex: none;
}

.feeder-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feeder-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.feeder-part {
  min-width: 0;
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.feeder-name {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-2);
}

.feeder-params {
  font-size: 11px;
  color: var(--text-3);
}

.feeder-arrow {
  color: var(--text-3);
  flex: none;
}

.list-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

/* ---------- 编辑面板 ---------- */

/* 编辑弹窗头部的「机器」开关 */
.machine-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 11px;
}

.machine-toggle.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}

/* 关闭弹窗 */
.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin-left: 6px;
  border-radius: 6px;
  color: var(--text-3);
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.close-btn:active {
  color: var(--text);
  background: var(--surface-3);
}

/* 展开的机器控制面板 */
.machine-panel {
  padding: 10px 14px 0;
  border-bottom: 1px solid var(--line);
}

/* 展开 / 收起时的高度过渡 */
.machine-enter-active,
.machine-leave-active {
  overflow: hidden;
  transition:
    max-height 0.22s ease,
    padding-top 0.22s ease,
    opacity 0.18s ease;
}

.machine-enter-from,
.machine-leave-to {
  max-height: 0;
  padding-top: 0;
  opacity: 0;
}

.machine-enter-to,
.machine-leave-from {
  max-height: 212px;
  opacity: 1;
}

.machine-layout {
  display: flex;
  gap: 12px;
  height: 190px;
  padding-bottom: 10px;
}

.machine-rails {
  display: flex;
  gap: 8px;
  flex: none;
}

/* 弹窗自身不滚动，滚动交给表单区，避免出现两层滚动条 */
.feeder-popup {
  overflow: hidden;
}

.sheet-body {
  padding: 12px 14px calc(env(safe-area-inset-bottom) + 18px);
  overflow-y: auto;
  max-height: 68vh;
  /* 与控制面板同步收缩 */
  transition: max-height 0.22s ease;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.row.is-between {
  justify-content: space-between;
  margin-top: 14px;
}

/* 左右两列对齐：标签定宽，输入框等分剩余空间 */
.row.is-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 12px;
}

/* 散料表单：两列分界固定，第三栏留给取点按钮，保证各行左右对齐 */
.row.is-split3 {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 76px;
  gap: 8px 10px;
}

/* 没有取点按钮的行，右侧跨到按钮栏，输入框更宽 */
.row.is-split3 > .is-wide {
  grid-column: 2 / 4;
}

.field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.field > .pt-btn {
  flex: none;
}

/* 标签在左、开关在右（同一行放两个开关） */
.field.is-between {
  justify-content: space-between;
}

.row-label {
  flex: none;
  font-size: 12px;
  color: var(--text-3);
}

.row-value {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.input:focus {
  border-color: var(--accent-line);
}

.input.is-num {
  text-align: center;
}

/* ---------- 坐标行 ---------- */

.coord-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.axis {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.axis i {
  font-style: normal;
  font-size: 10px;
  color: var(--text-3);
}

.coord-actions {
  display: flex;
  gap: 4px;
  flex: none;
}

.pt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 32px;
  border-radius: 7px;
  border: 1px solid transparent;
}

.pt-btn :deep(.app-icon) {
  width: 18px;
  height: 18px;
}

.pt-btn.is-get {
  color: var(--ok);
  background: var(--ok-soft);
}

.pt-btn.is-move {
  color: var(--danger);
  background: var(--danger-soft);
}

.pt-btn.is-reset {
  color: var(--text-3);
  background: var(--surface-2);
  border-color: var(--line);
}

.pt-btn.is-pick {
  color: var(--accent);
  background: var(--accent-soft);
}

.pt-btn:active {
  filter: brightness(1.25);
}

/* ---------- 自动飞达 ---------- */

.feed-actions {
  display: flex;
  gap: 10px;
  margin: 8px 0 10px;
}

.feed-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 48px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}

.feed-btn:active {
  background: var(--surface-3);
  color: var(--accent);
}

/* ---------- 提示 / 余量 ---------- */

.tip {
  margin: 6px 0 10px;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-3);
}

.tip.is-danger {
  color: var(--danger);
}

.tip.is-warn {
  color: var(--warn);
}

.row-unit {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.usage-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-3);
  overflow: hidden;
}

.usage-bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--accent);
}

.usage-bar i.is-warn {
  background: var(--warn);
}

.usage-bar i.is-danger {
  background: var(--danger);
}

/* ---------- 取料点横向滚动条 ---------- */

.parts-block {
  margin-top: 16px;
}

.parts-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.parts-count {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.parts-rail {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 4px;
  scrollbar-width: thin;
}

.part-cell {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.part-cell:active {
  background: var(--surface-3);
}

/* 已取过的点弱化，剩下的点正常 */
.part-cell.is-used {
  color: var(--text-3);
  background: var(--surface);
  font-weight: 500;
}

.part-cell.is-locate {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
</style>
