import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { applyPatch, getByPath } from '@/api/json-patch'
import { machineCommands } from '@/api/machine-commands'
import { wsClient, type WsStatusDetail } from '@/api/ws-client'
import type {
  DatabaseOrigin,
  DatabasePatch,
  MachineEventRecord,
  PatchRecord,
  PatchSource,
} from '@/types/database'

const STORAGE_KEY = 'smt.ws.url'
/** 单条读取请求的超时时间 */
const READ_TIMEOUT = 5000
const LOG_LIMIT = 40
/** 已由其他模块消费的事件（位置上报、设备状态、机器消息由 machine store 处理），不计入未识别日志 */
const CONSUMED_EVENTS = new Set(['PostionChange', 'status', 'msg'])

function defaultUrl(): string {
  const override = import.meta.env.VITE_WS_URL
  if (typeof override === 'string' && override) return override
  return `ws://10.0.0.141:9002/`
}

interface PendingRead {
  path: string
  timer: number
  resolve: (value: unknown) => void
}

export type SyncState = 'idle' | 'syncing' | 'synced' | 'failed'

/**
 * 应用内维护的机器数据库。
 *
 * - 启动时载入本地快照（public/data.json，即机器软件目录下的 .data.json）
 * - 连接成功后用 readdatabase 拉取完整数据库覆盖本地快照
 * - 之后通过 database 事件（JSON Patch）增量同步，本地修改同样以 Patch 下发
 */
export const useDatabaseStore = defineStore('database', () => {
  const data = ref<Record<string, unknown>>({})
  const origin = ref<DatabaseOrigin>('none')
  const url = ref(defaultUrl())
  const connection = ref<WsStatusDetail>({ status: 'idle', url: '', retries: 0 })
  const syncState = ref<SyncState>('idle')
  /** 最近的数据变更（事件监听结果） */
  const patchLog = ref<PatchRecord[]>([])
  /** 未识别的机器事件，便于对照文档补齐 */
  const eventLog = ref<MachineEventRecord[]>([])

  const connected = computed(() => connection.value.status === 'open')
  const dataVersion = computed(() => get<number>('/dataVersion', 0))

  const subscribers = new Set<(record: PatchRecord) => void>()
  const pendingReads: PendingRead[] = []
  let initialized = false

  /* ---------------- 读取 ---------------- */

  function get<T>(path: string, fallback: T): T {
    const value = getByPath(data.value, path)
    return (value === undefined || value === null ? fallback : value) as T
  }

  function getNumber(path: string, fallback = 0): number {
    const value = getByPath(data.value, path)
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  function getString(path: string, fallback = ''): string {
    const value = getByPath(data.value, path)
    return typeof value === 'string' ? value : fallback
  }

  function getBoolean(path: string, fallback = false): boolean {
    const value = getByPath(data.value, path)
    return typeof value === 'boolean' ? value : fallback
  }

  /* ---------------- 变更事件 ---------------- */

  /** 订阅数据库变更，返回取消订阅函数 */
  function onPatch(handler: (record: PatchRecord) => void): () => void {
    subscribers.add(handler)
    return () => subscribers.delete(handler)
  }

  /** 应用一批变更（本地或远端），并向订阅者广播 */
  function applyPatches(patches: DatabasePatch[], from: PatchSource) {
    if (!patches.length) return
    for (const patch of patches) applyPatch(data.value, patch)

    const at = Date.now()
    const records: PatchRecord[] = patches.map((patch) => ({
      op: patch.op,
      path: patch.path,
      value: patch.value,
      at,
      from,
    }))

    patchLog.value = [...records.reverse(), ...patchLog.value].slice(0, LOG_LIMIT)
    records.forEach((record) => subscribers.forEach((handler) => handler(record)))
  }

  /** 本地修改：立即生效并下发到机器 */
  function set(path: string, value: unknown) {
    setMany([{ op: 'replace', path, value }])
  }

  function setMany(patches: DatabasePatch[]) {
    if (!patches.length) return
    applyPatches(patches, 'local')
    machineCommands.setDatabase(patches)
  }

  /* ---------------- 读取请求 ---------------- */

  function read(path: string): Promise<unknown> {
    machineCommands.readDatabase(path)
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        const index = pendingReads.findIndex((item) => item.timer === timer)
        if (index >= 0) pendingReads.splice(index, 1)
        resolve(undefined)
      }, READ_TIMEOUT)
      pendingReads.push({ path, timer, resolve })
    })
  }

  /** readdatabase 响应按请求顺序配对 */
  function settleRead(value: unknown) {
    const pending = pendingReads.shift()
    if (!pending) return
    window.clearTimeout(pending.timer)
    pending.resolve(value)
    if (pending.path === '/' || pending.path === '') adoptDatabase(value)
  }

  function adoptDatabase(snapshot: unknown) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return
    data.value = snapshot as Record<string, unknown>
    origin.value = 'remote'
    syncState.value = 'synced'
  }

  /* ---------------- 连接 ---------------- */

  function connect(target = url.value) {
    const value = target.trim()
    console.log('[database] 连接', value)
    if (!value) return
    url.value = value
    window.localStorage.setItem(STORAGE_KEY, value)
    syncState.value = 'syncing'
    wsClient.connect(value)
  }

  function disconnect() {
    wsClient.disconnect()
    syncState.value = 'idle'
  }

  async function pullAll() {
    syncState.value = 'syncing'
    const snapshot = await read('')
    if (snapshot === undefined) syncState.value = 'failed'
  }

  function handleMessage(message: Record<string, unknown>) {
    const name = typeof message.event === 'string' ? message.event : ''

    if (name === 'database') {
      const patches = Array.isArray(message.data) ? (message.data as DatabasePatch[]) : []
      applyPatches(patches, 'remote')
      return
    }

    if (name === 'readdatabase') {
      settleRead(message.data)
      return
    }

    if (CONSUMED_EVENTS.has(name)) return

    eventLog.value = [
      { event: name || '(无 event 字段)', at: Date.now(), payload: message },
      ...eventLog.value,
    ].slice(0, LOG_LIMIT)
  }

  function init() {
    if (initialized) return
    initialized = true

    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) url.value = stored

    wsClient.onStatus((detail) => {
      connection.value = detail
      if (detail.status === 'open') void pullAll()
      if (detail.status === 'closed' && syncState.value === 'syncing') syncState.value = 'failed'
    })

    wsClient.onMessage(handleMessage)
  }

  return {
    data,
    origin,
    url,
    connection,
    syncState,
    patchLog,
    eventLog,
    connected,
    dataVersion,
    get,
    getNumber,
    getString,
    getBoolean,
    onPatch,
    applyPatches,
    set,
    setMany,
    read,
    connect,
    disconnect,
    pullAll,
    init,
  }
})
