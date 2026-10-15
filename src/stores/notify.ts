import { defineStore } from 'pinia'
import { ref } from 'vue'

export type MessageTone = 'info' | 'ok' | 'warn' | 'danger'

export interface MachineMessage {
  id: number
  text: string
  tone: MessageTone
}

/** 同屏最多保留的提示条数 */
const MAX_MESSAGES = 4
/** 未指定显示时长时的默认秒数 */
const DEFAULT_SECONDS = 4

/** 机器下发消息的提示条，按 showtime 自动消失，也可点一下立即关掉 */
export const useNotifyStore = defineStore('notify', () => {
  const messages = ref<MachineMessage[]>([])
  const timers = new Map<number, number>()
  let seed = 0

  function dismiss(id: number) {
    const timer = timers.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timers.delete(id)
    }
    messages.value = messages.value.filter((item) => item.id !== id)
  }

  function schedule(id: number, seconds: number) {
    if (seconds <= 0) return
    timers.set(
      id,
      window.setTimeout(() => dismiss(id), seconds * 1000),
    )
  }

  function push(text: string, tone: MessageTone = 'info', seconds = DEFAULT_SECONDS) {
    const content = text.trim()
    if (!content) return

    // 同一条消息重复下发时只重置倒计时，不叠加
    const existing = messages.value.find((item) => item.text === content)
    if (existing) {
      const timer = timers.get(existing.id)
      if (timer) window.clearTimeout(timer)
      schedule(existing.id, seconds)
      return
    }

    seed += 1
    const message: MachineMessage = { id: seed, text: content, tone }
    messages.value = [...messages.value, message].slice(-MAX_MESSAGES)
    schedule(message.id, seconds)
  }

  return { messages, push, dismiss }
})
