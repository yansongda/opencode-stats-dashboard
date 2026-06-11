<template>
  <AppLayout
    :realtime-mode="realtimeMode"
    :last-updated-at="lastUpdatedAt"
    :last-data-updated-at="lastDataUpdatedAt"
    :refreshing="refreshing"
    @refresh="handleRefresh"
    @reconnect="handleReconnect"
  >
    <router-view />
  </AppLayout>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import AppLayout from './components/AppLayout.vue'
import { useSSE } from './composables/useSSE'

const sse = useSSE()
const { realtimeMode, lastUpdatedAt, lastDataUpdatedAt, refreshing } = sse

onMounted(() => {
  sse.connect()
})

onUnmounted(() => {
  sse.disconnect()
})

async function handleRefresh() {
  sse.cancelDebouncedRefresh()
  await sse.refreshCurrentRoute(false)
}

function handleReconnect(): void {
  sse.reconnect()
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
