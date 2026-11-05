import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { machineCommands } from '@/api/machine-commands'
import { useDatabaseStore } from '@/stores/database'
import { useMachineStore } from '@/stores/machine'
import type { DbFeeder, DbFeederData, DbFeederPoint, FeederType } from '@/types/database'

/** 飞达列表筛选 */
export type FeederFilter = 'all' | 'manualauto' | 'strip' | 'tray' | 'loose'

/** 飞达类型对应的界面名称 */
export const FEEDER_TYPE_LABELS: Record<string, string> = {
  manualautofeeder: '自动',
  stripfeeder: '料带',
  trayfeeder: '托盘',
  loosepartsfeeder: '散料',
}

/** 料带剩余比例低于该值视为即将用完（与设置里的预警比例一致） */
const LOW_PERCENT = 10

/** 影响料带取料点排布的字段 */
const STRIP_GEOMETRY_KEYS = [
  'tmp_pos0_1_x',
  'tmp_pos0_1_y',
  'tmp_pos0_2_x',
  'tmp_pos0_2_y',
  'part_0_dis',
  'part_0_r',
  'part_0_z',
]

/** 影响托盘取料点排布的字段 */
const TRAY_GEOMETRY_KEYS = [
  'pos_1_x',
  'pos_1_y',
  'pos_2_x',
  'pos_2_y',
  'pos_3_x',
  'pos_3_y',
  'count_x',
  'count_y',
  'partcount',
  'part_r',
  'part_z',
]

/** 角度归一化到 (-180, 180]，保留全精度 */
const normalizeAngle = (angle: number) => ((angle % 360) + 540) % 360 - 180

/**
 * 按 坐标A → 坐标B、间距、角度 重算料带取料点：
 * 先用「间距」算出分段数（round(|AB| / 间距)），再把 A→B 均分，
 * 这样最后一个点正好落在坐标B（与机器生成的结果一致）；
 * 每个点的角度 = AB 方向角 + 90 + 角度。
 */
function buildStripParts(data: DbFeederData): DbFeederPoint[] | null {
  const ax = Number(data.tmp_pos0_1_x)
  const ay = Number(data.tmp_pos0_1_y)
  const bx = Number(data.tmp_pos0_2_x)
  const by = Number(data.tmp_pos0_2_y)
  if (![ax, ay, bx, by].every((value) => Number.isFinite(value))) return null

  const dis = Number(data.part_0_dis)
  const angle = Number(data.part_0_r) || 0
  const z = Number(data.part_0_z) || 0
  const dx = bx - ax
  const dy = by - ay
  const length = Math.hypot(dx, dy)
  const r = normalizeAngle((Math.atan2(dy, dx) * 180) / Math.PI + 90 + angle)

  // 间距无效或 A、B 重合时只保留一个点
  if (!(dis > 0) || length === 0) return [{ x: ax, y: ay, z, r }]

  const segments = Math.max(1, Math.round(length / dis))
  const pitch = length / segments
  const ux = dx / length
  const uy = dy / length

  return Array.from({ length: segments + 1 }, (_, index) =>
    index === segments
      ? { x: bx, y: by, z, r }
      : { x: ax + ux * pitch * index, y: ay + uy * pitch * index, z, r },
  )
}

/** 料带取料点：parts[0] 为一条料带的全部孔位 */
function holeCount(data: DbFeederData): number {
  const strips = data.parts
  if (!Array.isArray(strips)) return 0
  const first = strips[0]
  return Array.isArray(first) ? first.length : 0
}

/** 托盘的取料点总数：有最大数量时按最大数量，否则为 X 数量 × Y 数量 */
export function trayTotal(data: DbFeederData): number {
  const nx = Math.max(1, Math.round(Number(data.count_x) || 1))
  const ny = Math.max(1, Math.round(Number(data.count_y) || 1))
  const max = Math.round(Number(data.partcount) || 0)
  return max > 0 ? max : nx * ny
}

/**
 * 按 坐标A / B / C 和 XY 数量 生成托盘取料点：
 * A 为左上、B 为右上、C 为右下，第 4 角由 A + C - B 推出；
 * X 方向沿 A→B，Y 方向沿 A→第四角，按行优先排列。
 * 点数默认 X×Y，设置了最大数量时按最大数量继续往外排（行优先换行）。
 * 每个点的角度 = AB 方向角 + 角度。
 */
function buildTrayParts(data: DbFeederData): DbFeederPoint[] | null {
  const ax = Number(data.pos_1_x)
  const ay = Number(data.pos_1_y)
  const bx = Number(data.pos_2_x)
  const by = Number(data.pos_2_y)
  const cx = Number(data.pos_3_x)
  const cy = Number(data.pos_3_y)
  if (![ax, ay, bx, by, cx, cy].every((value) => Number.isFinite(value))) return null

  const nx = Math.max(1, Math.round(Number(data.count_x) || 1))
  const ny = Math.max(1, Math.round(Number(data.count_y) || 1))
  const total = trayTotal(data)
  const z = Number(data.part_z) || 0
  const r = normalizeAngle(
    (Math.atan2(by - ay, bx - ax) * 180) / Math.PI + (Number(data.part_r) || 0),
  )

  // 第四角（左下）
  const dx = ax + cx - bx
  const dy = ay + cy - by
  const stepX = nx > 1 ? { x: (bx - ax) / (nx - 1), y: (by - ay) / (nx - 1) } : { x: 0, y: 0 }
  const stepY = ny > 1 ? { x: (dx - ax) / (ny - 1), y: (dy - ay) / (ny - 1) } : { x: 0, y: 0 }

  return Array.from({ length: total }, (_, index) => {
    const col = index % nx
    const row = Math.floor(index / nx)
    return {
      x: ax + stepX.x * col + stepY.x * row,
      y: ay + stepX.y * col + stepY.y * row,
      z,
      r,
    }
  })
}

/** 飞达编号：自动飞达取 feederid，缺省时退回名称里的数字 */
function feederIdOf(feeder: DbFeeder): number {
  const fromData = Number(feeder.data?.feederid)
  if (Number.isFinite(fromData) && fromData > 0) return fromData
  const fromName = Number(String(feeder.name ?? '').replace(/\D/g, ''))
  return Number.isFinite(fromName) ? fromName : 0
}

/** 列表行（映射 /feeders[i]） */
export interface FeederView {
  index: number
  path: string
  type: FeederType | string
  typeLabel: string
  /** 元件串原文，如 22kΩ=R0603 */
  part: string
  /** 元件名 */
  value: string
  /** 封装 */
  package: string
  name: string
  label: string
  enable: boolean
  /** 料带孔位总数（其他类型为 0） */
  holes: number
  /** 已使用 */
  used: number
  /** 剩余孔位（料带） */
  remaining: number
  /** 料带已用完 */
  usedUp: boolean
  /** 料带即将用完 */
  low: boolean
  /** 指令里使用的飞达编号 */
  feederId: number
  data: DbFeederData
}

/** 把 元件=封装 拆开，未带等号时整串作为元件名 */
function splitPart(part: string): { value: string; package: string } {
  const index = part.indexOf('=')
  if (index < 0) return { value: part, package: '' }
  return { value: part.slice(0, index), package: part.slice(index + 1) }
}

/** 新飞达 uuid：机器用 int64 标识，随机生成一个足够大的数 */
function newUuid(): number {
  return Math.floor(Math.random() * 1e15)
}

/** 新建飞达的初始 data：坐标全部为 0，进编辑弹窗取点即可 */
function blankData(type: FeederType, feederId: number): DbFeederData {
  const point: DbFeederPoint = { x: 0, y: 0, z: 0, r: 0 }
  if (type === 'manualautofeeder') {
    return {
      count_0: 0,
      usecount_0: 0,
      disablePreTake: false,
      feederid: feederId,
      feedrate: 4,
      minwaittime: 0,
      part_0_dis: 4,
      part_0_r: 0,
      parts: [[point]],
      pos: { x: 0, y: 0, r: 0 },
      pos_0: { ...point },
      tapeCount: 1,
      tapewidth: 0,
    }
  }
  if (type === 'trayfeeder') {
    return {
      count_x: 1,
      count_y: 1,
      partcount: 0,
      usecount: 0,
      disablePreTake: false,
      part_r: 0,
      part_z: 0,
      parts: [point],
      pos: { x: 0, y: 0, z: 0, r: 0 },
      pos_1_x: 0,
      pos_1_y: 0,
      pos_1_z: 0,
      pos_2_x: 0,
      pos_2_y: 0,
      pos_2_z: 0,
      pos_3_x: 0,
      pos_3_y: 0,
      pos_3_z: 0,
    }
  }
  if (type === 'loosepartsfeeder') {
    return {
      count_0: 0,
      usecount_0: 0,
      disablePreTake: false,
      enableUpLight: false,
      enableBacklight: false,
      feederz: 0,
      lastTake_0: 0,
      parts: [{ x: 0, y: 0, w: 0, h: 0, pr: 0, r: 0 }],
      pos: { x: 0, y: 0, w: 0, h: 0, pr: 0, r: 0 },
      tapeCount: 1,
    }
  }
  return {
    count_0: 0,
    usecount_0: 0,
    disablePreTake: false,
    holds: null,
    part_0_dis: 8,
    part_0_r: 0,
    part_0_z: 0,
    parts: [[point]],
    pos: { x: 0, y: 0, r: 0 },
    tmp_pos0_1_x: 0,
    tmp_pos0_1_y: 0,
    tmp_pos0_1_z: 0,
    tmp_pos0_2_x: 0,
    tmp_pos0_2_y: 0,
    tmp_pos0_2_z: 0,
    tapeCount: 1,
    tapewidth: 0,
  }
}

export const useFeederStore = defineStore('feeder', () => {
  const database = useDatabaseStore()
  const machine = useMachineStore()

  const filter = ref<FeederFilter>('all')
  const query = ref('')

  const feeders = computed<FeederView[]>(() =>
    database.get<DbFeeder[]>('/feeders', []).map((feeder, index) => {
      const data = feeder.data ?? {}
      const part = feeder.part ?? ''
      const { value, package: pack } = splitPart(part)
      const isStrip = feeder.type === 'stripfeeder'
      const isTray = feeder.type === 'trayfeeder'
      const holes = isStrip ? holeCount(data) : isTray ? trayTotal(data) : 0
      const used = Number(isTray ? data.usecount : data.usecount_0) || 0
      const remaining = isStrip || isTray ? Math.max(0, holes - used) : 0

      return {
        index,
        path: `/feeders/${index}`,
        type: feeder.type ?? '',
        typeLabel: FEEDER_TYPE_LABELS[feeder.type] ?? feeder.type ?? '未知',
        part,
        value,
        package: pack,
        name: feeder.name ?? '',
        label: feeder.label ?? '',
        enable: Boolean(feeder.enable),
        holes,
        used,
        remaining,
        usedUp: (isStrip || isTray) && holes > 0 && used >= holes,
        low: (isStrip || isTray) && holes > 0 && used < holes && remaining / holes <= LOW_PERCENT / 100,
        feederId: feederIdOf(feeder),
        data,
      }
    }),
  )

  const visibleFeeders = computed(() => {
    const keyword = query.value.trim().toLowerCase()
    return feeders.value.filter((item) => {
      if (filter.value === 'manualauto' && item.type !== 'manualautofeeder') return false
      if (filter.value === 'strip' && item.type !== 'stripfeeder') return false
      if (filter.value === 'tray' && item.type !== 'trayfeeder') return false
      if (filter.value === 'loose' && item.type !== 'loosepartsfeeder') return false
      if (!keyword) return true
      return [item.value, item.package, item.name, item.label, item.part].some((text) =>
        text.toLowerCase().includes(keyword),
      )
    })
  })

  const stats = computed(() => ({
    total: feeders.value.length,
    enabled: feeders.value.filter((item) => item.enable).length,
    usedUp: feeders.value.filter((item) => item.usedUp).length,
  }))

  /* ---------------- 修改 ---------------- */

  /**
   * 新增一台飞达：追加到 /feeders 末尾，坐标留给编辑弹窗取点。
   * 只下发补丁，本地列表等机器回传 database 事件再更新。
   */
  function addFeeder(type: FeederType, value: string, pack: string, feederId = 0): boolean {
    const feeder: DbFeeder = {
      data: blankData(type, feederId),
      enable: true,
      id: '',
      label: '',
      name: type === 'manualautofeeder' && feederId > 0 ? String(feederId) : '',
      part: (pack ? `${value}=${pack}` : value) || '=',
      type,
      uuid: newUuid(),
    }
    // 追加到末尾用 JSON Patch 的 `-`；不本地插入，避免和机器下发的事件重复
    return database.send([{ op: 'add', path: '/feeders/-', value: feeder }])
  }

  function setEnabled(index: number, enabled: boolean) {
    database.set(`/feeders/${index}/enable`, enabled)
  }

  /** 改飞达 data：整块推送，不逐字段下发；料带 / 托盘坐标变化时同步重算 parts */
  function setData(index: number, changes: Record<string, unknown>) {
    const current = database.get<DbFeeder[]>('/feeders', [])[index]?.data ?? {}
    const type = database.get<DbFeeder[]>('/feeders', [])[index]?.type
    const next: DbFeederData = { ...current, ...changes }

    if (type === 'trayfeeder') {
      if (TRAY_GEOMETRY_KEYS.some((key) => key in changes)) {
        const points = buildTrayParts(next)
        if (points) {
          next.parts = points
          // 飞达自身坐标跟着坐标A走
          next.pos = { x: points[0].x, y: points[0].y, z: 0, r: points[0].r ?? 0 }
        }
      }
    } else if (STRIP_GEOMETRY_KEYS.some((key) => key in changes)) {
      const points = buildStripParts(next)
      if (points) {
        next.parts = [points]
        // 飞达自身坐标跟着坐标A走
        next.pos = { x: points[0].x, y: points[0].y, z: 0, r: 0 }
      }
    }

    database.set(`/feeders/${index}/data`, next)
  }

  /** 自动飞达只有一个取料点：改元件坐标时同步 pos 与 parts */
  function setAutoPosition(index: number, changes: { x?: number; y?: number; z?: number }) {
    const current = database.get<DbFeeder[]>('/feeders', [])[index]?.data ?? {}
    const pos0 = current.pos_0 ?? { x: 0, y: 0, z: 0 }
    const position = {
      x: Number.isFinite(changes.x) ? (changes.x as number) : Number(pos0.x) || 0,
      y: Number.isFinite(changes.y) ? (changes.y as number) : Number(pos0.y) || 0,
      z: Number.isFinite(changes.z) ? (changes.z as number) : Number(pos0.z) || 0,
    }
    const first = Array.isArray(current.parts) ? current.parts[0] : undefined
    const point = Array.isArray(first) ? first[0] : undefined

    database.set(`/feeders/${index}/data`, {
      ...current,
      pos_0: position,
      pos: { ...current.pos, x: position.x, y: position.y },
      parts: [[{ ...point, ...position }]],
    })
  }

  /** 飞达角度存在 pos.r 里 */
  function setFeederAngle(index: number, angle: number) {
    const current = database.get<DbFeeder[]>('/feeders', [])[index]?.data ?? {}
    database.set(`/feeders/${index}/data`, {
      ...current,
      pos: { ...current.pos, r: angle },
    })
  }

  /** 散料飞达：中心 / 识别区域 / 元件角度同时写入 pos 与唯一的取料点 */
  function setLoosePoint(index: number, changes: Partial<DbFeederPoint>) {
    const current = database.get<DbFeeder[]>('/feeders', [])[index]?.data ?? {}
    const first = Array.isArray(current.parts) ? current.parts[0] : undefined
    const point = Array.isArray(first) ? {} : (first ?? {})
    database.set(`/feeders/${index}/data`, {
      ...current,
      pos: { ...current.pos, ...changes },
      parts: [{ ...point, ...changes }],
    })
  }

  /** 元件串整体写回，格式仍为 元件=封装 */
  function setPart(index: number, value: string, pack: string) {
    database.set(`/feeders/${index}/part`, pack ? `${value}=${pack}` : value)
  }

  /** 清空已使用数量（更换料带后调用） */
  function resetUsed(index: number) {
    const type = database.get<DbFeeder[]>('/feeders', [])[index]?.type
    setData(index, type === 'trayfeeder' ? { usecount: 0 } : { usecount_0: 0 })
  }

  /* ---------------- 操作 ---------------- */

  /** 自动飞达前进 / 后退 */
  function feed(item: FeederView, direction: 1 | -1) {
    if (!item.feederId) return
    machineCommands.feederMove(item.feederId, direction)
  }

  /** 头部（相机）当前坐标 */
  function cameraPoint(): { x: number; y: number } | null {
    const { x, y } = machine.pos
    return x === null || y === null ? null : { x, y }
  }

  /**
   * 吸嘴当前坐标：机器只上报头部坐标，这里按吸嘴偏移补正。
   * 偏移来自设置里的 nozzleoffset{id}_x / y（校准后通常为 0）。
   */
  function nozzlePoint(): { x: number; y: number } | null {
    const base = cameraPoint()
    if (!base) return null
    const id = machine.activeNozzle?.id ?? 0
    return {
      x: base.x + database.getNumber(`/setting/nozzleoffset${id}_x`, 0),
      y: base.y + database.getNumber(`/setting/nozzleoffset${id}_y`, 0),
    }
  }

  /** 移动相机（头部）到坐标 */
  function moveCameraTo(x: number, y: number) {
    machine.headTo(x, y)
  }

  /** 移动当前吸嘴到坐标 */
  function moveNozzleTo(x: number, y: number) {
    machineCommands.moveNozzleToPosition(machine.activeNozzle?.id ?? 0, x, y)
  }

  /** 移动当前吸嘴到指定高度 */
  function moveNozzleZ(z: number) {
    machineCommands.moveNozzleTo(machine.activeNozzle?.id ?? 0, z)
  }

  return {
    filter,
    query,
    feeders,
    visibleFeeders,
    stats,
    addFeeder,
    setEnabled,
    setData,
    setAutoPosition,
    setFeederAngle,
    setLoosePoint,
    setPart,
    resetUsed,
    feed,
    cameraPoint,
    nozzlePoint,
    moveCameraTo,
    moveNozzleTo,
    moveNozzleZ,
  }
})
