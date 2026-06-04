<template>
  <div class="widget-card" data-testid="recent-sessions">
    <h3 class="widget-title">近期会话</h3>
    <div v-if="recentSessions.length === 0" class="widget-empty" data-testid="recent-sessions-empty">
      暂无会话数据
    </div>
    <div v-else class="session-list">
      <div
        v-for="session in recentSessions"
        :key="session.session_id"
        class="session-row"
        :data-testid="`session-row-${session.session_id}`"
      >
        <div class="session-content">
          <span class="session-project" :title="session.project_path || session.session_id">{{ formatProjectPath(session.project_path) }}</span>
          <span class="session-time">{{ formatRelativeTime(session.last_event_at) }}</span>
        </div>
        <span
          class="session-tag"
          :class="session.deleted ? 'tag-deleted' : 'tag-active'"
        >
          {{ session.deleted ? '已删除' : '活跃' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '../stores/stats'
import { formatRelativeTime } from '../utils/timezone'
import type { SessionRow } from '../api/client'

const store = useStatsStore()

const recentSessions = computed((): SessionRow[] => {
  const sessions = store.sessions.value
  if (sessions.length === 0) return []

  return [...sessions]
    .filter(s => s.last_event_at !== null)
    .sort((a, b) => {
      const dateA = new Date(a.last_event_at!).getTime()
      const dateB = new Date(b.last_event_at!).getTime()
      return dateB - dateA
    })
    .slice(0, 5)
})

function formatProjectPath(path: string | null): string {
  if (!path) return '未知项目'
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 2) return path
  return '.../' + segments.slice(-2).join('/')
}
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

.session-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.session-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-2) 0;
  border-bottom: 1px solid var(--border);
  gap: var(--spacing-2);
}

.session-row:last-child {
  border-bottom: none;
}

.session-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.session-project {
  font-size: var(--text-sm);
  font-family: monospace;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-time {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.session-tag {
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 2px var(--spacing-2);
  border-radius: var(--radius-sm);
  white-space: nowrap;
  flex-shrink: 0;
}

.tag-active {
  color: var(--success);
  background-color: rgba(34, 197, 94, 0.1);
}

.tag-deleted {
  color: var(--danger);
  background-color: rgba(239, 68, 68, 0.1);
}
</style>
