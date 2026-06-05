import { createRouter, createWebHistory } from 'vue-router'
import OverviewView from '../views/OverviewView.vue'
import EfficiencyView from '../views/EfficiencyView.vue'
import ModelsView from '../views/ModelsView.vue'
import ProjectsView from '../views/ProjectsView.vue'
import ToolCallsView from '../views/ToolCallsView.vue'
import SessionsView from '../views/SessionsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'overview',
      component: OverviewView,
    },
    {
      path: '/efficiency',
      name: 'efficiency',
      component: EfficiencyView,
    },
    {
      path: '/models',
      name: 'models',
      component: ModelsView,
    },
    {
      path: '/projects',
      name: 'projects',
      component: ProjectsView,
    },
    {
      path: '/tools',
      name: 'tools',
      component: ToolCallsView,
    },
    {
      path: '/sessions',
      name: 'sessions',
      component: SessionsView,
    },
  ],
})

export default router
