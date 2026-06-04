<template>
  <div class="widget-card" data-testid="top-tools">
    <h3 class="widget-title">工具调用 Top 5</h3>
    <div v-if="toolData.length === 0" class="widget-empty" data-testid="top-tools-empty">
      暂无工具调用数据
    </div>
    <div v-else class="tool-list">
      <div
        v-for="item in toolData"
        :key="item.toolName"
        class="tool-row"
        :data-testid="`tool-row-${item.rank}`"
      >
        <span class="rank-badge">{{ item.rank }}</span>
        <div class="tool-content">
          <span class="tool-name" :title="item.toolName">{{ item.toolName }}</span>
          <span class="tool-count">{{ item.count }} 次</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()

const toolData = computed(() => {
  const toolCalls = store.toolCalls.value
  if (toolCalls.length === 0) return []

  const counts = new Map<string, number>()
  for (const tc of toolCalls) {
    counts.set(tc.tool_name, (counts.get(tc.tool_name) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([toolName, count]) => ({ toolName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item, i) => ({ ...item, rank: i + 1 }))
})
</script>

<style scoped>
.widget-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  transition: border-color 0.2s ease;
}

.widget-card:hover {
  border-color: var(--primary);
}

.widget-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.widget-empty {
  font-size: var(--text-sm);
  color: var(--text-muted);
  padding: var(--spacing-3) 0;
}

.tool-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.tool-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-2) 0;
  border-bottom: 1px solid var(--border);
}

.tool-row:last-child {
  border-bottom: none;
}

.rank-badge {
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(59, 130, 246, 0.12);
  color: var(--primary);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.tool-content {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  min-width: 0;
  flex: 1;
  gap: var(--spacing-2);
}

.tool-name {
  font-size: var(--text-sm);
  font-family: monospace;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.tool-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
