<template>
  <div class="widget-card" data-testid="project-distribution">
    <h3 class="widget-title">项目分布</h3>
    <div v-if="projectData.length === 0" class="widget-empty" data-testid="project-distribution-empty">
      暂无会话数据
    </div>
    <div v-else class="distribution-list">
      <div
        v-for="item in projectData"
        :key="item.path"
        class="distribution-row"
        :data-testid="`project-row-${item.rank}`"
      >
        <span class="rank-badge">{{ item.rank }}</span>
        <div class="distribution-content">
          <span class="distribution-label" :title="item.path">{{ item.displayPath }}</span>
          <span class="distribution-count">{{ item.count }} 会话</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()

function truncatePath(path: string, maxSegments: number = 3): string {
  if (!path || path === 'Unknown') return path
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= maxSegments) return path
  return '.../' + segments.slice(-maxSegments).join('/')
}

const projectData = computed(() => {
  const sessions = store.sessions.value
  if (sessions.length === 0) return []

  const counts = new Map<string, number>()
  for (const s of sessions) {
    const key = s.project_path ?? 'Unknown'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .map(([path, count]) => ({ path, displayPath: truncatePath(path), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
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

.distribution-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.distribution-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-2) 0;
  border-bottom: 1px solid var(--border);
}

.distribution-row:last-child {
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

.distribution-content {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  min-width: 0;
  flex: 1;
  gap: var(--spacing-2);
}

.distribution-label {
  font-size: var(--text-sm);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: monospace;
}

.distribution-count {
  font-size: var(--text-xs);
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
