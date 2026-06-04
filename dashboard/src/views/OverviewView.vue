<template>
  <div class="view-container">
    <!-- Metric Tiles -->
    <div class="metrics-grid">
      <div class="metric-tile">
        <div class="metric-value">{{ formatNumber(overview?.total_sessions ?? 0) }}</div>
        <div class="metric-label">会话数</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatNumber(overview?.total_messages ?? 0) }}</div>
        <div class="metric-label">消息数</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatNumber(overview?.total_days ?? 0) }}</div>
        <div class="metric-label">活跃天数</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatCost(overview?.total_cost_usd ?? 0) }} / {{ formatTokens(overview?.total_tokens ?? 0) }}</div>
        <div class="metric-label">总费用 / 总 Token</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatCost((overview?.total_cost_usd ?? 0) / (overview?.total_sessions || 1)) }} / {{ formatTokens(overview?.avg_tokens_per_session ?? 0) }}</div>
        <div class="metric-label">平均成本 / 会话</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatTokens(overview?.input_tokens ?? 0) }}</div>
        <div class="metric-label">输入</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatTokens(overview?.output_tokens ?? 0) }}</div>
        <div class="metric-label">输出</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatTokens(overview?.cache_read ?? 0) }}</div>
        <div class="metric-label">Cache Read</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatTokens(overview?.cache_write ?? 0) }}</div>
        <div class="metric-label">Cache Write</div>
      </div>
    </div>

    <!-- Trend Chart + Model Distribution -->
    <div class="mid-row">
      <div class="mid-trend">
        <TrendChart />
      </div>
      <div class="mid-model">
        <ModelDistribution />
      </div>
    </div>

    <!-- Bottom three-column grid -->
    <div class="widgets-grid" data-testid="widgets-grid">
      <ProjectDistribution />
      <RecentSessions />
      <TopTools />
    </div>
  </div>
</template>

<script setup lang="ts">
import TrendChart from '../components/TrendChart.vue'
import ModelDistribution from '../components/ModelDistribution.vue'
import ProjectDistribution from '../components/ProjectDistribution.vue'
import RecentSessions from '../components/RecentSessions.vue'
import TopTools from '../components/TopTools.vue'
import { useStatsStore } from '../stores/stats'

const store = useStatsStore()
const { overview } = store

// ── Formatting helpers ──────────────────────────────────────────────

function formatNumber(value: number): string {
  return value.toLocaleString()
}

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
</script>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

/* ── Metrics Grid ─────────────────────────────────────────────────── */

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: var(--spacing-2);
}

.metric-tile {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-3) var(--spacing-2);
  text-align: center;
  min-width: 0;
  overflow: hidden;
}

.metric-value {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--text);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metric-label {
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 1200px) {
  .metrics-grid {
    grid-template-columns: repeat(5, 1fr);
  }
}

@media (max-width: 768px) {
  .metrics-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* ── Mid Row: Trend + Model ───────────────────────────────────────── */

.mid-row {
  display: flex;
  gap: var(--spacing-3);
}

.mid-trend {
  flex: 2;
  min-width: 0;
}

.mid-model {
  flex: 1;
  min-width: 0;
}

/* ── Widgets Grid ─────────────────────────────────────────────────── */

.widgets-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--spacing-3);
}

/* ── Responsive ───────────────────────────────────────────────────── */

@media (max-width: 1024px) {
  .widgets-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .mid-row {
    flex-direction: column;
  }
}

@media (max-width: 640px) {
  .widgets-grid {
    grid-template-columns: 1fr;
  }
}
</style>
