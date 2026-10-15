import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { cameraStream, type CameraFrameSource } from '@/api/camera-stream'
import { machineCommands } from '@/api/machine-commands'
import { wsClient } from '@/api/ws-client'
import { useDatabaseStore } from '@/stores/database'
import { useNotifyStore, type MessageTone } from '@/stores/notify'
import type { AxisKey, JogAxis } from '@/types'
import type { DbCamera, DbHeadNozzle } from '@/types/database'

/** 步进档位（mm），索引即 /setting/stepValue 的取值：0→0.01 … 4→100 */
export const STEP_VALUES = [0.01, 0.1, 1, 10, 100]
/** 界面展示用的档位（从大到小） */
export const STEP_PRESETS = [...STEP_VALUES].reverse()
/** 速度刻度（%） */
export const SPEED_TICKS = [100, 75, 50, 25, 1]

/** 位置未知时保持 null，界面显示 -- */
type AxisPosition = Record<AxisKey, number | null>

/** 串口对应的设备名（serials 数组下标） */
const SERIAL_LABELS = ['机器主板', '顶部控制板']

/** 消息事件 status 到提示样式的映射 */
const MESSAGE_TONES: Record<string, MessageTone> = {
  info: 'info',
  normal: 'info',
  ok: 'ok',
  success: 'ok',
  warn: 'warn',
  warning: 'warn',
  except: 'danger',
  error: 'danger',
  fail: 'danger',
  failure: 'danger',
}

const round = (v: number) => Math.round(v * 1000) / 1000

const toNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const toBooleans = (value: unknown): boolean[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'boolean')
    ? (value as boolean[])
    : null

/** 头部吸嘴槽位（来自数据库 /headnozzles 中启用的项） */
export interface NozzleOption {
  /** 列表下标，也用于界面选中态 */
  index: number
  /** 槽位名，如 N0 */
  slot: string
  /** 指令中的吸嘴 id */
  id: number
  /** 吸嘴型号，如 CN140 */
  nozzleid: string
}

export interface CameraOption {
  id: number
  label: string
}

/** 设备链路状态 */
export interface DeviceStatus {
  id: string
  label: string
  online: boolean
}

const slotNumber = (slot: string) => {
  const value = Number(slot.replace(/\D/g, ''))
  return Number.isFinite(value) ? value : 0
}

export const useMachineStore = defineStore('machine', () => {
  const database = useDatabaseStore()
  const notify = useNotifyStore()

  /** 机器上报的位置（PostionChange 事件） */
  const pos = reactive<AxisPosition>({ x: null, y: null, z1: null, z2: null, r1: null, r2: null })
  /** 设备链路状态（status 事件） */
  const linkStatus = reactive<{ serials: boolean[]; cameras: boolean[] }>({
    serials: [],
    cameras: [],
  })

  const nozzleIndex = ref(0)
  const cameraId = ref(0)
  /** 实时画面是否开启 */
  const cameraActive = ref(false)
  /** 当前相机灯光是否开启 */
  const cameraLight = ref(true)
  /** 各相机最新的解码画面 */
  const frames = reactive<Record<number, CameraFrameSource>>({})
  /** 各相机的失败原因 */
  const cameraFailures = reactive<Record<number, string>>({})

  /* ---------------- 数据库驱动的设置 ---------------- */

  /** /setting/stepValue 存的是档位索引，这里换算成 mm */
  const stepIndex = computed(() => {
    const index = Math.round(database.getNumber('/setting/stepValue', 2))
    return Math.min(STEP_VALUES.length - 1, Math.max(0, index))
  })
  const step = computed(() => STEP_VALUES[stepIndex.value] ?? 1)
  const speedPercent = computed(() =>
    Math.round(database.getNumber('/setting/machineSpeed', 0.15) * 100),
  )

  const nozzleOptions = computed<NozzleOption[]>(() => {
    const raw = database.get<Record<string, DbHeadNozzle>>('/headnozzles', {})
    return Object.keys(raw)
      .filter((slot) => raw[slot]?.enable)
      .sort((a, b) => slotNumber(a) - slotNumber(b))
      .map((slot, index) => ({
        index,
        slot,
        id: slotNumber(slot),
        nozzleid: raw[slot].nozzleid,
      }))
  })

  const activeNozzle = computed<NozzleOption | undefined>(
    () => nozzleOptions.value[nozzleIndex.value] ?? nozzleOptions.value[0],
  )

  const cameraOptions = computed<CameraOption[]>(() =>
    database.get<DbCamera[]>('/cameras', []).map((_item, index) => ({
      id: index,
      label: index === 0 ? '顶部' : `底部${index}`,
    })),
  )

  const cameraDeviceLabel = (index: number) =>
    index === 0 ? '顶部相机' : index === 1 ? '底部相机' : `底部${index}相机`

  const serialLabel = (index: number) => SERIAL_LABELS[index] ?? `串口${index + 1}`

  /**
   * 设备链路状态，来源为机器下发的 status 事件：
   * { event: 'status', serials: [bool, bool], cameras: [bool, bool], cfg: bool }
   * 未收到事件前点显示为灰色（未知）。
   */
  const devices = computed<DeviceStatus[]>(() => {
    const list: DeviceStatus[] = []

    const serialCount = Math.max(linkStatus.serials.length, SERIAL_LABELS.length)
    for (let index = 0; index < serialCount; index += 1) {
      list.push({
        id: `serial-${index}`,
        label: serialLabel(index),
        online: linkStatus.serials[index] ?? false,
      })
    }

    const cameraCount = Math.max(linkStatus.cameras.length, cameraOptions.value.length)
    for (let index = 0; index < cameraCount; index += 1) {
      list.push({
        id: `camera-${index}`,
        label: cameraDeviceLabel(index),
        online: linkStatus.cameras[index] ?? false,
      })
    }

    return list
  })

  /**
   * Z1 / Z2 两轴方向相反：同一高度 Z1 读到 10、Z2 就是 -10。
   * 上报值时把另一个吸嘴取反同步；点动仍操作当前吸嘴自己的 Z 轴。
   */
  const activeZ = computed<AxisKey>(() => (nozzleIndex.value === 0 ? 'z1' : 'z2'))
  const activeR = computed<AxisKey>(() => (nozzleIndex.value === 0 ? 'r1' : 'r2'))

  /** 当前相机的失败原因；没有画面时界面直接提示 */
  const cameraError = computed(
    () => cameraFailures[cameraId.value] ?? (database.connected ? null : '服务站未连接'),
  )

  /* ---------------- 速度：本地即时反馈 + 防抖写库 ---------------- */

  const speedDraft = ref<number | null>(null)
  const speed = computed(() => speedDraft.value ?? speedPercent.value)
  let speedTimer = 0

  function setSpeed(percent: number) {
    const value = Math.round(Math.min(100, Math.max(1, percent)))
    speedDraft.value = value
    window.clearTimeout(speedTimer)
    speedTimer = window.setTimeout(() => {
      database.set('/setting/machineSpeed', value / 100)
      speedDraft.value = null
    }, 260)
  }

  /* ---------------- 运动 ---------------- */

  function jog(axis: JogAxis, dir: 1 | -1) {
    const nozzle = activeNozzle.value?.id ?? 0

    if (axis === 'x' || axis === 'y') {
      const delta = round(dir * step.value)
      if (axis === 'x') machineCommands.moveX(delta)
      else machineCommands.moveY(delta)
      return
    }

    if (axis === 'z') {
      machineCommands.moveZ(nozzle, round(dir * step.value))
      return
    }

    machineCommands.moveR(nozzle, dir * step.value)
  }

  /** 头部绝对移动到指定坐标 */
  function headTo(x: number, y: number) {
    machineCommands.moveTo(x, y)
  }

  /** 停靠到数据库中的停机坐标 */
  function park() {
    headTo(
      database.getNumber('/setting/onstoppositon_x', 0),
      database.getNumber('/setting/onstoppositon_y', 180),
    )
  }

  /** 回到原点 */
  function goOrigin() {
    machineCommands.home(false)
  }

  /** 复位（硬复位） */
  function reset() {
    machineCommands.home(true)
  }

  /** 当前吸嘴 Z 轴归零 */
  function resetZ() {
    machineCommands.moveNozzleTo(activeNozzle.value?.id ?? 0, 0)
  }

  /** 当前吸嘴旋转归零 */
  function resetR() {
    machineCommands.moveNozzleRotateTo(activeNozzle.value?.id ?? 0, 0)
  }

  /* ---------------- 贴片任务 ---------------- */

  /** 开始贴片 */
  function startPlacement() {
    machineCommands.startPlacement()
  }

  /** 重复贴片 */
  function repeatPlacement() {
    machineCommands.repeatPlacement()
  }

  /** 停止贴片 */
  function stopPlacement() {
    machineCommands.stopPlacement()
  }

  /** 紧急停机 */
  function emergencyStop() {
    machineCommands.emergencyStop()
  }

  /** 校准：对指定板（含子板）做基准点检查 */
  function fiducialCheck(board: number, childboard = 0, global = true) {
    machineCommands.fiducialCheck(board, childboard, global)
  }

  /* ---------------- 吸嘴 / 头部对位 ---------------- */

  /** 移动头部（相机）到当前吸嘴位置 */
  function cameraToNozzle() {
    machineCommands.cameraToNozzle(activeNozzle.value?.id ?? 0)
  }

  /** 移动当前吸嘴到头部（相机）位置 */
  function nozzleToCamera() {
    machineCommands.nozzleToCamera(activeNozzle.value?.id ?? 0)
  }

  /* ---------------- 设置 ---------------- */

  /** 入参是步进值（mm），写入数据库时换算回档位索引 */
  function setStepValue(value: number) {
    const index = STEP_VALUES.indexOf(value)
    if (index < 0) return
    database.set('/setting/stepValue', index)
  }

  function setNozzle(index: number) {
    nozzleIndex.value = index
  }

  /* ---------------- 相机 ---------------- */

  function syncCameraSizes() {
    database.get<DbCamera[]>('/cameras', []).forEach((item, index) => {
      if (item?.width && item?.height) cameraStream.setCameraSize(index, item.width, item.height)
    })
  }

  function startCamera(id = cameraId.value) {
    const available = cameraOptions.value
    if (available.length && !available.some((item) => item.id === id)) return
    cameraId.value = id
    syncCameraSizes()
    cameraStream.start(id)
    if (cameraLight.value) machineCommands.setLight(id, true)
    cameraActive.value = true
  }

  function stopCamera() {
    cameraStream.stop()
    // 关掉实时画面后不保留上一帧，避免看起来还在直播
    delete frames[cameraId.value]
    cameraActive.value = false
  }

  /** 开关实时画面 */
  function toggleCamera() {
    if (cameraActive.value) stopCamera()
    else startCamera()
  }

  function setCameraLight(value: boolean) {
    cameraLight.value = value
    machineCommands.setLight(cameraId.value, value)
  }

  function setCamera(id: number) {
    if (id === cameraId.value) return
    if (cameraActive.value) {
      startCamera(id)
      return
    }
    cameraId.value = id
    if (cameraLight.value) machineCommands.setLight(id, true)
  }

  /* ---------------- 机器上报 ---------------- */

  /**
   * 位置上报：
   * { event: 'PostionChange', x, y }             头部坐标
   * { event: 'PostionChange', id, z }            吸嘴高度
   * { event: 'PostionChange', id, r }            吸嘴角度
   */
  function applyPosition(message: Record<string, unknown>) {
    const x = toNumber(message.x)
    const y = toNumber(message.y)
    if (x !== null) pos.x = round(x)
    if (y !== null) pos.y = round(y)

    const nozzle = toNumber(message.id)
    if (nozzle === 0 || nozzle === 1) {
      const z = toNumber(message.z)
      const r = toNumber(message.r)
      if (z !== null) {
        // 两个吸嘴方向相反的，更新一个的同时把另一个取反同步过去
        pos[nozzle === 0 ? 'z1' : 'z2'] = round(z)
        pos[nozzle === 0 ? 'z2' : 'z1'] = round(-z)
      }
      if (r !== null) pos[nozzle === 0 ? 'r1' : 'r2'] = round(r)
    }
  }

  /**
   * 设备链路状态：{ event: 'status', serials: [bool, bool], cameras: [bool, bool], cfg: bool }
   */
  function applyStatus(message: Record<string, unknown>) {
    const serials = toBooleans(message.serials)
    const cameras = toBooleans(message.cameras)
    if (serials) linkStatus.serials = serials
    if (cameras) linkStatus.cameras = cameras
  }

  /**
   * 机器消息：{ event: 'msg', status: 'except', text: '轴没有复位,需要回HOME点', showtime: 3 }
   */
  function applyMessage(message: Record<string, unknown>) {
    const text = typeof message.text === 'string' ? message.text : ''
    if (!text.trim()) return
    const status = typeof message.status === 'string' ? message.status.toLowerCase() : ''
    const showtime = toNumber(message.showtime)
    notify.push(text, MESSAGE_TONES[status] ?? 'info', showtime ?? undefined)
  }

  wsClient.onMessage((message) => {
    if (message.event === 'PostionChange') applyPosition(message)
    else if (message.event === 'status') applyStatus(message)
    else if (message.event === 'msg') applyMessage(message)
  })

  cameraStream.onFrame((incoming) => {
    frames[incoming.cameraId] = incoming.image
    delete cameraFailures[incoming.cameraId]
  })

  cameraStream.onFailure((failure) => {
    cameraFailures[failure.cameraId] = failure.message
  })

  return {
    pos,
    step,
    speed,
    nozzleIndex,
    nozzleOptions,
    activeNozzle,
    cameraId,
    cameraActive,
    cameraLight,
    frames,
    cameraFailures,
    cameraError,
    cameraOptions,
    devices,
    activeZ,
    activeR,
    jog,
    park,
    goOrigin,
    reset,
    resetR,
    headTo,
    resetZ,
    startPlacement,
    repeatPlacement,
    stopPlacement,
    emergencyStop,
    fiducialCheck,
    cameraToNozzle,
    nozzleToCamera,
    setStepValue,
    setSpeed,
    setNozzle,
    startCamera,
    stopCamera,
    toggleCamera,
    setCamera,
    setCameraLight,
    syncCameraSizes,
  }
})
