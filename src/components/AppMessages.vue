<script setup lang="ts">
import { useNotifyStore } from '@/stores/notify'

const notify = useNotifyStore()
</script>

<template>
  <div class="messages">
    <TransitionGroup name="msg">
      <button
        v-for="message in notify.messages"
        :key="message.id"
        class="message"
        :class="`is-${message.tone}`"
        @click="notify.dismiss(message.id)"
      >
        {{ message.text }}
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.messages {
  position: fixed;
  /* 让开顶部连接状态条 */
  top: calc(env(safe-area-inset-top) + 40px);
  left: var(--gutter);
  right: var(--gutter);
  z-index: 2600;
  display: flex;
  flex-direction: column;
  gap: 6px;
  pointer-events: none;
}

.message {
  pointer-events: auto;
  padding: 10px 12px;
  border-radius: var(--r-md);
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--info);
  background: var(--surface-3);
  color: var(--text);
  font-size: 13px;
  line-height: 1.45;
  text-align: left;
  word-break: break-word;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.message.is-ok {
  border-left-color: var(--ok);
}

.message.is-warn {
  border-left-color: var(--warn);
}

.message.is-danger {
  border-left-color: var(--danger);
}

.msg-enter-active,
.msg-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.msg-enter-from,
.msg-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
