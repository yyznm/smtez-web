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
