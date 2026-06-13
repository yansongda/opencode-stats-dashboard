import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "overview",
      component: () => import("../views/OverviewView.vue"),
    },
    {
      path: "/efficiency",
      name: "efficiency",
      component: () => import("../views/EfficiencyView.vue"),
    },
    {
      path: "/models",
      name: "models",
      component: () => import("../views/ModelsView.vue"),
    },
    {
      path: "/projects",
      name: "projects",
      component: () => import("../views/ProjectsView.vue"),
    },
    {
      path: "/tools",
      name: "tools",
      component: () => import("../views/ToolCallsView.vue"),
    },
    {
      path: "/sessions",
      name: "sessions",
      component: () => import("../views/SessionsView.vue"),
    },
  ],
});

export default router;
