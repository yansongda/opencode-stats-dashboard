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
    <div class="nav-status">
      <div class="realtime-status" :class="realtimeClass" :data-testid="`realtime-${realtimeMode}`">
        <span class="status-dot" :class="dotClass"></span>
        <span class="status-label">{{ statusLabel }}</span>
      </div>
      <span v-if="formattedUpdatedAt" class="data-updated-at" data-testid="data-updated-at">
        数据更新时间: {{ formattedUpdatedAt }}
        <span v-if="refreshing" class="refreshing-indicator">刷新中</span>
      </span>
      <span class="audit-badge" title="所有工具调用均被完整记录">审计完整</span>
      <span class="privacy-badge" title="数据仅存储在本地，不会上传到云端">本地隐私</span>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { RealtimeMode } from '../stores/stats'

const props = defineProps<{
  realtimeMode: RealtimeMode
  lastUpdatedAt: Date | null
  lastDataUpdatedAt: Date | null
  refreshing: boolean
}>()

defineEmits<{
  refresh: []
}>()

const menuOpen = ref(false)

const links = [
  { to: '/', label: '概览', testId: 'overview' },
  { to: '/efficiency', label: '效率分析', testId: 'efficiency' },
  { to: '/models', label: '模型对比', testId: 'models' },
  { to: '/projects', label: '项目对比', testId: 'projects' },
  { to: '/tools', label: '工具统计', testId: 'tools' },
  { to: '/sessions', label: '会话', testId: 'sessions' },
]

const realtimeClass = computed(() => `realtime-${props.realtimeMode}`)
const dotClass = computed(() => {
  switch (props.realtimeMode) {
    case 'sse': return 'dot-live'
    case 'polling': return 'dot-polling'
    case 'disconnected': return 'dot-offline'
  }
})
const statusLabel = computed(() => {
  switch (props.realtimeMode) {
    case 'sse': return 'Live'
    case 'polling': return 'Polling'
    case 'disconnected': return 'Offline'
  }
})

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

const formattedUpdatedAt = computed<string | null>(() => {
  const d = props.lastDataUpdatedAt
  if (!d) return null
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
})
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

.nav-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  margin-left: auto;
}

.realtime-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 2px 8px;
  border-radius: var(--radius-md);
  background-color: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border);
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.dot-live {
  background-color: var(--success);
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
  animation: pulse-live 2s ease-in-out infinite;
}

.dot-polling {
  background-color: var(--warning);
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
  animation: pulse-polling 3s ease-in-out infinite;
}

.dot-offline {
  background-color: var(--danger);
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
}

.status-label {
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.realtime-live .status-label {
  color: var(--success);
}

.realtime-polling .status-label {
  color: var(--warning);
}

.realtime-disconnected .status-label {
  color: var(--danger);
}

.data-updated-at {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background-color: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border);
}

.refreshing-indicator {
  color: var(--warning);
  font-weight: 500;
  margin-left: var(--spacing-1);
}

.audit-badge,
.privacy-badge {
  font-size: var(--text-xs);
  padding: 2px 8px;
  border-radius: var(--radius-lg);
  font-weight: 600;
  color: white;
  cursor: help;
}

.audit-badge {
  background-color: var(--success);
}

.privacy-badge {
  background-color: var(--primary);
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

  .nav-status {
    display: none;
  }
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes pulse-polling {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
