<template>
  <div class="widget-card" data-testid="model-distribution">
    <h3 class="widget-title">Model Distribution</h3>
    <div v-if="modelData.length === 0" class="widget-empty" data-testid="model-distribution-empty">
      No session data available
    </div>
    <div v-else class="distribution-list">
      <div
        v-for="item in modelData"
        :key="item.model"
        class="distribution-row"
        :data-testid="`model-row-${item.model}`"
      >
        <div class="distribution-header">
          <span class="distribution-label">{{ item.model }}</span>
          <span class="distribution-count">{{ item.count }} ({{ item.percentage }}%)</span>
        </div>
        <div class="progress-track">
          <div
            class="progress-fill"
            :style="{ width: `${item.percentage}%` }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()

const modelData = computed(() => {
  const sessions = store.sessions.value
  if (sessions.length === 0) return []

  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = s.model ?? 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const total = sessions.length
  return Array.from(counts.entries())
    .map(([model, count]) => ({
      model,
      count,
      percentage: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.count - a.count)
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

.distribution-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.distribution-row {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.distribution-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.distribution-label {
  font-size: var(--text-sm);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.distribution-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.progress-track {
  height: 6px;
  background-color: rgba(255, 255, 255, 0.06);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--primary);
  border-radius: var(--radius-sm);
  transition: width 0.4s ease;
}
</style>
