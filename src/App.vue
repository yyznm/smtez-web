<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { cameraStream } from '@/api/camera-stream'
import { wsClient } from '@/api/ws-client'
import AppMessages from '@/components/AppMessages.vue'
import AppTabbar from '@/components/AppTabbar.vue'
import ConnectionBar from '@/components/ConnectionBar.vue'
import FloatingCamera from '@/components/FloatingCamera.vue'
import { useDatabaseStore } from '@/stores/database'
import { useMachineStore } from '@/stores/machine'
import { useOverviewStore } from '@/stores/overview'

const route = useRoute()
const database = useDatabaseStore()
const machine = useMachineStore()
const overview = useOverviewStore()

// 相机二进制帧统一交给相机流解码
const offBinary = wsClient.onBinary((buffer) => cameraStream.handleBinary(buffer))

// 监听数据库变更事件：相机配置变化时同步给画面解码器
const offPatch = database.onPatch((record) => {
  if (record.path.startsWith('/cameras')) machine.syncCameraSizes()
})

// 暂时只在贴装页显示悬浮小窗（首页已有完整画面）
const showFloatingCamera = computed(() => route.path === '/placement' && machine.cameraActive)

onMounted(() => {
  database.init()
  database.connect()
  // 实时画面全局常开，供首页与悬浮小窗共用
  machine.startCamera()
})

onBeforeUnmount(() => {
  machine.stopCamera()
  offBinary()
  offPatch()
})

// 仅总览页保持曲线实时刷新
watch(
  () => route.name,
  (name) => {
    if (name === 'overview') overview.startLiveFeed()
    else overview.stopLiveFeed()
  },
  { immediate: true },
)
</script>

<template>
  <van-config-provider theme="dark" class="app-shell">
    <ConnectionBar />
    <div class="app-main">
      <router-view />
    </div>
    <AppTabbar />
    <FloatingCamera v-if="showFloatingCamera" />
    <AppMessages />
  </van-config-provider>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  max-width: 700px;
}

.app-main {
  flex: 1;
  min-height: 0;
}
</style>
