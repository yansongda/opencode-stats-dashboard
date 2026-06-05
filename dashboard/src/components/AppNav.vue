<template>
  <nav class="app-nav" data-testid="app-nav">
    <div class="nav-logo">
      <span class="logo-icon">📊</span>
      <span class="logo-text">OpenCode Stats</span>
    </div>
    <button
      class="nav-hamburger"
      data-testid="nav-hamburger"
      aria-label="切换导航菜单"
      @click="menuOpen = !menuOpen"
    >
      {{ menuOpen ? '✕' : '☰' }}
    </button>
    <div class="nav-links" :class="{ 'nav-links-collapsible': true, open: menuOpen }">
      <router-link
        v-for="link in links"
        :key="link.to"
        :to="link.to"
        class="nav-link"
        :data-testid="`nav-${link.testId}`"
        @click="menuOpen = false"
      >
        {{ link.label }}
      </router-link>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const menuOpen = ref(false)

const links = [
  { to: '/', label: '概览', testId: 'overview' },
  { to: '/efficiency', label: '效率分析', testId: 'efficiency' },
  { to: '/models', label: '模型对比', testId: 'models' },
  { to: '/projects', label: '项目对比', testId: 'projects' },
  { to: '/tools', label: '工具统计', testId: 'tools' },
  { to: '/sessions', label: '会话', testId: 'sessions' },
]
</script>

<style scoped>
.app-nav {
  display: flex;
  align-items: center;
  gap: var(--spacing-6);
  padding: var(--spacing-3) var(--spacing-4);
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
  position: relative;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.logo-icon {
  font-size: var(--text-xl);
}

.logo-text {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.nav-hamburger {
  display: none;
  background: none;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--spacing-1) var(--spacing-2);
  cursor: pointer;
  color: var(--text);
  font-size: var(--text-lg);
  line-height: 1;
  margin-left: auto;
}

.nav-hamburger:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.nav-links {
  display: flex;
  gap: var(--spacing-1);
  flex: 1;
}

.nav-link {
  padding: var(--spacing-2) var(--spacing-3);
  color: var(--text-muted);
  text-decoration: none;
  font-size: var(--text-base);
  border-radius: var(--radius-sm);
  transition: all 0.2s ease;
}

.nav-link:hover {
  color: var(--text);
  background-color: rgba(0, 0, 0, 0.05);
}

.nav-link.router-link-active {
  color: var(--primary);
  background-color: rgba(59, 130, 246, 0.1);
}

/* ── Mobile: hamburger menu ───────────────────────────────────────── */

@media (max-width: 767px) {
  .nav-hamburger {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-links {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: var(--spacing-2) var(--spacing-4);
    flex-direction: column;
    gap: var(--spacing-1);
    z-index: 10;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .nav-links.open {
    display: flex;
  }
}
</style>
