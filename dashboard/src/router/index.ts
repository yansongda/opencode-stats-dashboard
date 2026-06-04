import { createRouter, createWebHistory } from 'vue-router'
import OverviewView from '../views/OverviewView.vue'
import SessionsView from '../views/SessionsView.vue'
import ToolCallsView from '../views/ToolCallsView.vue'
import ExportsView from '../views/ExportsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: OverviewView,
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: SessionsView,
    },
    {
      path: '/tool-calls',
      name: 'tool-calls',
      component: ToolCallsView,
    },
    {
      path: '/exports',
      name: 'exports',
      component: ExportsView,
    },
  ],
})

export default router
