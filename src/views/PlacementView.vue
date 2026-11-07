<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showConfirmDialog } from 'vant'
import 'vant/es/dialog/style'
import AppIcon from '@/components/AppIcon.vue'
import { useFeederStore } from '@/stores/feeder'
import { useMachineStore } from '@/stores/machine'
import { usePlacementStore, type PartFilter, type PartView } from '@/stores/placement'

const placement = usePlacementStore()
const machine = useMachineStore()
const feeder = useFeederStore()

const FILTERS: { value: PartFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
]

/** 分页渲染，避免大板一次铺开上千行 */
const PAGE_SIZE = 150
const limit = ref(PAGE_SIZE)

/** 管理 PCB 弹窗 */
const pcbManage = ref(false)

watch([() => placement.activeIndex, () => placement.filter, () => placement.query], () => {
  limit.value = PAGE_SIZE
})

const rows = computed(() => placement.visibleParts.slice(0, limit.value))
const hasMore = computed(() => placement.visibleParts.length > limit.value)

/** 拼版网格：按数量 X / Y 铺开，尺寸随左栏自适应 */
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${placement.panelGrid.x}, 1fr)`,
  gridTemplateRows: `repeat(${placement.panelGrid.y}, 1fr)`,
}))

/** 当前选中的子板在网格中的行列（从 1 开始） */
const activeCell = computed(() => placement.panelCells[placement.activeChild])

const sideText = (side: string) => (side === 'Top' ? '顶面' : side === 'Bottom' ? '底面' : side)

function toggleBoard(index: number, value: boolean | number | string) {
  placement.setBoardEnabled(index, Boolean(value))
}

function togglePart(path: string, value: boolean | number | string) {
  placement.setPartEnabled(path, Boolean(value))
}

/** 全启用 / 全不启用：先弹窗确认 */
async function setAllWithConfirm(enabled: boolean) {
  const action = enabled ? '启用' : '停用'
  try {
    await showConfirmDialog({
      title: enabled ? '全启用元件' : '全不启用元件',
      message: `将${action}当前子板的全部 ${placement.parts.length} 个元件（含基准点），是否继续？`,
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  placement.setAllParts(enabled)
}

/** 清除当前 PCB 的贴装状态，重新贴片前使用 */
async function clearStatus() {
  try {
    await showConfirmDialog({
      title: '清除贴装状态',
      message: `将清除当前 PCB（${placement.activeBoard?.id ?? '—'}）所有元件的贴装状态，是否继续？`,
      confirmButtonText: '清除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  placement.clearStatus()
}

/** 点选元件：始终选中，定位模式打开时同时把头部移过去 */
function onRowTap(part: PartView) {
  placement.selectPart(part.path)
  if (!placement.locateMode) return
  if (part.machineX === null || part.machineY === null) return
  machine.headTo(part.machineX, part.machineY)
}

/* ---------------- 元件设置 ---------------- */

/** 弹窗里编辑的元件草稿：数据库更新后同步到本地，行被筛掉时弹窗也不会丢数据 */
const editingPart = ref(false)
const draft = ref<PartView | null>(null)

/** 本地字段 → 数据库字段 */
const PART_KEYS: Record<string, string> = {
  enable: 'enable',
  status: 'status',
  ref: 'Ref',
  value: 'Val',
  package: 'Package',
  x: 'PosX',
  y: 'PosY',
  rot: 'Rot',
  side: 'Side',
  comments: 'Comments',
  weight: 'weight',
}

function openPartEditor(part: PartView) {
  draft.value = { ...part }
  editingPart.value = true
}

function writePart(local: string, value: unknown) {
  const item = draft.value
  if (!item) return
  placement.updatePart(item.path, { [PART_KEYS[local]]: value })
  ;(item as unknown as Record<string, unknown>)[local] = value
}

function commitPartText(local: 'ref' | 'value' | 'package' | 'comments', event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  writePart(local, raw)
}

function commitPartNumber(local: 'x' | 'y' | 'rot' | 'weight', event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = Number(raw)
  if (raw === '' || !Number.isFinite(value)) return
  const rounded = local === 'x' || local === 'y' ? Number(value.toFixed(3)) : Math.round(value)
  writePart(local, rounded)
}

/** 状态：数据库里只有 '' 和 done 两种 */
function setPartStatus(done: boolean) {
  writePart('status', done ? 'done' : '')
  if (draft.value) draft.value.done = done
}

/** 类型：Part = 贴装 · Fiducial = 基准 */
function setPartKind(mark: boolean) {
  const item = draft.value
  if (!item) return
  placement.updatePart(item.path, { PartType: mark ? 'Fiducial' : 'Part' })
  item.kind = mark ? 'mark' : 'part'
}

function setPartSide(top: boolean) {
  writePart('side', top ? 'Top' : 'Bottom')
}

const formatPart = (value: number) => String(Number(value.toFixed(3)))

/* ---------------- 元件 / 封装从飞达选 ---------------- */

const pickingFeeder = ref(false)
const feederQuery = ref('')

/** 启用中的飞达按「元件=封装」计数，停用的不参与统计与选择 */
const feederUsage = computed(() => {
  const map = new Map<string, number>()
  for (const item of feeder.feeders) {
    if (!item.enable || !item.value) continue
    const key = `${item.value.trim()}=${item.package.trim()}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return map
})

/** 这个元件有几台启用中的飞达在供料 */
function feederCountOf(part: PartView): number {
  if (!part.value) return 0
  return feederUsage.value.get(`${part.value.trim()}=${part.package.trim()}`) ?? 0
}

/** 启用中的飞达元件去重，按使用数量排序 */
const feederOptions = computed(() => {
  const keyword = feederQuery.value.trim().toLowerCase()
  const map = new Map<string, { value: string; package: string; count: number }>()
  for (const item of feeder.feeders) {
    if (!item.enable || !item.value) continue
    const key = `${item.value}|${item.package}`
    const hit = map.get(key)
    if (hit) hit.count += 1
    else map.set(key, { value: item.value, package: item.package, count: 1 })
  }
  return [...map.values()]
    .filter((item) => !keyword || `${item.value} ${item.package}`.toLowerCase().includes(keyword))
    .sort((a, b) => b.count - a.count)
})

function openFeederPicker() {
  feederQuery.value = ''
  pickingFeeder.value = true
}

/** 选中后同时填元件和封装 */
function pickFeeder(option: { value: string; package: string }) {
  writePart('value', option.value)
  writePart('package', option.package)
  pickingFeeder.value = false
}
</script>

<template>
  <div class="page">
    <div class="page-body">
      <!-- PCB 列表 -->
      <section class="panel">
        <div class="panel-head">
          <span class="panel-title">PCB</span>
          <span class="panel-sub">{{ placement.boards.length }} 块</span>
          <button class="pcb-manage" title="管理 PCB" @click="pcbManage = true">
            <AppIcon name="list" :size="14" />
            管理
          </button>
          <span class="chip is-ok" style="margin-left: auto;">{{ placement.enabledBoardCount }} / {{ placement.boards.length }} 板启用</span>
        </div>

        <div class="board-area">
          <div class="setup">
            <div class="panel-grid" :style="gridStyle">
              <button
                v-for="cell in placement.panelCells"
                :key="cell.index"
                class="panel-cell"
                :class="{
                  'is-active': cell.index === placement.activeChild,
                  'is-empty': !cell.available,
                }"
                :disabled="!cell.available"
                @click="placement.selectChild(cell.index)"
              />
              <span class="panel-caption num">X:{{ activeCell?.x ?? 1 }} Y:{{ activeCell?.y ?? 1 }}</span>
            </div>

            <div class="setup-fields">
              <div class="setup-row">
                <span class="setup-label">数量</span>
                <span class="setup-pair">
                  <span class="setup-value num"><i>X</i>{{ placement.arrayQty.x }}</span>
                  <span class="setup-value num"><i>Y</i>{{ placement.arrayQty.y }}</span>
                </span>
              </div>
              <div class="setup-row">
                <span class="setup-label">间距</span>
                <span class="setup-pair">
                  <span class="setup-value num"><i>X</i>{{ placement.arrayGap.x.toFixed(3) }}</span>
                  <span class="setup-value num"><i>Y</i>{{ placement.arrayGap.y.toFixed(3) }}</span>
                </span>
              </div>
            </div>

            <button class="calib-btn" @click="machine.fiducialCheck(placement.activeIndex)">校准</button>
          </div>

          <ul class="board-list">
            <li
              v-for="board in placement.boards"
              :key="board.path"
              class="board"
              :class="{ 'is-active': board.index === placement.activeIndex }"
              @click="placement.selectBoard(board.index)"
            >
              <van-switch
                :model-value="board.enable"
                size="18"
                @click.stop
                @update:model-value="toggleBoard(board.index, $event)"
              />
              <div class="board-main">
                <span class="board-name" :class="{ 'is-off': !board.enable }">{{ board.id }}</span>
                <div class="board-meta">
                  <span class="chip">{{ sideText(board.side) }}</span>
                  <span v-if="board.status" class="chip is-ok">{{ board.status }}</span>
                  <span v-else class="chip" :class="board.enable ? 'is-ok' : ''">
                    {{ board.enable ? '已启用' : '未启用' }}
                  </span>
                </div>
              </div>
            </li>
            <li v-if="!placement.boards.length" class="list-empty">数据库中没有板数据</li>
          </ul>
        </div>
      </section>

      <!-- 选中 PCB 的元件列表 -->
      <section class="panel comp-panel">
        <div class="panel-head">
          <span class="panel-title">元件</span>
          <span class="panel-sub">{{ placement.activeBoard?.id ?? '—' }}</span>
          <span class="topbar-spacer" />
          <button class="text-btn" @click="clearStatus">清除贴装状态</button>
          <button class="text-btn" @click="setAllWithConfirm(true)">全启用</button>
          <button class="text-btn" @click="setAllWithConfirm(false)">全不启用</button>
        </div>

        <div class="toolbar">
          <div class="seg">
            <button
              v-for="item in FILTERS"
              :key="item.value"
              class="seg-item"
              :class="{ 'is-active': placement.filter === item.value }"
              @click="placement.filter = item.value"
            >
              {{ item.label }}
            </button>
          </div>
          <button
            class="mode-btn"
            :class="{ 'is-active': placement.locateMode }"
            @click="placement.locateMode = !placement.locateMode"
          >
            <AppIcon name="crosshair" :size="15" />
            <span>点选定位</span>
          </button>
        </div>

        <div class="search">
          <AppIcon name="search" :size="16" />
          <input v-model="placement.query" type="search" placeholder="搜索位号 / 元件 / 封装" />
        </div>

        <div class="comp-stats">
          <span>共 {{ placement.stats.total }}</span>
          <span>启用 {{ placement.stats.enabled }}</span>
          <span>贴装 {{ placement.stats.placements }}</span>
          <span>基准 {{ placement.stats.marks }}</span>
        </div>

        <ul class="comp-list">
          <li
            v-for="part in rows"
            :key="part.path"
            class="comp"
            :class="{ 'is-selected': part.path === placement.selectedPath }"
            @click="onRowTap(part)"
          >
            <span class="comp-check" @click.stop>
              <van-checkbox
                :model-value="part.enable"
                shape="square"
                icon-size="17"
                @update:model-value="togglePart(part.path, $event)"
              />
            </span>
            <div class="comp-main" :class="{ 'is-off': !part.enable }">
              <div class="comp-line">
                <b class="comp-ref">{{ part.ref }}</b>
                <span class="chip" :class="part.kind === 'mark' ? 'is-warn' : 'is-info'">
                  {{ part.kind === 'mark' ? '基准' : '贴装' }}
                </span>
                <!-- <span v-if="part.done" class="chip is-ok">已完成</span> -->
                <span class="comp-part">{{ part.value }}</span>
              </div>
              <div class="comp-line comp-params">
                <span class="num">{{ part.package }}</span>
                <span class="num">{{ part.x.toFixed(2) }}</span>
                <span class="num">{{ part.y.toFixed(2) }}</span>
                <span class="num">{{ part.rot }}°</span>
              </div>
            </div>
            <span v-if="part.kind === 'part'" class="comp-feeders">
              <span v-if="part.done" class="chip is-ok">完成</span>
              <span v-if="!feederCountOf(part)" class="chip is-warn comp-no-feeder">无飞达</span>
            </span>
            <button class="comp-settings" title="元件设置" @click.stop="openPartEditor(part)">
              <AppIcon name="settings" :size="16" />
            </button>
          </li>
          <li v-if="!rows.length" class="list-empty">无匹配元件</li>
          <li v-else-if="hasMore" class="list-more">
            <button class="more-btn" @click="limit += PAGE_SIZE">
              显示更多（还有 {{ placement.visibleParts.length - limit }} 条）
            </button>
          </li>
        </ul>
      </section>
    </div>

    <!-- 元件设置 -->
    <van-popup
      v-model:show="editingPart"
      position="bottom"
      round
      :z-index="2600"
      :style="{ maxHeight: '86%' }"
      class="part-popup"
    >
      <template v-if="draft">
        <div class="panel-head">
          <span class="panel-title">元件设置</span>
          <span class="panel-sub">{{ draft.ref || '—' }}</span>
          <van-switch
            :model-value="draft.enable"
            size="20"
            @update:model-value="writePart('enable', Boolean($event))"
          />
          <span class="topbar-spacer" />
          <button class="close-btn" title="关闭" @click="editingPart = false">
            <AppIcon name="close" :size="16" />
          </button>
        </div>

        <div class="part-body">
          <div class="edit-row is-split">
            <label class="edit-field">
              <span class="edit-label">位号</span>
              <input class="edit-input" :value="draft.ref" @change="commitPartText('ref', $event)" />
            </label>
            <div class="edit-field">
              <span class="edit-label">状态</span>
              <div class="seg edit-seg">
                <button class="seg-item" :class="{ 'is-active': !draft.done }" @click="setPartStatus(false)">
                  未贴装
                </button>
                <button class="seg-item" :class="{ 'is-active': draft.done }" @click="setPartStatus(true)">
                  已完成
                </button>
              </div>
            </div>
          </div>

          <div class="edit-row is-split">
            <div class="edit-field">
              <span class="edit-label">元件</span>
              <input class="edit-input" :value="draft.value" @change="commitPartText('value', $event)" />
              <button class="edit-pick" title="从飞达选择元件" @click="openFeederPicker">
                <AppIcon name="list" :size="15" />
              </button>
            </div>
            <label class="edit-field">
              <span class="edit-label">封装</span>
              <input class="edit-input" :value="draft.package" @change="commitPartText('package', $event)" />
            </label>
          </div>

          <div class="edit-row is-third">
            <label class="edit-field">
              <span class="edit-axis">X</span>
              <input
                class="edit-input is-num num"
                :value="formatPart(draft.x)"
                @change="commitPartNumber('x', $event)"
              />
            </label>
            <label class="edit-field">
              <span class="edit-axis">Y</span>
              <input
                class="edit-input is-num num"
                :value="formatPart(draft.y)"
                @change="commitPartNumber('y', $event)"
              />
            </label>
            <label class="edit-field">
              <span class="edit-axis">R</span>
              <input
                class="edit-input is-num num"
                :value="String(draft.rot)"
                @change="commitPartNumber('rot', $event)"
              />
            </label>
          </div>

          <div class="edit-row is-split">
            <div class="edit-field">
              <span class="edit-label">类型</span>
              <div class="seg edit-seg">
                <button class="seg-item" :class="{ 'is-active': draft.kind === 'part' }" @click="setPartKind(false)">
                  贴装
                </button>
                <button class="seg-item" :class="{ 'is-active': draft.kind === 'mark' }" @click="setPartKind(true)">
                  基准
                </button>
              </div>
            </div>
            <div class="edit-field">
              <span class="edit-label">面</span>
              <div class="seg edit-seg">
                <button class="seg-item" :class="{ 'is-active': draft.side !== 'Bottom' }" @click="setPartSide(true)">
                  顶面
                </button>
                <button class="seg-item" :class="{ 'is-active': draft.side === 'Bottom' }" @click="setPartSide(false)">
                  底面
                </button>
              </div>
            </div>
          </div>

          <div class="edit-row is-split">
            <div class="edit-field">
              <span class="edit-label">注释</span>
              <input class="edit-input" :value="draft.comments" @change="commitPartText('comments', $event)" />
            </div>

            <div class="edit-field">
              <span class="edit-label">优先级</span>
              <input
                class="edit-input is-num num"
                :value="String(draft.weight)"
                @change="commitPartNumber('weight', $event)"
              />
            </div>
          </div>
        </div>
      </template>
    </van-popup>

    <!-- 管理 PCB：仅查看，勾选需到 PC 端 -->
    <van-popup
      v-model:show="pcbManage"
      position="bottom"
      round
      :z-index="2600"
      :style="{ maxHeight: '70%' }"
      class="pcb-popup"
    >
      <div class="panel-head">
        <span class="panel-title">管理 PCB</span>
        <span class="panel-sub">{{ placement.pcbHistory.length }} 个</span>
        <span class="topbar-spacer" />
        <button class="close-btn" title="关闭" @click="pcbManage = false">
          <AppIcon name="close" :size="16" />
        </button>
      </div>

      <p class="pcb-tip">这里只做查看，请到 PC 端操作</p>

      <ul class="pcb-list">
        <li v-for="item in placement.pcbHistory" :key="item.path" class="pcb-row">
          <van-checkbox :model-value="item.use" shape="square" icon-size="17" disabled />
          <span class="pcb-name">{{ item.name || '未命名' }}</span>
          <span class="pcb-time num">{{ item.lasttime }}</span>
        </li>
        <li v-if="!placement.pcbHistory.length" class="list-empty">没有 PCB 记录</li>
      </ul>
    </van-popup>

    <!-- 从飞达选择元件 -->
    <van-popup
      v-model:show="pickingFeeder"
      position="bottom"
      round
      :z-index="2700"
      :style="{ maxHeight: '70%' }"
      class="feeder-pick-popup"
    >
      <div class="panel-head">
        <span class="panel-title">选择飞达元件</span>
        <span class="panel-sub">{{ feederOptions.length }} 个</span>
        <span class="topbar-spacer" />
        <button class="close-btn" title="关闭" @click="pickingFeeder = false">
          <AppIcon name="close" :size="16" />
        </button>
      </div>

      <div class="search">
        <AppIcon name="search" :size="16" />
        <input v-model="feederQuery" type="search" placeholder="搜索元件 / 封装" />
      </div>

      <ul v-if="feederOptions.length" class="feeder-pick-list">
        <li v-for="option in feederOptions" :key="`${option.value}|${option.package}`">
          <button class="feeder-pick-item" @click="pickFeeder(option)">
            <span class="feeder-pick-value">{{ option.value }}</span>
            <span class="num feeder-pick-package">= {{ option.package || '—' }}</span>
            <span class="num feeder-pick-count">×{{ option.count }}</span>
          </button>
        </li>
      </ul>
      <p v-else class="feeder-pick-empty">飞达列表里还没有元件。</p>
    </van-popup>
  </div>
</template>

<style scoped>
/* ---------- PCB ---------- */
.board-area {
  display: flex;
  align-items: stretch;
}

/* 左侧：拼版网格在上，数量/间距在下 */
.setup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: none;
  width: 152px;
  padding: 10px 10px 10px 12px;
  border-right: 1px solid var(--line);
}

/* 拼版网格：单元可点击切换子板，随左栏撑满并限制高度 */
.panel-grid {
  position: relative;
  display: grid;
  gap: 1px;
  flex: 1;
  width: 100%;
  min-height: 90px;
  max-height: 200px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--line);
  overflow: hidden;
}

.panel-cell {
  border: 0;
  padding: 0;
  background: var(--surface-3);
  transition: background 0.15s;
}

.panel-cell:active {
  background: var(--surface-2);
}

.panel-cell.is-active {
  background: linear-gradient(150deg, var(--accent), var(--accent-deep));
}

.panel-cell.is-empty {
  background: var(--surface);
  opacity: 0.5;
}

.panel-caption {
  position: absolute;
  left: 3px;
  bottom: 2px;
  font-size: 10px;
  font-weight: 700;
  color: var(--danger);
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.7), 0 0 1px rgba(0, 0, 0, 0.9);
  pointer-events: none;
}

.setup-fields {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setup-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.setup-label {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}

.setup-pair {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-left: auto;
}

.setup-value {
  font-size: 11px;
  color: var(--text);
}

.setup-value i {
  font-style: normal;
  font-size: 10px;
  color: var(--text-3);
  margin-right: 3px;
}

.board-list {
  list-style: none;
  margin: 0;
  padding: 0;
  flex: 1;
  min-width: 0;
  max-height: 40vh;
  overflow-y: auto;
}

.board {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  transition: background 0.15s;
}

.board:last-child {
  border-bottom: 0;
}

.board.is-active {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}

.board-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.board-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.board-name.is-off {
  color: var(--text-3);
  font-weight: 500;
}

.board-meta {
  display: flex;
  gap: 5px;
}

.board-meta .chip {
  height: 17px;
  padding: 0 5px;
  font-size: 10px;
}

/* 校准当前选中的板 */
.calib-btn {
  flex: none;
  width: 100%;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11px;
}

.calib-btn:active {
  color: var(--accent);
  border-color: var(--accent-line);
}

/* ---------- 元件 ---------- */
.comp-panel {
  margin-top: 14px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 0;
}

.toolbar .seg {
  flex: 1;
  min-width: 0;
}

.text-btn {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
}

.text-btn:active {
  color: var(--accent);
  border-color: var(--accent-line);
}

/* 板名过长时省略，别把标题栏的按钮挤掉 */
.comp-panel .panel-head {
  gap: 6px;
}

.comp-panel .panel-title {
  flex: none;
  white-space: nowrap;
}

.comp-panel .panel-sub {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 标题栏三个按钮：收窄内边距，留出板名位置 */
.comp-panel .text-btn {
  padding: 0 8px;
  font-size: 11px;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 12px;
  transition: color 0.15s, background 0.15s, border-color 0.15s;
}

.mode-btn.is-active {
  color: var(--accent);
  background: var(--accent-soft);
  border-color: var(--accent-line);
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

.comp-stats {
  display: flex;
  gap: 12px;
  padding: 10px 14px 6px;
  font-size: 11px;
  color: var(--text-3);
}

.comp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.comp {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.comp:last-child {
  border-bottom: 0;
}

.comp-check {
  display: flex;
  align-items: center;
  flex: none;
}

.comp.is-selected {
  background: var(--accent-soft);
  box-shadow: inset 2px 0 0 var(--accent);
}

.comp-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.comp-main.is-off {
  opacity: 0.45;
}

.comp-line {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.comp-ref {
  font-size: 13px;
  font-weight: 650;
  flex: none;
}

.comp-part {
  font-size: 13px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.comp-params {
  gap: 10px;
  font-size: 11px;
  color: var(--text-3);
}

.list-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

/* ---------- 元件设置 ---------- */

/* 供料飞达数量 / 无飞达标记，靠右显示 */
.comp-feeders {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 4px;
}

.comp-feeder-count {
  font-size: 11px;
  color: var(--text-3);
}

.comp-no-feeder {
  height: 17px;
  padding: 0 5px;
  font-size: 10px;
}

/* 行右侧的设置按钮 */
.comp-settings {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid transparent;
  color: var(--text-3);
}

.comp-settings:active {
  color: var(--accent);
  background: var(--surface-2);
  border-color: var(--line);
}

.part-popup {
  overflow: hidden;
}

.part-body {
  max-height: 68vh;
  padding: 12px 14px calc(env(safe-area-inset-bottom) + 16px);
  overflow-y: auto;
}

.edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.edit-row.is-split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px 12px;
}

.edit-row.is-third {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.edit-label {
  flex: none;
  font-size: 12px;
  color: var(--text-3);
}

.edit-field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.edit-axis {
  flex: none;
  font-size: 10px;
  color: var(--text-3);
}

.edit-input {
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

.edit-input:focus {
  border-color: var(--accent-line);
}

.edit-input.is-num {
  text-align: center;
}

/* 从飞达选元件 / 封装 */
.edit-pick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 36px;
  height: 32px;
  border-radius: 7px;
  color: var(--accent);
  background: var(--accent-soft);
}

.edit-seg {
  flex: 1;
  min-width: 0;
}

.edit-seg .seg-item {
  padding: 6px 10px;
  font-size: 12px;
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-3);
}

.close-btn:active {
  color: var(--text);
  background: var(--surface-3);
}

/* ---------- 从飞达选择元件 ---------- */

.feeder-pick-popup {
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

.feeder-pick-list {
  list-style: none;
  margin: 10px 12px 14px;
  padding: 0;
  border-top: 1px solid var(--line);
}

.feeder-pick-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.feeder-pick-item:active {
  background: var(--surface-2);
}

.feeder-pick-value {
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.feeder-pick-package {
  flex: none;
  color: var(--text-2);
}

.feeder-pick-count {
  flex: none;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-3);
}

.feeder-pick-empty {
  padding: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
}

.list-more {
  padding: 12px;
  text-align: center;
}

.more-btn {
  padding: 8px 14px;
  border-radius: var(--r-sm);
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 12px;
}

/* ---------- 管理 PCB ---------- */

.pcb-manage {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  height: 24px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--text-2);
  font-size: 11px;
}

.pcb-manage:active {
  color: var(--accent);
  border-color: var(--accent-line);
}

.pcb-popup {
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

.pcb-tip {
  margin: 8px 12px 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.pcb-list {
  list-style: none;
  margin: 8px 12px 14px;
  padding: 0;
}

.pcb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
}

.pcb-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pcb-time {
  flex: none;
  font-size: 11px;
  color: var(--text-3);
}
</style>
