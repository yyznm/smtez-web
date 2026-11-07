/** 数据库中的单个元件（吸附在 boards[i].allchildparts[j].allparts[k]） */
export interface DbPart {
  Ref: string
  Val: string
  Package: string
  /** Part = 贴装 · Fiducial = 基准点 */
  PartType: string
  PosX: number
  PosY: number
  Rot: number
  Side: string
  Comments: string
  enable: boolean
  hide: boolean
  status: string
  weight: number
  data?: Record<string, unknown>
  savedata?: Record<string, unknown>
}

/** 子板（拼板中的单个小板） */
export interface DbChildBoard {
  allparts: DbPart[]
  [key: string]: unknown
}

/** 拼板 / 板级设置 */
export interface DbBoardSetting {
  /** 拼板列数 */
  xcountvalue: number
  /** 拼板列间距 */
  xdimvalue: number
  /** 拼板行数 */
  ycountvalue: number
  /** 拼板行间距 */
  ydimvalue: number
  [key: string]: unknown
}

export interface DbBoard {
  /** 板名 */
  Boardid: string
  /** 板面 Top / Bottom */
  Side: string
  allchildparts: DbChildBoard[]
  /** 是否启用 */
  enable: boolean
  setting: DbBoardSetting
  status: string
  uuid: number
  version: number
}

/** 头部吸嘴槽位，键为 N0 ~ N15 */
export interface DbHeadNozzle {
  enable: boolean
  nozzleid: string
}

/** 吸嘴型号表 */
export interface DbNozzleSpec {
  nozzleid: string
  range: number
  size: number
}

/** 相机分辨率 */
export interface DbCamera {
  width: number
  height: number
}

/** 飞达类型：自动飞达 / 料带飞达 / 托盘飞达 / 散料飞达 */
export type FeederType = 'manualautofeeder' | 'stripfeeder' | 'trayfeeder' | 'loosepartsfeeder'

/** 单个取料点（料带上的一个孔位；散料为识别区域 + 元件角度） */
export interface DbFeederPoint {
  x: number
  y: number
  z?: number
  r?: number
  /** 识别区域宽度 / 长度 */
  w?: number
  h?: number
  /** 散料飞达的元件角度 */
  pr?: number
}

/**
 * 飞达数据。不同类型字段不同，这里只声明会读写的部分：
 * - manualautofeeder：feederid（飞达编号）、feedrate
 * - stripfeeder：tmp_pos0_1_* / tmp_pos0_2_*（坐标A / 坐标B）、part_0_z、part_0_dis、part_0_r
 * - trayfeeder：pos_1_* / pos_2_* / pos_3_*（坐标A / B / C）、count_x / count_y（XY 数量）、part_z、part_r
 * - loosepartsfeeder：pos（中心 + 识别区域 w/h + 角度 pr）、feederz（平台高度）、enableUpLight / enableBacklight
 * - 公共：usecount_0（已使用）、count_0（最大数量，0 表示不限制）、disablePreTake（禁用预取）
 */
export interface DbFeederData {
  usecount_0?: number
  /** 托盘飞达的已使用数量 */
  usecount?: number
  /** 散料飞达的平台高度 */
  feederz?: number
  /** 散料飞达的上视觉灯光 / 背光 */
  enableUpLight?: boolean
  enableBacklight?: boolean
  lastTake_0?: number
  /** 最大数量，0 表示不限制 */
  count_0?: number
  /** 托盘飞达的最大数量 */
  partcount?: number
  tapeCount?: number
  disablePreTake?: boolean
  feederid?: number
  feedrate?: number
  part_0_dis?: number
  part_0_z?: number
  part_0_r?: number
  /** 托盘飞达的高度 / 角度 */
  part_z?: number
  part_r?: number
  /** 托盘飞达的 XY 数量 */
  count_x?: number
  count_y?: number
  tmp_pos0_1_x?: number
  tmp_pos0_1_y?: number
  tmp_pos0_1_z?: number
  tmp_pos0_2_x?: number
  tmp_pos0_2_y?: number
  tmp_pos0_2_z?: number
  /** 托盘飞达的坐标A / B / C */
  pos_1_x?: number
  pos_1_y?: number
  pos_1_z?: number
  pos_2_x?: number
  pos_2_y?: number
  pos_2_z?: number
  pos_3_x?: number
  pos_3_y?: number
  pos_3_z?: number
  /** 自动飞达的元件取料坐标 */
  pos_0_x?: number
  pos_0_y?: number
  pos_0_z?: number
  /** 自动飞达的最小拾取间隔（ms） */
  minwaittime?: number
  /** 料带：parts[0] 为一条料带的全部取料点；散料为单个点 */
  parts?: DbFeederPoint[][] | DbFeederPoint[]
  /** 飞达自身位置，自动飞达的 r 为飞达角度 */
  pos?: DbFeederPoint
  pos_0?: DbFeederPoint
  [key: string]: unknown
}

/** 数据库中的一台飞达（/feeders[i]） */
export interface DbFeeder {
  data: DbFeederData
  enable: boolean
  id: string
  label: string
  /** 自动飞达的编号，如 130 */
  name: string
  /** 元件串，格式为 元件名=封装，如 22kΩ=R0603 */
  part: string
  type: FeederType | string
  uuid: number
}

/** 机器设置 */
export interface DbSetting {
  /** 点动步进（mm） */
  stepValue: number
  /** 运行速度比例 0 ~ 1 */
  machineSpeed: number
  /** 停止 / 停靠坐标 */
  onstoppositon_x: number
  onstoppositon_y: number
  /** 行程范围 */
  limitmin_x: number
  limitmin_y: number
  limitmin_z: number
  limitmax_x: number
  limitmax_y: number
  limitmax_z: number
  /** 总览页图像数量 */
  infoImageCount: number
  [key: string]: unknown
}

/** 完整数据库（database 事件的路径根） */
export interface MachineDatabase {
  boards: DbBoard[]
  cameras: DbCamera[]
  headnozzles: Record<string, DbHeadNozzle>
  nozzleids: DbNozzleSpec[]
  setting: DbSetting
  dataVersion: number
  id: number
  [key: string]: unknown
}

/** 数据库变更（JSON Patch） */
export interface DatabasePatch {
  op: 'replace' | 'add' | 'remove' | 'move' | 'copy' | 'test'
  path: string
  value?: unknown
  from?: string
}

/** 数据来源：未同步 / 远端机器 */
export type DatabaseOrigin = 'none' | 'remote'
export type PatchSource = 'local' | 'remote'

/** 一条变更记录，供事件监听与调试查看 */
export interface PatchRecord {
  op: string
  path: string
  value?: unknown
  at: number
  from: PatchSource
}

/** 机器推送的一条事件（未识别的事件也会记录，便于排查） */
export interface MachineEventRecord {
  event: string
  at: number
  payload: unknown
}
