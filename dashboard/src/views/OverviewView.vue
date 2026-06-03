<template>
  <div class="view-container">
    <h1 class="view-title">Overview</h1>

    <!-- Metric Cards -->
    <div class="metrics-grid">
      <MetricCard
        label="Total Sessions"
        :value="overview?.total_sessions ?? 0"
        :trend="sessionsTrend"
        trend-direction="up"
        :subtitle="sessionsSubtitle"
        test-id="metric-total-sessions"
      />
      <MetricCard
        label="Deleted Sessions"
        :value="overview?.deleted_sessions ?? 0"
        :trend="deletedRate"
        trend-direction="down"
        :subtitle="deletedSubtitle"
        test-id="metric-deleted-sessions"
      />
      <MetricCard
        label="Total Tokens"
        :value="formatTokens(overview?.total_tokens ?? 0)"
        trend-direction="up"
        :subtitle="tokensSubtitle"
        test-id="metric-total-tokens"
      />
      <MetricCard
        label="Total Cost"
        :value="formatCost(overview?.total_cost_usd ?? 0)"
        trend-direction="up"
        :subtitle="costSubtitle"
        test-id="metric-total-cost"
      />
    </div>

    <!-- Verification Status Panel -->
    <div class="verification-panel">
      <h2 class="panel-title">Verification Status</h2>
      <div class="verification-grid">
        <div class="verification-card">
          <div class="verification-header">
            <span class="verification-icon" :class="auditLevelClass">{{ auditLevelIcon }}</span>
            <span class="verification-label">Audit Level</span>
          </div>
          <div class="verification-value" data-testid="audit-level">{{ auditLevelLabel }}</div>
          <div v-if="isLimitedAudit" class="audit-warning" data-testid="tool-audit-warning">
            ⚠️ Limited audit mode — only session-level statistics are available.
            Tool call lifecycle events are not exposed by the OpenCode event surface.
          </div>
        </div>

        <div class="verification-card">
          <div class="verification-header">
            <span class="verification-icon status-ok">✓</span>
            <span class="verification-label">Event Surface</span>
          </div>
          <div class="verification-value">Session Lifecycle</div>
          <div class="verification-detail">session.created · session.deleted</div>
        </div>

        <div class="verification-card">
          <div class="verification-header">
            <span class="verification-icon status-ok">✓</span>
            <span class="verification-label">Privacy Mode</span>
          </div>
          <div class="verification-value">Strict</div>
          <div class="verification-detail">No full payloads persisted by default</div>
        </div>

        <div class="verification-card">
          <div class="verification-header">
            <span class="verification-icon" :class="realtimeClass">{{ realtimeIcon }}</span>
            <span class="verification-label">Real-time</span>
          </div>
          <div class="verification-value" data-testid="realtime-mode">{{ realtimeLabel }}</div>
          <div class="verification-detail">{{ realtimeDetail }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import MetricCard from '../components/MetricCard.vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()
const { overview, realtimeMode } = store

onMounted(() => {
  store.start()
})

onUnmounted(() => {
  store.stop()
})

// ── Metric helpers ──────────────────────────────────────────────────

const sessionsSubtitle = computed(() => {
  const total = overview.value?.total_sessions ?? 0
  const deleted = overview.value?.deleted_sessions ?? 0
  const active = total - deleted
  return `${active.toLocaleString()} active · ${deleted.toLocaleString()} deleted`
})

const sessionsTrend = computed(() => {
  const total = overview.value?.total_sessions ?? 0
  if (total === 0) return undefined
  return `+${total} total`
})

const deletedRate = computed(() => {
  const total = overview.value?.total_sessions ?? 0
  const deleted = overview.value?.deleted_sessions ?? 0
  if (total === 0) return undefined
  const rate = Math.round((deleted / total) * 100)
  return `${rate}% rate`
})

const deletedSubtitle = computed(() => {
  const total = overview.value?.total_sessions ?? 0
  const deleted = overview.value?.deleted_sessions ?? 0
  if (total === 0) return 'No sessions yet'
  return `${deleted} of ${total} sessions deleted`
})

const tokensSubtitle = computed(() => {
  const tokens = overview.value?.total_tokens ?? 0
  if (tokens === 0) return 'No tokens recorded'
  return `Across all sessions`
})

const costSubtitle = computed(() => {
  const cost = overview.value?.total_cost_usd ?? 0
  if (cost === 0) return 'No costs recorded'
  return `Total spend`
})

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`
  }
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

// ── Audit level ─────────────────────────────────────────────────────

// Phase 0: session-level audit is always available.
// Tool call lifecycle depends on OpenCode event surface support.
// For now, we show "full" if tool calls data is available, "limited" otherwise.
const auditLevel = computed(() => {
  const toolCalls = store.toolCalls.value
  // If we have tool call data with proper lifecycle, audit is full
  if (toolCalls.length > 0) return 'full'
  // Otherwise limited — only session-level stats
  return 'limited'
})

const isLimitedAudit = computed(() => auditLevel.value === 'limited')

const auditLevelLabel = computed(() => {
  return auditLevel.value === 'full' ? 'Full' : 'Limited'
})

const auditLevelClass = computed(() => {
  return auditLevel.value === 'full' ? 'status-ok' : 'status-warning'
})

const auditLevelIcon = computed(() => {
  return auditLevel.value === 'full' ? '✓' : '⚠'
})

// ── Real-time mode ──────────────────────────────────────────────────

const realtimeLabel = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return 'SSE Connected'
    case 'polling': return 'Polling'
    case 'disconnected': return 'Disconnected'
    default: return 'Unknown'
  }
})

const realtimeClass = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return 'status-ok'
    case 'polling': return 'status-warning'
    case 'disconnected': return 'status-error'
    default: return 'status-warning'
  }
})

const realtimeIcon = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return '✓'
    case 'polling': return '↻'
    case 'disconnected': return '✗'
    default: return '?'
  }
})

const realtimeDetail = computed(() => {
  switch (realtimeMode.value) {
    case 'sse': return 'Receiving real-time updates via Server-Sent Events'
    case 'polling': return 'Fallback: polling every 5 seconds'
    case 'disconnected': return 'No active connection'
    default: return ''
  }
})
</script>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-6);
}

.view-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text);
}

/* ── Metrics Grid ─────────────────────────────────────────────────── */

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-3);
}

/* ── Verification Panel ───────────────────────────────────────────── */

.verification-panel {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.panel-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.verification-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--spacing-3);
}

.verification-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
}

.verification-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.verification-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.status-ok {
  background-color: rgba(34, 197, 94, 0.15);
  color: var(--success);
}

.status-warning {
  background-color: rgba(245, 158, 11, 0.15);
  color: var(--warning);
}

.status-error {
  background-color: rgba(239, 68, 68, 0.15);
  color: var(--danger);
}

.verification-label {
  font-size: var(--text-sm);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.verification-value {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.verification-detail {
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.4;
}

.audit-warning {
  background-color: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: var(--radius-sm);
  padding: var(--spacing-3);
  font-size: var(--text-sm);
  color: var(--warning);
  line-height: 1.5;
}

/* ── Responsive ───────────────────────────────────────────────────── */

@media (max-width: 1024px) {
  .metrics-grid,
  .verification-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .metrics-grid,
  .verification-grid {
    grid-template-columns: 1fr;
  }
}
</style>
