<template>
  <div class="status-bar" data-testid="status-bar">
    <div class="status-left">
      <div class="realtime-status" :class="realtimeClass" :data-testid="`realtime-${realtimeMode}`">
        <span class="status-dot" :class="dotClass"></span>
        <span class="status-label">{{ statusLabel }}</span>
      </div>
      <span class="last-updated" v-if="lastUpdatedAt" :title="lastUpdatedAt.toLocaleString()">
        更新: {{ formatTime(lastUpdatedAt) }}
      </span>
    </div>
    <div class="status-right">
      <span class="audit-badge" title="所有工具调用均被完整记录">审计完整</span>
      <span class="privacy-badge" title="数据仅存储在本地，不会上传到云端">本地隐私</span>
      <button
        v-if="realtimeMode === 'disconnected'"
        class="refresh-btn"
        data-testid="offline-refresh-btn"
        @click="$emit('refresh')"
        title="刷新数据"
      >
        ↻
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RealtimeMode } from '../stores/stats'

const props = defineProps<{
  realtimeMode: RealtimeMode
  lastUpdatedAt: Date | null
}>()

defineEmits<{
  refresh: []
}>()

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

function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-2) var(--spacing-4);
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: var(--text-sm);
}

.status-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
}

.status-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
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

.last-updated {
  font-size: var(--text-xs);
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid var(--border);
  cursor: help;
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

.audit-badge {
  background-color: var(--success);
}

.privacy-badge {
  background-color: var(--primary);
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
</style>
