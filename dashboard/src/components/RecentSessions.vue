<template>
  <div class="widget-card" data-testid="recent-sessions">
    <h3 class="widget-title">Recent Sessions</h3>
    <div v-if="recentSessions.length === 0" class="widget-empty" data-testid="recent-sessions-empty">
      No session data available
    </div>
    <div v-else class="session-list">
      <div
        v-for="session in recentSessions"
        :key="session.session_id"
        class="session-row"
        :data-testid="`session-row-${session.session_id}`"
      >
        <div class="session-content">
          <span class="session-id" :title="session.session_id">{{ formatSessionId(session.session_id) }}</span>
          <span class="session-time">{{ formatTime(session.last_event_at) }}</span>
        </div>
        <span
          class="session-tag"
          :class="session.deleted ? 'tag-deleted' : 'tag-active'"
        >
          {{ session.deleted ? 'Deleted' : 'Active' }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useStatsStore } from '../stores/stats'
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

function formatSessionId(id: string): string {
  if (id.length <= 12) return id
  return id.slice(0, 8) + '...'
}

function formatTime(iso: string | null): string {
  if (!iso) return '-'
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

.session-id {
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
