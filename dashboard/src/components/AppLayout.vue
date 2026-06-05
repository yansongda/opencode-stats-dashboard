<template>
  <div class="app-layout">
    <AppNav />
    <AppStatusBar
      :realtime-mode="realtimeMode"
      :last-updated-at="lastUpdatedAt"
      @refresh="$emit('refresh')"
    />
    <main class="app-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import AppNav from './AppNav.vue'
import AppStatusBar from './AppStatusBar.vue'
import type { RealtimeMode } from '../stores/stats'

defineProps<{
  realtimeMode: RealtimeMode
  lastUpdatedAt: Date | null
}>()

defineEmits<{
  refresh: []
}>()
</script>

<style scoped>
.app-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-main {
  flex: 1;
  padding: var(--spacing-4);
}
</style>
