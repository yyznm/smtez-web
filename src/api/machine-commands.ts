import type { DatabasePatch } from '@/types/database'
import { wsClient } from './ws-client'

/** 是否跳过“移动前把 Z 轴抬到安全高度”，默认 false 即执行安全抬升 */
export interface MoveOptions {
  nosafe?: boolean
  /** 小距离移动补偿 */
  comp?: boolean
}

/**
 * 贴片机指令集（对应文档 https://www.yuque.com/u39182067/smtez/whfemxd65izpsc7b）。
 * 仅包含已确认的命令；未确认的命令名集中注释在文件末尾，避免误发。
 */
export const machineCommands = {
  /** X 相对移动（mm） */
  moveX(offset: number, options: MoveOptions = {}) {
    wsClient.send({
      cmd: 'move',
      move: true,
      x: offset,
      nosafe: options.nosafe ?? false,
      comp: options.comp ?? false,
    })
  },

  /** Y 相对移动（mm） */
  moveY(offset: number, options: MoveOptions = {}) {
    wsClient.send({
      cmd: 'move',
      move: true,
      y: offset,
      nosafe: options.nosafe ?? false,
      comp: options.comp ?? false,
    })
  },

  /** 吸嘴旋转（度） */
  moveR(nozzle: number, angle: number) {
    wsClient.send({ cmd: 'move', nozzle, r: angle, nosafe: true })
  },

  /** 吸嘴升降（mm） */
  moveZ(nozzle: number, height: number) {
    wsClient.send({ cmd: 'move', nozzle, move: true, z: height, nosafe: true })
  },

  /** 头部绝对坐标移动（local: false 表示绝对位置） */
  moveTo(x?: number, y?: number) {
    wsClient.send({
      cmd: 'move',
      move: true,
      local: false,
      nosafe: false,
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    })
  },

  /** 吸嘴绝对高度 */
  moveNozzleTo(nozzle: number, z: number) {
    wsClient.send({ cmd: 'move', nozzle, move: true, z, local: false, nosafe: true })
  },

  /** 吸嘴旋转到绝对角度 */
  moveNozzleRotateTo(nozzle: number, angle: number) {
    wsClient.send({ cmd: 'move', nozzle, move: true, r: angle, local: false, nosafe: true })
  },

  /** 头部复位：force 为 true 时硬复位 */
  home(force = false) {
    wsClient.send({ cmd: 'move', home: true, force })
  },

  /** 飞达前进 / 后退：f 为 1 前进，-1 后退，id 为飞达编号 */
  feederMove(id: number, f: 1 | -1) {
    wsClient.send({ cmd: 'move', type: 'feeder', f, id })
  },

  /** 吸嘴绝对移动到指定坐标 */
  moveNozzleToPosition(nozzle: number, x: number, y: number) {
    wsClient.send({ cmd: 'task', task: 'nozzleToPosition', id: nozzle, pos: { x, y } })
  },

  /** 数据库值设置 */
  setDatabase(value: DatabasePatch[]) {
    return wsClient.send({ cmd: 'database', value })
  },

  /** 主动获取数据库值 */
  readDatabase(path: string) {
    wsClient.send({ cmd: 'readdatabase', path })
  },

  /** 启动相机推流，之后机器会持续下发二进制画面 */
  receiveImage(cameraId: number) {
    wsClient.send({ cmd: 'plugins', call: 'receiveImage', cameraId })
  },

  /** 灯光开关 */
  setLight(light: number, open: boolean) {
    wsClient.send({ cmd: 'setstatus', status: 'light', light, open })
  },

  /** 开始贴片：ignore 为 false 时先检查，存在不可贴装元件则停止 */
  startPlacement(ignore = true) {
    wsClient.send({ cmd: 'aciton', aciton: 'start', ignore })
  },

  /** 重复贴片：无视元件贴装状态重新开始 */
  repeatPlacement(ignore = false) {
    wsClient.send({ cmd: 'aciton', aciton: 'replay', ignore })
  },

  /** 停止：停止贴片任务及一些其他正在执行的任务 */
  stopPlacement() {
    wsClient.send({ cmd: 'setstatus', status: 'RequsetStop' })
  },

  /** 快速停止：向主板发送停止指令 */
  emergencyStop() {
    wsClient.send({ cmd: 'faststop' })
  },

  /** 校准（基准点检查）：global 为 true 时对所有板生效 */
  fiducialCheck(board: number, childboard = 0, global = true) {
    wsClient.send({ cmd: 'task', task: 'fiducialcheck', board, childboard, global })
  },

  /** 移动头部（相机）到当前吸嘴位置 */
  cameraToNozzle(id: number) {
    wsClient.send({ cmd: 'task', task: 'cameraToNozzle', id })
  },

  /** 移动吸嘴到当前头部（相机）位置 */
  nozzleToCamera(id: number) {
    wsClient.send({ cmd: 'task', task: 'nozzleToCamera', id })
  },
}

/*
 * 以下命令在文档的参数表中出现，但示例报文未取到，确认命令名后再启用：
 *
 * 气泵开关   { cmd: '?', open: <bool> }
 * 吸嘴吸气阀 { cmd: '?', id: <吸嘴id>, open: <bool> }
 *
 * 注意：贴片任务的字段名与状态值均按机器实际协议书写（aciton / replay / RequsetStop），
 * 不是拼写错误，改动前请与固件核对。
 */
