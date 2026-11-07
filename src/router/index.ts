import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'control',
      component: () => import('@/views/ControlView.vue'),
      meta: { title: '控制' },
    },
    {
      path: '/placement',
      name: 'placement',
      component: () => import('@/views/PlacementView.vue'),
      meta: { title: '贴装' },
    },
    {
      path: '/feeders',
      name: 'feeders',
      component: () => import('@/views/FeederView.vue'),
      meta: { title: '飞达' },
    },
    {
      path: '/overview',
      name: 'overview',
      component: () => import('@/views/OverviewView.vue'),
      meta: { title: '总览' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

export default router
