<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useMachineStore } from '@/stores/machine'
import AppIcon from './AppIcon.vue'
import type { IconName } from './icons'

const route = useRoute()
const machine = useMachineStore()

const showActions = ref(false)

interface TabItem {
  to: string
  label: string
  icon: IconName
}

const TABS: TabItem[] = [
  { to: '/', label: '控制', icon: 'crosshair' },
  { to: '/placement', label: '贴装', icon: 'boards' },
  { to: '/overview', label: '总览', icon: 'gauge' },
]

interface ActionItem {
  id: string
  label: string
  icon: IconName
  tone: 'ok' | 'info' | 'danger' | 'warn'
  run: () => void
}

/** 操作菜单：开始 / 重复 / 停止 / 紧急停机 */
const ACTIONS: ActionItem[] = [
  { id: 'start', label: '开始', icon: 'play', tone: 'ok', run: () => machine.startPlacement() },
  { id: 'repeat', label: '重复', icon: 'rotate-cw', tone: 'info', run: () => machine.repeatPlacement() },
  { id: 'stop', label: '停止', icon: 'stop', tone: 'danger', run: () => machine.stopPlacement() },
  {
    id: 'emergency',
    label: '紧急停机',
    icon: 'warning',
    tone: 'warn',
    run: () => machine.emergencyStop(),
  },
]

function run(action: ActionItem) {
  action.run()
  showActions.value = false
}

// 切页时收起面板
watch(() => route.path, () => {
  showActions.value = false
})
</script>

<template>
  <div class="tabbar-root">
    <!-- 遮罩在导航栏之下，导航栏保持正常可用 -->
    <Transition name="fade">
      <div v-if="showActions" class="backdrop" @click="showActions = false" />
    </Transition>

    <!-- 操作面板从导航栏背后升起 -->
    <Transition name="sheet">
      <div v-if="showActions" class="panel">
        <div class="actions">
          <button
            v-for="action in ACTIONS"
            :key="action.id"
            class="action"
            :class="`is-${action.tone}`"
            @click="run(action)"
          >
            <AppIcon :name="action.icon" :size="30" :width="2" />
            <span>{{ action.label }}</span>
          </button>
        </div>
      </div>
    </Transition>

    <nav class="tabbar">
      <RouterLink
        v-for="item in TABS"
        :key="item.to"
        :to="item.to"
        replace
        class="tab"
        :class="{ 'is-active': route.path === item.to }"
      >
        <AppIcon :name="item.icon" :size="20" />
        <span class="tab-label">{{ item.label }}</span>
      </RouterLink>

      <button class="tab" :class="{ 'is-active': showActions }" @click="showActions = !showActions">
        <AppIcon name="sliders" :size="20" />
        <span class="tab-label">操作</span>
      </button>
    </nav>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 89;
  background: rgba(0, 0, 0, 0.45);
}

.panel {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 90;
  /* 让内容让开导航栏，面板本体压在导航栏背后 */
  padding-bottom: var(--tabbar-h);
  background: var(--surface-2);
  border-top: 1px solid var(--line-2);
  border-radius: var(--r-lg) var(--r-lg) 0 0;
  box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.45);
}

.actions {
  display: flex;
  gap: 8px;
  padding: 16px 14px;
}

.action {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  border-radius: var(--r-md);
  border: 1px solid var(--line);
  background: var(--surface);
  font-size: 12px;
  font-weight: 600;
}

.action:active {
  background: var(--surface-3);
}

.action.is-ok {
  color: var(--ok);
}

.action.is-info {
  color: var(--info);
}

.action.is-danger {
  color: var(--danger);
}

.action.is-warn {
  color: var(--warn);
}

.tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  height: calc(54px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface);
  border-top: 1px solid var(--line);
}

.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  color: var(--text-2);
  font-size: 11px;
  letter-spacing: 0.02em;
  text-decoration: none;
}

.tab.is-active {
  color: var(--accent);
}

.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.26s cubic-bezier(0.25, 0.8, 0.3, 1);
}

.sheet-enter-from,
.sheet-leave-to {
  transform: translateY(100%);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.26s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
