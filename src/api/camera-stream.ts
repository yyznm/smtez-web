import { machineCommands } from './machine-commands'

/** 解码后的画面：JPEG 得到位图，裸图像直接给 ImageData */
export type CameraFrameSource = ImageBitmap | HTMLImageElement | ImageData

export interface CameraFrame {
  cameraId: number
  image: CameraFrameSource
}

/** 画面失败原因，用于界面直接提示 */
export interface CameraFailure {
  cameraId: number
  message: string
}

/** 单路相机的解码频率上限：机器持续推流，来不及处理的帧直接丢弃 */
const MIN_FRAME_INTERVAL = 60
/** 单帧上限，超过视为数据异常 */
const MAX_FRAME_BYTES = 8 * 1024 * 1024
/** JPEG 起始标记允许出现在头部若干字节之后（兼容包头） */
const HEADER_SCAN = 64
/** 裸图像允许的包头长度 */
const RAW_HEADER_MAX = 32
/** 裸图像通道顺序，若画面红蓝颠倒改为 'bgr' */
const RAW_CHANNEL_ORDER: 'rgb' | 'bgr' = 'rgb'

const SOI = [0xff, 0xd8, 0xff]
const EOI = [0xff, 0xd9]

type FrameKind = 'jpeg' | 'raw'

/** JPEG 解码：JPEG Blob → createImageBitmap，不支持时回退到 Image */
export function bufferToImg(buffer: ArrayBuffer | Uint8Array): Promise<CameraFrameSource> {
  const blob = new Blob([buffer as BlobPart], { type: 'image/jpeg' })
  if ('createImageBitmap' in window) {
    return createImageBitmap(blob)
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // 回退路径的对象地址在图解码完成后释放
      window.setTimeout(() => URL.revokeObjectURL(img.src), 1000)
      resolve(img)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(blob)
  })
}

function matches(bytes: Uint8Array, magic: number[], at: number): boolean {
  if (at + magic.length > bytes.length) return false
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[at + i] !== magic[i]) return false
  }
  return true
}

function indexOf(bytes: Uint8Array, magic: number[], from: number, to: number): number {
  const end = Math.min(to, bytes.length)
  for (let i = from; i + magic.length <= end; i += 1) {
    if (matches(bytes, magic, i)) return i
  }
  return -1
}

/** 从任意二进制中抠出完整 JPEG（兼容包头、包尾、分片拼接后的数据） */
function extractJpeg(bytes: Uint8Array): Uint8Array | null {
  const start = indexOf(bytes, SOI, 0, HEADER_SCAN)
  if (start < 0) return null
  // 熵编码段不会出现裸的 FF D9，因此第一个结束标记就是本帧结尾
  const end = indexOf(bytes, EOI, start + SOI.length, bytes.length)
  if (end < 0) return null
  return bytes.subarray(start, end + EOI.length)
}

/** 出现了 JPEG 起始标记但还没收到结束标记，说明这一帧还没传完 */
function isJpegPending(bytes: Uint8Array): boolean {
  const start = indexOf(bytes, SOI, 0, HEADER_SCAN)
  return start >= 0 && indexOf(bytes, EOI, start + SOI.length, bytes.length) < 0
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const merged = new Uint8Array(a.length + b.length)
  merged.set(a)
  merged.set(b, a.length)
  return merged
}

function hex(bytes: Uint8Array, count: number): string {
  return Array.from(bytes.subarray(0, count))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ')
}

/** 按相机分辨率还原裸图像（兼容小段包头） */
function toImageData(bytes: Uint8Array, size?: { width: number; height: number }): ImageData | null {
  if (!size) return null
  const pixels = size.width * size.height

  for (const channels of [4, 3]) {
    const required = pixels * channels
    const offset = bytes.length - required
    if (offset < 0 || offset > RAW_HEADER_MAX) continue

    const source = offset ? bytes.subarray(offset) : bytes
    const image = new ImageData(size.width, size.height)
    const target = image.data
    const swap = channels === 3 && RAW_CHANNEL_ORDER === 'bgr'

    for (let index = 0; index < pixels; index += 1) {
      const from = index * channels
      const to = index * 4
      target[to] = swap ? source[from + 2] : source[from]
      target[to + 1] = source[from + 1]
      target[to + 2] = swap ? source[from] : source[from + 2]
      target[to + 3] = channels === 4 ? source[from + 3] : 255
    }
    return image
  }
  return null
}

function describeFailure(bytes: Uint8Array, size?: { width: number; height: number }): string {
  const parts = [`无法识别画面数据（${bytes.length} 字节，头部 ${hex(bytes, 8)}`]
  if (size) parts.push(`，相机 ${size.width}×${size.height}`)
  parts.push('）')
  return parts.join('')
}

async function decodeFrame(
  bytes: Uint8Array,
  kind: FrameKind,
  size?: { width: number; height: number },
): Promise<CameraFrameSource> {
  if (kind === 'jpeg') return bufferToImg(bytes)
  const raw = toImageData(bytes, size)
  if (raw) return raw
  throw new Error(describeFailure(bytes, size))
}

function closeSource(source: CameraFrameSource | undefined) {
  if (source && typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
    source.close()
  }
}

/**
 * 相机画面流：把 WebSocket 二进制帧解码为可绘制的画面。
 * 兼容三种情况：单片 JPEG、分片拼接的 JPEG、按分辨率还原的裸图像。
 */
class CameraStream {
  #handler: ((frame: CameraFrame) => void) | null = null
  #failureHandler: ((failure: CameraFailure) => void) | null = null
  readonly #latest = new Map<number, CameraFrameSource>()
  readonly #failures = new Map<number, string>()
  readonly #sizes = new Map<number, { width: number; height: number }>()
  /** 正在拼接中的 JPEG 分片 */
  #pending: Uint8Array | null = null
  #current = -1
  #lastFrameAt = 0
  #decoding = false

  /** 已解码帧数，用于界面反馈推流是否真的在跑 */
  received = 0

  onFrame(handler: (frame: CameraFrame) => void) {
    this.#handler = handler
  }

  onFailure(handler: (failure: CameraFailure) => void) {
    this.#failureHandler = handler
  }

  /** 登记相机分辨率，用于还原裸图像帧 */
  setCameraSize(cameraId: number, width: number, height: number) {
    if (width > 0 && height > 0) this.#sizes.set(cameraId, { width, height })
  }

  /** 启动推流 */
  start(cameraId: number) {
    this.#current = cameraId
    this.#pending = null
    this.#decoding = false
    this.#lastFrameAt = 0
    this.#failures.delete(cameraId)
    machineCommands.receiveImage(cameraId)
  }

  /** 本地停止渲染（协议未提供停止指令，多余的帧会被丢弃） */
  stop() {
    this.#current = -1
    this.#pending = null
  }

  /** 处理一帧二进制数据 */
  handleBinary(buffer: ArrayBuffer) {
    const cameraId = this.#current
    if (cameraId < 0 || this.#decoding) return

    const chunk = new Uint8Array(buffer)
    if (!chunk.length) return

    const bytes = this.#pending ? concat(this.#pending, chunk) : chunk
    const jpeg = extractJpeg(bytes)

    if (jpeg) {
      this.#pending = null
      this.#schedule(cameraId, jpeg, 'jpeg')
      return
    }

    if (isJpegPending(bytes)) {
      // 这一帧还没传完，继续等后续分片
      if (bytes.length > MAX_FRAME_BYTES) {
        this.#pending = null
        this.#report(cameraId, `画面数据异常（已接收 ${bytes.length} 字节仍未结束）`)
      } else {
        this.#pending = bytes
      }
      return
    }

    this.#pending = null
    this.#schedule(cameraId, bytes, 'raw')
  }

  #schedule(cameraId: number, bytes: Uint8Array, kind: FrameKind) {
    const now = performance.now()
    if (now - this.#lastFrameAt < MIN_FRAME_INTERVAL) return
    this.#lastFrameAt = now
    void this.#decode(cameraId, bytes, kind)
  }

  async #decode(cameraId: number, bytes: Uint8Array, kind: FrameKind) {
    this.#decoding = true
    try {
      const image = await decodeFrame(bytes, kind, this.#sizes.get(cameraId))
      // 解码期间切换了相机，直接丢弃
      if (cameraId !== this.#current) {
        closeSource(image)
        return
      }
      const previous = this.#latest.get(cameraId)
      this.#latest.set(cameraId, image)
      this.#failures.delete(cameraId)
      this.received += 1
      // 首帧记录实际格式，便于核对协议
      if (import.meta.env.DEV && this.received === 1) {
        console.debug('[camera] 首帧', { kind, length: bytes.length, head: hex(bytes, 12) })
      }
      this.#handler?.({ cameraId, image })
      closeSource(previous)
    } catch (error) {
      const detail = error instanceof Error && error.message ? error.message : '未知错误'
      this.#report(cameraId, detail, bytes)
    } finally {
      this.#decoding = false
    }
  }

  /** 机器持续推流，重复的失败只在原因变化时打日志 */
  #report(cameraId: number, message: string, bytes?: Uint8Array) {
    if (this.#failures.get(cameraId) !== message) {
      console.warn('[camera]', message, bytes ? `尾部 ${hex(bytes.slice(-4), 4)}` : '')
    }
    this.#failures.set(cameraId, message)
    this.#failureHandler?.({ cameraId, message })
  }
}

export const cameraStream = new CameraStream()
