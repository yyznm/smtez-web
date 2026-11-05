export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed'

export interface WsStatusDetail {
  status: WsStatus
  url: string
  retries: number
  error?: string
}

type MessageHandler = (message: Record<string, unknown>) => void
type BinaryHandler = (buffer: ArrayBuffer) => void
type StatusHandler = (detail: WsStatusDetail) => void

const MAX_QUEUE = 100
const MAX_DELAY = 10000

/**
 * 上位机按 JSON 字面区分 int / double：整数值会被当成 int，
 * 飞达的坐标 / 尺寸 / 角度 / 高度这些字段要求小数，序列化时补成 0.0 / -14.0 形式。
 */
const FEEDER_FLOAT_PATTERN =
  /"(part_0_r|part_0_z|part_r|part_z|pos_0_[xyz]|pos_[123]_[xyz]|tmp_pos0_[12]_[xyz]|feederz|pr|[xyzwrh])":(-?\d+)(?=[,}])/g
const FLOAT_FIELD_PATTERN =
  /"(part_0_r|part_0_z|part_r|part_z|pos_1_z|pos_2_z|pos_3_z)":(-?\d+)(?=[,}])/g

/** 是否飞达相关的数据库补丁：新增 `/feeders/-` 或改 `/feeders/<i>/...` */
function isFeederPatch(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  const value = (payload as { value?: unknown }).value
  if (!Array.isArray(value)) return false
  return value.some(
    (item) =>
      typeof (item as { path?: unknown })?.path === 'string' &&
      /^\/feeders(\/|$)/.test((item as { path: string }).path),
  )
}

function stringify(payload: unknown): string {
  const text = JSON.stringify(payload)
  const pattern = isFeederPatch(payload) ? FEEDER_FLOAT_PATTERN : FLOAT_FIELD_PATTERN
  return text.replace(pattern, '"$1":$2.0')
}

/**
 * 与贴片机插件服务通信的 WebSocket 客户端。
 * - 文本帧：JSON 指令与事件
 * - 二进制帧：相机画面
 * - 断线自动重连（指数退避），未连接时的指令进入队列
 */
export class WsClient {
  #socket: WebSocket | null = null
  #url = ''
  #retries = 0
  #timer = 0
  #queue: string[] = []
  #manualClose = false
  #detail: WsStatusDetail = { status: 'idle', url: '', retries: 0 }

  readonly #messageHandlers = new Set<MessageHandler>()
  readonly #binaryHandlers = new Set<BinaryHandler>()
  readonly #statusHandlers = new Set<StatusHandler>()

  get detail(): WsStatusDetail {
    return this.#detail
  }

  get connected(): boolean {
    return this.#socket?.readyState === WebSocket.OPEN
  }

  connect(url: string, isRetry = false): void {
    const target = url.trim()
    if (!target) return
    if (this.#socket && this.#url === target && this.#detail.status !== 'closed') return

    this.closeSocket()
    this.#url = target
    this.#manualClose = false
    // 手动发起的连接视为新一轮尝试，重试计数与指数退避重新开始
    if (!isRetry) this.#retries = 0
    this.#emitStatus('connecting')

    try {
      const socket = new WebSocket(target)
      socket.binaryType = 'arraybuffer'
      this.#socket = socket

      socket.onopen = () => {
        this.#retries = 0
        this.#emitStatus('open')
        this.flush()
      }

      socket.onmessage = (event) => this.#handleMessage(event)

      socket.onerror = () => {
        this.#detail = { ...this.#detail, error: '连接异常' }
      }

      socket.onclose = (event) => {
        this.#socket = null
        this.#emitStatus('closed', event.reason || undefined)
        if (!this.#manualClose) this.#scheduleReconnect()
      }
    } catch (error) {
      this.#socket = null
      this.#emitStatus('closed', error instanceof Error ? error.message : '无法建立连接')
      this.#scheduleReconnect()
    }
  }

  disconnect(): void {
    this.#manualClose = true
    window.clearTimeout(this.#timer)
    this.#timer = 0
    this.#retries = 0
    this.#queue = []
    this.closeSocket()
    this.#emitStatus('idle')
  }

  /** 发送 JSON 指令；未连接时入队等待重连 */
  send(payload: unknown): boolean {
    const text = stringify(payload)
    if (this.connected && this.#socket) {
      this.#socket.send(text)
      return true
    }
    if (this.#queue.length < MAX_QUEUE) this.#queue.push(text)
    return false
  }

  onMessage(handler: MessageHandler): () => void {
    this.#messageHandlers.add(handler)
    return () => this.#messageHandlers.delete(handler)
  }

  onBinary(handler: BinaryHandler): () => void {
    this.#binaryHandlers.add(handler)
    return () => this.#binaryHandlers.delete(handler)
  }

  onStatus(handler: StatusHandler): () => void {
    this.#statusHandlers.add(handler)
    handler(this.#detail)
    return () => this.#statusHandlers.delete(handler)
  }

  private flush(): void {
    if (!this.#socket) return
    const pending = this.#queue
    this.#queue = []
    for (const text of pending) this.#socket.send(text)
  }

  private closeSocket(): void {
    const socket = this.#socket
    this.#socket = null
    if (!socket) return
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close()
  }

  #handleMessage(event: MessageEvent): void {
    const { data } = event
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        this.#messageHandlers.forEach((handler) => handler(parsed))
      } catch {
        // 非 JSON 文本帧直接忽略
      }
      return
    }
    if (data instanceof ArrayBuffer) {
      this.#binaryHandlers.forEach((handler) => handler(data))
    }
  }

  #scheduleReconnect(): void {
    if (this.#manualClose) return
    window.clearTimeout(this.#timer)
    const delay = Math.min(1000 * 2 ** this.#retries, MAX_DELAY)
    this.#retries += 1
    this.#detail = { ...this.#detail, retries: this.#retries }
    this.#timer = window.setTimeout(() => this.connect(this.#url, true), delay)
  }

  #emitStatus(status: WsStatus, error?: string): void {
    this.#detail = { status, url: this.#url, retries: this.#retries, error }
    this.#statusHandlers.forEach((handler) => handler(this.#detail))
  }
}

export const wsClient = new WsClient()
