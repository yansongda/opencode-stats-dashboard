<template>
  <div class="overview-container">
    <!-- Loading State -->
    <LoadingState v-if="loading" message="加载统计数据中..." test-id="overview-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="error"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="overview-error"
      @action="store.refreshData"
    />

    <!-- Empty State -->
    <EmptyState
      v-else-if="!overview"
      title="暂无统计数据"
      description="开始使用 OpenCode 后，统计数据将自动显示在这里"
      test-id="overview-empty"
    />

    <!-- Content -->
    <template v-else>
    <!-- Metric Cards -->
    <div class="metrics-row resp-metrics-5" data-testid="metrics-row">
      <MetricCard
        label="总会话"
        :value="overview?.total_sessions ?? 0"
        :subtitle="`${overview?.active_sessions ?? 0} 活跃 · ${overview?.deleted_sessions ?? 0} 已删除`"
        test-id="metric-sessions"
      />
      <MetricCard
        label="总 Token / 成本"
        :value="`${formatTokens(overview?.total_tokens ?? 0)} / ${formatCost(overview?.total_cost_usd ?? 0)}`"
        :subtitle="`入 ${formatTokens(overview?.input_tokens ?? 0)} · 出 ${formatTokens(overview?.output_tokens ?? 0)}`"
        test-id="metric-tokens"
      />
      <MetricCard
        label="平均 Token / 成本"
        :value="`${formatTokens(avgTokensPerSession)} / ${formatCost(avgCostPerSession)}`"
        subtitle="平均会话 Token / 平均会话成本"
        test-id="metric-avg-cost"
      />
      <MetricCard
        label="工具调用"
        :value="overview?.tool_call_count ?? 0"
        :subtitle="`错误 ${overview?.tool_error_count ?? 0} · 成功率 ${toolSuccessRate}%`"
        test-id="metric-tools"
      />
      <MetricCard
        label="代码变更"
        :value="`+${overview?.lines_added ?? 0}`"
        :subtitle="`-${overview?.lines_deleted ?? 0} · 净增 ${(overview?.lines_added ?? 0) - (overview?.lines_deleted ?? 0)} 行`"
        test-id="metric-code"
      />
    </div>

    <!-- Usage Trend Chart -->
    <div class="trend-section" data-testid="trend-section">
      <div class="section-header">
        <h3 class="section-title">使用趋势</h3>
        <div class="period-tabs">
          <button
            v-for="p in periods"
            :key="p.value"
            class="period-btn"
            :class="{ active: selectedPeriod === p.value }"
            data-testid="period-btn"
            @click="selectPeriod(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
      </div>
      <LineChart
        :x-data="trendDates"
        :series="trendSeries"
        height="280px"
        :smooth="true"
        :show-area="true"
        y-label="Token"
      />
    </div>

    <!-- Middle Row: Model Distribution + Project Ranking -->
    <div class="mid-row resp-two-col">
      <div class="chart-card" data-testid="model-distribution">
        <h3 class="section-title">模型成本分布</h3>
        <PieChart
          :data="modelPieData"
          height="260px"
          :donut="true"
          legend-position="top"
        />
      </div>
      <div class="chart-card" data-testid="project-ranking">
        <h3 class="section-title">项目使用排行 Top 5</h3>
        <BarChart
          :x-data="projectNames"
          :series="projectSeries"
          height="260px"
        />
      </div>
    </div>

    <!-- Bottom Row: Tool Top 5 + Recent Sessions -->
    <div class="bottom-row resp-two-col">
      <div class="chart-card" data-testid="tool-top5">
        <h3 class="section-title">工具调用 Top 5</h3>
        <BarChart
          :x-data="toolNames"
          :series="toolSeries"
          height="260px"
          :horizontal="true"
        />
      </div>
      <div class="chart-card" data-testid="recent-sessions">
        <h3 class="section-title">近期会话</h3>
        <EmptyState
          v-if="recentSessions.length === 0"
          title="暂无会话数据"
          description="开始使用 OpenCode 后，会话记录将显示在这里"
          test-id="recent-sessions-empty"
        />
        <div v-else class="session-list">
          <div
            v-for="session in recentSessions"
            :key="session.session_id"
            class="session-row"
          >
            <div class="session-info">
              <span class="session-project" :title="session.project_path || session.session_id">
                {{ formatProjectPath(session.project_path) }}
              </span>
              <span class="session-model">{{ session.primary_model || '—' }}</span>
            </div>
            <div class="session-meta">
              <span class="session-tokens">{{ formatTokens(session.total_tokens) }}</span>
              <span
                class="session-status"
                :class="session.status === 'active' ? 'status-active' : 'status-deleted'"
              >
                {{ session.status === 'active' ? '活跃' : '已删除' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MetricCard from '../components/MetricCard.vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import LineChart from '../charts/LineChart.vue'
import PieChart from '../charts/PieChart.vue'
import BarChart from '../charts/BarChart.vue'
import { useStatsStore, type Period } from '../stores/stats'

// ── Store ──────────────────────────────────────────────────────────

const store = useStatsStore()

const periods: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: 'all', label: '全部' },
]

function selectPeriod(period: Period): void {
  void store.setPeriod(period)
}

// ── Formatting Helpers ─────────────────────────────────────────────

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

function formatProjectPath(path: string | null): string {
  if (!path) return '未知项目'
  const segments = path.split('/').filter(Boolean)
  if (segments.length <= 2) return path
  return '.../' + segments.slice(-2).join('/')
}

// ── Derived Chart Data ─────────────────────────────────────────────

const overview = computed(() => store.overview.value)
const loading = computed(() => store.loading.value)
const error = computed(() => store.error.value)
const trendData = computed(() => store.trend.value)
const tools = computed(() => store.toolCalls.value)
const models = computed(() => store.models.value)
const projects = computed(() => store.projects.value)
const recentSessions = computed(() => store.recentSessions.value)
const selectedPeriod = computed(() => store.selectedPeriod.value)

const toolSuccessRate = computed(() => {
  if (!overview.value) return '100'
  const total = overview.value.tool_call_count
  if (total === 0) return '100'
  return ((1 - overview.value.tool_error_count / total) * 100).toFixed(1)
})

const avgTokensPerSession = computed(() => {
  if (!overview.value || overview.value.total_sessions === 0) return 0
  return Math.round(overview.value.total_tokens / overview.value.total_sessions)
})

const avgCostPerSession = computed(() => {
  if (!overview.value || overview.value.total_sessions === 0) return 0
  return overview.value.total_cost_usd / overview.value.total_sessions
})

const trendDates = computed(() => trendData.value.map((d) => d.date))

const trendSeries = computed(() => [
  { name: 'Token', data: trendData.value.map((d) => d.tokens), color: '#3b82f6' },
  { name: '消息', data: trendData.value.map((d) => d.messages), color: '#16a34a' },
])

const modelPieData = computed(() =>
  models.value.map((m) => ({
    name: m.model,
    value: Math.round(m.total_cost_usd * 10000) / 10000,
  })),
)

const projectNames = computed(() =>
  projects.value.slice(0, 5).map((p) => {
    const segments = p.project_path.split('/').filter(Boolean)
    return segments.length > 2 ? '.../' + segments.slice(-2).join('/') : p.project_path
  }),
)

const projectSeries = computed(() => [
  {
    name: '会话数',
    data: projects.value.slice(0, 5).map((p) => p.session_count),
    color: '#3b82f6',
  },
])

const toolNames = computed(() => tools.value.slice(0, 5).map((t) => t.tool_name))

const toolSeries = computed(() => [
  {
    name: '调用次数',
    data: tools.value.slice(0, 5).map((t) => t.call_count),
    color: '#8b5cf6',
  },
])
</script>

<style scoped>
.overview-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

/* ── Metrics Row ────────────────────────────────────────────────── */

.metrics-row {
  /* Grid handled by .resp-metrics-5 utility */
  gap: var(--spacing-3);
}

/* ── Section Header ─────────────────────────────────────────────── */

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-xs);
  padding: 3px var(--spacing-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background-color: var(--surface);
  color: var(--text-muted);
  transition: all 0.15s ease;
  line-height: 1.4;
}

.period-btn:hover {
  color: var(--text);
  border-color: var(--primary);
}

.period-btn.active {
  background-color: var(--primary);
  color: white;
  border-color: var(--primary);
}

/* ── Chart Card ─────────────────────────────────────────────────── */

.chart-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
  transition: border-color 0.2s ease;
}

.chart-card:hover {
  border-color: var(--primary);
}

.trend-section {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

/* ── Layout Rows ────────────────────────────────────────────────── */

.mid-row {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-3);
}

.bottom-row {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-3);
}

/* ── Recent Sessions List ───────────────────────────────────────── */

.session-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
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

.session-info {
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

.session-model {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.session-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex-shrink: 0;
}

.session-tokens {
  font-size: var(--text-xs);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.session-status {
  font-size: var(--text-xs);
  font-weight: 600;
  padding: 1px var(--spacing-2);
  border-radius: var(--radius-sm);
}

.status-active {
  color: var(--success);
  background-color: rgba(34, 197, 94, 0.1);
}

.status-deleted {
  color: var(--danger);
  background-color: rgba(239, 68, 68, 0.1);
}
</style>
