<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

/**
 * 点面板之外的任何地方（含顶部菜单、状态条）都收起操作面板，
 * 且不拦截这次点击，被点到的控件照常响应。
 */
function onDocumentPointerDown(event: PointerEvent) {
  if (!showActions.value) return
  const target = event.target as HTMLElement | null
  // 面板内的按钮、导航栏上的「操作」开关自己处理开合
  if (target?.closest('.sheet, .tabbar')) return
  showActions.value = false
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown, true))

// 切页时收起面板
watch(() => route.path, () => {
  showActions.value = false
})
</script>

<template>
  <div class="tabbar-root">
    <!-- 遮罩只做视觉压暗，不拦截点击，顶部菜单仍可操作 -->
    <Transition name="fade">
      <div v-if="showActions" class="backdrop" />
    </Transition>

    <!-- 操作面板从导航栏背后升起 -->
    <Transition name="sheet">
      <div v-if="showActions" class="sheet">
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
        @click="showActions = false"
      >
        <AppIcon :name="item.icon" :size="20" />
        <span class="tab-label">{{ item.label }}</span>
      </RouterLink>

      <button class="tab tab-action" :class="{ 'is-active': showActions }" @click="showActions = !showActions">
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
  background: rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.sheet {
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
  transition: background 0.15s, transform 0.1s;
}

.action:active {
  background: var(--surface-3);
  transform: scale(0.97);
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

/* 操作按钮：宽 1.5 倍，占满导航栏高度，直角 */
.tab-action {
  flex: none;
  width: 81px;
  height: 100%;
  border-radius: 0;
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-deep) 100%);
  color: #fff;
  font-weight: 650;
  box-shadow: 0 4px 14px rgba(31, 191, 114, 0.28);
  transition: filter 0.15s, transform 0.1s, box-shadow 0.15s;
}

.tab-action:active {
  transform: scale(0.97);
  filter: brightness(0.95);
}

.tab-action.is-active {
  color: #fff;
  filter: brightness(1.05);
  box-shadow: 0 4px 18px rgba(31, 191, 114, 0.42);
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
