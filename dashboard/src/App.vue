<template>
  <div id="app">
    <header class="app-header">
      <div class="logo">
        <span class="logo-icon">📊</span>
        <span class="logo-text">OpenCode Stats</span>
      </div>
      <nav class="main-nav">
        <router-link
          to="/"
          class="nav-link"
          data-testid="nav-overview"
        >
          概览
        </router-link>
        <router-link
          to="/sessions"
          class="nav-link"
          data-testid="nav-sessions"
        >
          会话
        </router-link>
        <router-link
          to="/tool-calls"
          class="nav-link"
          data-testid="nav-tool-calls"
        >
          工具调用
        </router-link>
        <router-link
          to="/exports"
          class="nav-link"
          data-testid="nav-exports"
        >
          导出
        </router-link>
      </nav>
      <div class="timezone-selector">
        <select v-model="selectedTimezone" @change="onTimezoneChange" class="tz-select">
          <option v-for="tz in timezones" :key="tz" :value="tz">
            {{ tz.replace('_', ' ') }}
          </option>
        </select>
      </div>
      <div class="status-indicators">
        <span class="last-updated" v-if="lastUpdatedAt" :title="lastUpdatedAt.toLocaleString()">
          更新: {{ formatTime(lastUpdatedAt) }}
        </span>
        <span class="audit-badge" title="所有工具调用均被完整记录">审计完整</span>
        <span class="privacy-badge" title="数据仅存储在本地，不会上传到云端">本地隐私</span>
        <div
          class="realtime-status"
          :class="realtimeClass"
          :data-testid="`realtime-${realtimeMode}`"
        >
          <span class="status-dot" :class="dotClass"></span>
          <span class="status-label">{{ statusLabel }}</span>
          <button
            v-if="realtimeMode === 'disconnected'"
            class="refresh-btn"
            data-testid="offline-refresh-btn"
            @click="handleRefresh"
            title="Refresh data"
          >
            ↻
          </button>
        </div>
      </div>
    </header>
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useStatsStore } from './stores/stats'
import { getActiveTimezone, setStoredTimezone, getBrowserTimezone, COMMON_TIMEZONES } from './utils/timezone'

const store = useStatsStore()
const realtimeMode = store.realtimeMode
const lastUpdatedAt = store.lastUpdatedAt

const selectedTimezone = ref(getActiveTimezone())
const timezones = COMMON_TIMEZONES

function onTimezoneChange() {
  setStoredTimezone(selectedTimezone.value)
}

onMounted(() => {
  store.start()
  if (!localStorage.getItem('opencode-stats-timezone')) {
    selectedTimezone.value = getBrowserTimezone()
  }
})

onUnmounted(() => {
  store.stop()
})

const realtimeClass = computed(() => `realtime-${realtimeMode.value}`)
const dotClass = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return 'dot-live'
    case 'polling': return 'dot-polling'
    case 'disconnected': return 'dot-offline'
  }
})
const statusLabel = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return 'Live'
    case 'polling': return 'Polling'
    case 'disconnected': return 'Offline'
  }
})

async function handleRefresh() {
  await store.refreshData()
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}
</script>

<style>
:root {
  /* Colors - Light theme */
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #d97706;
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #0f172a;
  --text-muted: #64748b;

  /* Spacing */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-5: 20px;
  --spacing-6: 24px;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  /* Font sizes */
  --text-xs: 10px;
  --text-sm: 11px;
  --text-base: 12px;
  --text-lg: 14px;
  --text-xl: 16px;
  --text-2xl: 20px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background-color: var(--bg);
  color: var(--text);
  font-size: var(--text-base);
  line-height: 1.5;
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-6);
  padding: var(--spacing-3) var(--spacing-4);
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
}

.logo {
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

.main-nav {
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

.timezone-selector {
  display: flex;
  align-items: center;
  margin-left: auto;
}

.tz-select {
  padding: 2px 6px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
  cursor: pointer;
  outline: none;
  transition: border-color 0.15s ease;
}

.tz-select:focus {
  border-color: var(--primary);
}

.status-indicators {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}

.audit-badge,
.privacy-badge {
  font-size: var(--text-sm);
  padding: 2px 10px;
  border-radius: var(--radius-lg);
  font-weight: 600;
  color: white;
  cursor: help;
}

.last-updated {
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border);
  cursor: help;
}

.audit-badge {
  background-color: var(--success);
}

.privacy-badge {
  background-color: var(--primary);
}

.realtime-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-1) var(--spacing-3);
  border-radius: var(--radius-md);
  background-color: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border);
}

.status-dot {
  width: 8px;
  height: 8px;
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
  font-size: var(--text-sm);
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

.refresh-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
  padding: var(--spacing-1) var(--spacing-2);
  border-radius: var(--radius-sm);
  line-height: 1;
  transition: all 0.2s ease;
}

.refresh-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
  background-color: rgba(0, 0, 0, 0.05);
}

@keyframes pulse-live {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes pulse-polling {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.app-main {
  flex: 1;
  padding: var(--spacing-4);
}
</style>
