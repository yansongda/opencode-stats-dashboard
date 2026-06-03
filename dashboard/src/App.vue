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
          Overview
        </router-link>
        <router-link
          to="/sessions"
          class="nav-link"
          data-testid="nav-sessions"
        >
          Sessions
        </router-link>
        <router-link
          to="/tool-calls"
          class="nav-link"
          data-testid="nav-tool-calls"
        >
          Tool Calls
        </router-link>
        <router-link
          to="/exports"
          class="nav-link"
          data-testid="nav-exports"
        >
          Exports
        </router-link>
        <router-link
          to="/validation"
          class="nav-link"
          data-testid="nav-validation"
        >
          Validation
        </router-link>
      </nav>
      <div class="status-indicators">
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
import { computed } from 'vue'
import { useStatsStore } from './stores/stats'

const store = useStatsStore()
const realtimeMode = store.realtimeMode

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
</script>

<style>
:root {
  /* Colors - Dark theme */
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --success: #22c55e;
  --danger: #ef4444;
  --warning: #f59e0b;
  --bg: #0f172a;
  --surface: #1e293b;
  --border: #334155;
  --text: #f8fafc;
  --text-muted: #94a3b8;

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
  background-color: rgba(255, 255, 255, 0.05);
}

.nav-link.router-link-active {
  color: var(--primary);
  background-color: rgba(59, 130, 246, 0.1);
}

.status-indicators {
  display: flex;
  gap: var(--spacing-2);
  align-items: center;
}

.realtime-status {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  padding: var(--spacing-1) var(--spacing-3);
  border-radius: var(--radius-md);
  background-color: rgba(255, 255, 255, 0.03);
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
  background-color: rgba(255, 255, 255, 0.05);
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
