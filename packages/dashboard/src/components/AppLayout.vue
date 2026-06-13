<template>
  <div class="app-layout">
    <AppNav
      :realtime-mode="realtimeMode"
      :last-updated-at="lastUpdatedAt"
      :last-data-updated-at="lastDataUpdatedAt"
      :refreshing="refreshing"
      @refresh="$emit('refresh')"
      @reconnect="$emit('reconnect')"
    />
    <main class="app-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import type { RealtimeMode } from "../composables/useSSE";
import AppNav from "./AppNav.vue";

defineProps<{
  realtimeMode: RealtimeMode;
  lastUpdatedAt: Date | null;
  lastDataUpdatedAt: Date | null;
  refreshing: boolean;
}>();

defineEmits<{
  refresh: [];
  reconnect: [];
}>();
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
