<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useMachineStore } from '@/stores/machine'
import { usePlacementStore, type PartFilter, type PartView } from '@/stores/placement'

const placement = usePlacementStore()
const machine = useMachineStore()

const FILTERS: { value: PartFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '启用' },
  { value: 'disabled', label: '停用' },
]

/** 分页渲染，避免大板一次铺开上千行 */
const PAGE_SIZE = 150
const limit = ref(PAGE_SIZE)

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

/** 点选元件：始终选中，定位模式打开时同时把头部移过去 */
function onRowTap(part: PartView) {
  placement.selectPart(part.path)
  if (!placement.locateMode) return
  if (part.machineX === null || part.machineY === null) return
  machine.headTo(part.machineX, part.machineY)
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
                size="22"
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
              <span v-if="board.index === placement.activeIndex" class="board-mark">
                <AppIcon name="check" :size="16" />
              </span>
              <button class="text-btn" @click.stop="machine.fiducialCheck(board.index)">校准</button>
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
          <button class="text-btn" @click="placement.setAllParts(true)">全启用</button>
          <button class="text-btn" @click="placement.setAllParts(false)">全不启用</button>
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
                <span class="comp-part">{{ part.value }}</span>
              </div>
              <div class="comp-line comp-params">
                <span class="num">{{ part.package }}</span>
                <span class="num">X {{ part.x.toFixed(3) }}</span>
                <span class="num">Y {{ part.y.toFixed(3) }}</span>
                <span class="num">{{ part.rot }}°</span>
              </div>
            </div>
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
  background: linear-gradient(150deg, #2f9e63, #1c7048);
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
  gap: 10px;
  padding: 11px 12px;
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
  gap: 5px;
}

.board-name {
  font-size: 14px;
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
  gap: 6px;
}

.board-mark {
  color: var(--accent);
  flex: none;
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
  border-color: rgba(255, 176, 32, 0.35);
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
  border-color: rgba(255, 176, 32, 0.32);
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
</style>
