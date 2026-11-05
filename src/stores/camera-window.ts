import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 悬浮视频窗的停靠方式 */
export type CameraAnchorMode =
  /** 打开弹窗：被挡住时飞上去，不改变大小 */
  | 'avoid'
  /** 展开控制贴片机：放大并停到目标上方 */
  | 'dock'
  /** 收起控制贴片机：回到放大前的位置和大小 */
  | 'relax'

export interface CameraAnchor {
  mode: CameraAnchorMode
  /** 目标顶边，一般是弹窗顶边 */
  top: number
}

/**
 * 悬浮视频窗的位置控制。
 * anchor 为 null 时自由浮动。
 */
export const useCameraWindowStore = defineStore('cameraWindow', () => {
  const anchor = ref<CameraAnchor | null>(null)

  /** 打开弹窗：被遮挡时飞到目标上方 */
  function avoid(top: number) {
    anchor.value = { mode: 'avoid', top }
  }

  /** 展开控制贴片机：放大并停到目标上方 */
  function dock(top: number) {
    anchor.value = { mode: 'dock', top }
  }

  /** 收起控制贴片机：回到放大前的位置 */
  function relax() {
    anchor.value = { mode: 'relax', top: 0 }
  }

  /** 关闭弹窗：回到打开弹窗之前的位置 */
  function undock() {
    anchor.value = null
  }

  return { anchor, avoid, dock, relax, undock }
})
