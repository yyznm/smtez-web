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
/** 已由其他模块消费的事件（位置/设备状态/消息由 machine 处理，Counter 由 overview 处理），不计入未识别日志 */
const CONSUMED_EVENTS = new Set(['PostionChange', 'status', 'msg', 'Counter'])

/** 未填端口时使用的默认端口 */
export const DEFAULT_PORT = 9002

/**
 * 默认地址：优先取环境变量；否则用当前页面地址的 IP 加默认端口
 * （页面本身就由贴片机上的插件服务提供，当前 IP 通常就是贴片机地址）
 */
function defaultUrl(): string {
  const override = import.meta.env.VITE_WS_URL
  if (typeof override === 'string' && override) return override
  const host = window.location.hostname
  return host ? `${host}:${DEFAULT_PORT}` : ''
}

/** 只填 ip 或 ip:端口 也能连：连接时补上缺失的 ws:// 与默认端口 */
function normalizeUrl(input: string): string {
  const raw = input.trim()
  if (!raw) return ''
  const withScheme = /^wss?:\/\//i.test(raw) ? raw : `ws://${raw}`
  const matched = /^(wss?):\/\/([^/?#]+)(.*)$/i.exec(withScheme)
  if (!matched) return withScheme
  const [, scheme, hostPort, rest] = matched
  const host = /:\d+$/.test(hostPort) ? hostPort : `${hostPort}:${DEFAULT_PORT}`
  return `${scheme}://${host}${rest}`
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
  /** 设置里原样保存用户填写的内容，连接时才拼接缺失的参数 */
  const address = ref(defaultUrl())
  /** init 是否已执行完（读过本地存储），界面可据此判断地址是否真的为空 */
  const ready = ref(false)
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

  /** 只下发给机器，不本地应用：等机器回传 database 事件再更新本地 */
  function send(patches: DatabasePatch[]): boolean {
    if (!patches.length) return false
    return machineCommands.setDatabase(patches)
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

  function connect(target = address.value) {
    const raw = target.trim()
    if (!raw) return
    // 用户填什么就存什么，只有建立连接时才补全缺失的协议与端口
    address.value = raw
    url.value = normalizeUrl(raw)
    window.localStorage.setItem(STORAGE_KEY, raw)
    console.log('[database] 连接', url.value)
    syncState.value = 'syncing'
    wsClient.connect(url.value)
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
    if (stored) {
      // 存的是用户填写的原文，连接用的完整地址在这里补全
      address.value = stored
      url.value = normalizeUrl(stored)
    }

    wsClient.onStatus((detail) => {
      connection.value = detail
      if (detail.status === 'open') void pullAll()
      if (detail.status === 'closed' && syncState.value === 'syncing') syncState.value = 'failed'
    })

    wsClient.onMessage(handleMessage)
    ready.value = true
  }

  return {
    data,
    origin,
    url,
    ready,
    connection,
    syncState,
    patchLog,
    eventLog,
    connected,
    dataVersion,
    address,
    get,
    getNumber,
    getString,
    getBoolean,
    onPatch,
    applyPatches,
    set,
    setMany,
    send,
    read,
    connect,
    disconnect,
    pullAll,
    init,
  }
})
