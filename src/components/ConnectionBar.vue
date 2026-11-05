<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import 'vant/es/toast/style'
import AppIcon from './AppIcon.vue'
import { DEFAULT_PORT, useDatabaseStore } from '@/stores/database'
import { useMachineStore } from '@/stores/machine'

const database = useDatabaseStore()
const machine = useMachineStore()

const showPanel = ref(false)
/** 设置里显示的地址：原样保存用户填写的内容 */
const draft = ref(database.address)

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

const statusText = computed(() => {
  if (!database.url) return '未设置地址'
  return STATUS_TEXT[database.connection.status] ?? '未连接'
})
const tone = computed(() => {
  if (!database.url) return 'is-warn'
  return STATUS_TONE[database.connection.status] ?? ''
})
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

function openPanel() {
  draft.value = database.address
  showPanel.value = true
}

/** 数据库初始化完成（读过本地存储）后仍没有地址，就直接把设置面板打开 */
watch(
  () => database.ready,
  (isReady) => {
    if (isReady && !database.address) openPanel()
  },
  { immediate: true },
)

/** 连接失败（含掉线）时弹提示并打开设置面板；自动重连的后续失败不再重复打扰 */
watch(
  () => database.connection.status,
  (status) => {
    if (status !== 'closed' || database.connection.retries > 0) return
    // zIndex 抬高，避免被随后打开的设置面板遮住
    showFailToast({ message: '连接失败，请检查贴片机地址与设置', duration: 3000, zIndex: 5000 })
    openPanel()
  },
)

function apply() {
  // 只填 ip / ip:端口 也能连，补全逻辑在 store 里
  if (!draft.value.trim()) return
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
        <span class="field-label">贴片机地址</span>
        <input v-model="draft" class="field-input num" placeholder="192.168.1.20" />
      </div>
      <p v-if="!draft.trim()" class="hint is-warn">还没设置贴片机地址，填写后点「连接」，默认端口 {{ DEFAULT_PORT }}</p>
      <p v-else class="hint is-warn">填写完成后点「连接」，默认端口 {{ DEFAULT_PORT }}</p>
      <div class="notice">
        <p class="notice-title">连接前请先在贴片机设置中打开：</p>
        <ul class="notice-list">
          <li>启用基于网络的插件端口</li>
          <li>允许广域网访问插件端口</li>
          <li>不检查连接插件端口的 IP</li>
        </ul>
        <p class="notice-note">
          这些设置有几率不生效，试试重启smtez，也不知道是谁的问题 (/▽＼)
        </p>
        <p class="notice-note">
          未打开「不检查连接插件端口的 IP」时，需在弹出的连接提示中手动允许后再刷新页面才能完成连接。
        </p>
      </div>
      <div class="actions">
        <button class="btn is-primary" @click="apply">连接</button>
        <button class="btn" @click="syncNow">手动同步数据</button>
        <button class="btn" @click="disconnect">断开</button>
      </div>

      <div class="meta">
        <span>状态 {{ statusText }}</span>
        <span>重连 {{ database.connection.retries }}</span>
      </div>
      <p v-if="database.connection.error" class="error">{{ database.connection.error }}</p>
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

.hint {
  margin: 10px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-3);
}

.hint.is-warn {
  color: var(--warn);
}

/* 连接前置条件：左侧强调条的说明卡片 */
.notice {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-left: 2px solid var(--accent-line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}

.notice-title {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}

.notice-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
}

.notice-list li {
  position: relative;
  padding-left: 12px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-2);
}

.notice-list li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 7px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--accent);
}

.notice-note {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px dashed var(--line-2);
  font-size: 11px;
  line-height: 1.55;
  color: var(--text-3);
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
</style>
