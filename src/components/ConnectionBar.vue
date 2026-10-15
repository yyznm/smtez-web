<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import { useDatabaseStore } from '@/stores/database'
import { useMachineStore } from '@/stores/machine'

const database = useDatabaseStore()
const machine = useMachineStore()

const showPanel = ref(false)
const draft = ref(database.url)

const STATUS_TEXT: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中',
  open: '已连接',
  closed: '已断开',
}

const STATUS_TONE: Record<string, string> = {
  idle: '',
  connecting: 'is-warn',
  open: 'is-ok',
  closed: 'is-danger',
}

const statusText = computed(() => STATUS_TEXT[database.connection.status] ?? '未连接')
const tone = computed(() => STATUS_TONE[database.connection.status] ?? '')
const originText = computed(() => (database.origin === 'remote' ? '远端数据库' : '无数据'))
const syncText = computed(() => {
  switch (database.syncState) {
    case 'syncing':
      return '同步中'
    case 'synced':
      return '已同步'
    case 'failed':
      return '同步失败'
    default:
      return '未同步'
  }
})

function formatValue(value: unknown): string {
  if (value === undefined) return ''
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

function openPanel() {
  draft.value = database.url
  showPanel.value = true
}

function apply() {
  database.connect(draft.value)
  showPanel.value = false
}

function disconnect() {
  database.disconnect()
  showPanel.value = false
}

function syncNow() {
  void database.pullAll()
}
</script>

<template>
  <button class="conn" :class="tone" @click="openPanel">
    <span class="dot" :class="tone" />
    <span class="conn-status">{{ statusText }}</span>
    <div class="devices">
      <span v-for="device in machine.devices" :key="device.id" class="device">
        {{ device.label }}<i class="device-dot" :class="{ 'is-on': device.online }" />
      </span>
    </div>
    <AppIcon name="settings" :size="15" />
  </button>

  <van-popup
    v-model:show="showPanel"
    position="bottom"
    round
    :style="{ maxHeight: '76%' }"
    class="conn-popup"
  >
    <div class="panel-head">
      <span class="panel-title">机器连接</span>
      <span class="panel-sub">{{ syncText }} · 数据版本 v{{ database.dataVersion }}</span>
    </div>

    <div class="panel-body">
      <div class="field">
        <span class="field-label">服务站地址</span>
        <input v-model="draft" class="field-input num" placeholder="ws://192.168.1.20:8080" />
      </div>
      <div class="actions">
        <button class="btn is-primary" @click="apply">连接</button>
        <button class="btn" @click="syncNow">同步数据库</button>
        <button class="btn" @click="disconnect">断开</button>
      </div>

      <div class="meta">
        <span>状态 {{ statusText }}</span>
        <span>来源 {{ originText }}</span>
        <span>重连 {{ database.connection.retries }}</span>
      </div>
      <p v-if="database.connection.error" class="error">{{ database.connection.error }}</p>

      <div class="section-header">
        <span>数据库变更</span>
        <span class="dim">{{ database.patchLog.length }} 条</span>
      </div>
      <ul class="log">
        <li v-for="(record, index) in database.patchLog" :key="`${record.at}-${index}`" class="log-item">
          <span class="chip" :class="record.from === 'remote' ? 'is-info' : 'is-accent'">
            {{ record.from === 'remote' ? '远端' : '本地' }}
          </span>
          <span class="log-path num">{{ record.path }}</span>
          <span class="log-value num">{{ formatValue(record.value) }}</span>
        </li>
        <li v-if="!database.patchLog.length" class="log-empty">暂无变更</li>
      </ul>

      <div class="section-header">
        <span>未识别事件</span>
        <span class="dim">{{ database.eventLog.length }} 条</span>
      </div>
      <ul class="log is-event">
        <li v-for="(record, index) in database.eventLog" :key="`${record.at}-${index}`" class="log-item">
          <span class="chip is-warn">{{ record.event }}</span>
          <span class="log-value num">{{ formatValue(record.payload) }}</span>
        </li>
        <li v-if="!database.eventLog.length" class="log-empty">暂无</li>
      </ul>
    </div>
  </van-popup>
</template>

<style scoped>
.conn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 var(--gutter);
  background: var(--bg-2);
  border-bottom: 1px solid var(--line);
  text-align: left;
}

/* ---------- 连接状态 ---------- */

.conn-status {
  flex: none;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-2);
}

.conn.is-ok .conn-status {
  color: var(--ok);
}

.conn.is-warn .conn-status {
  color: var(--warn);
}

.conn.is-danger .conn-status {
  color: var(--danger);
}

/* 全局只有 ok / warn / run 三种状态点，这里补上断开态 */
.conn .dot.is-danger {
  background: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-soft);
}

/* ---------- 设备链路状态（靠右） ---------- */

.devices {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
}

.device {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--text-2);
  white-space: nowrap;
}

.device-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3);
}

.device-dot.is-on {
  background: var(--ok);
}

/* ---------- 弹层 ---------- */
.panel-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--line);
}

.panel-body {
  padding: 12px 14px calc(env(safe-area-inset-bottom) + 16px);
  overflow-y: auto;
  max-height: 62vh;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  color: var(--text-3);
}

.field-input {
  height: 38px;
  padding: 0 10px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--text);
  font-size: 12px;
  outline: none;
}

.field-input:focus {
  border-color: var(--line-2);
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.btn {
  flex: 1;
  height: 36px;
  border-radius: var(--r-sm);
  background: var(--surface-3);
  color: var(--text-2);
  font-size: 13px;
}

.btn.is-primary {
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 650;
}

.meta {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-3);
}

.error {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--danger);
}

.section-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 16px 0 6px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-3);
}

.log {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--surface);
}

.log-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 11px;
}

.log-item:last-child {
  border-bottom: 0;
}

.log-path {
  flex: 1;
  min-width: 0;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-value {
  flex: 1;
  max-width: 45%;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 未识别事件没有路径列，事件内容占满整行 */
.log.is-event .log-value {
  flex: 1;
  max-width: none;
}

.log-empty {
  padding: 12px;
  text-align: center;
  font-size: 11px;
  color: var(--text-3);
}
</style>
