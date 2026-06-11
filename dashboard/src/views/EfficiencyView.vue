<template>
  <div class="view-container" data-testid="efficiency-view">
    <!-- Header -->
    <div class="view-header resp-header">
      <h1 class="view-title">效率分析</h1>
      <TimeRangePicker v-model="selectedPeriod" />
    </div>

    <!-- Loading State (initial no-data load only) -->
    <LoadingState v-if="loading && !efficiencyData" message="加载效率数据中..." test-id="efficiency-loading" />

    <!-- Error State (no data to display) -->
    <EmptyState
      v-else-if="error && !efficiencyData"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="efficiency-error"
      @action="() => fetchData()"
    />

    <!-- Content (preserved during background refresh) -->
    <template v-else-if="efficiencyData">
    <!-- Efficiency Metric Cards -->
    <div class="metrics-grid resp-metrics-4">
      <MetricCard
        label="平均会话时长"
        :value="avgSessionDuration"
        subtitle="所有会话平均"
        test-id="metric-avg-duration"
      />
      <MetricCard
        label="每会话成本"
        :value="costPerSession"
        subtitle="平均会话成本"
        test-id="metric-cost-per-task"
      />
      <MetricCard
        label="每小时消息"
        :value="messagesPerActiveHour"
        subtitle="活跃时段消息密度"
        test-id="metric-msg-per-hour"
      />
      <MetricCard
        label="变更文件"
        :value="filesChanged"
        subtitle="总文件变更数"
        test-id="metric-files-changed"
      />
    </div>

    <!-- Working Hour Heatmap -->
    <div class="chart-card" data-testid="heatmap-section">
      <div class="chart-card-header">
        <span class="chart-card-title">工作时段分布</span>
        <span class="chart-card-subtitle">消息活跃度按小时 × 星期</span>
      </div>
      <HeatmapChart
        :data="heatmapData"
        :day-labels="dayLabels"
        height="280px"
        min-color="#eff6ff"
        max-color="#3b82f6"
      />
    </div>

    <!-- Timeline Tokens + Cost -->
    <div class="chart-card" data-testid="timeline-tokens-section">
      <div class="chart-card-header">
        <span class="chart-card-title">Token 与成本趋势</span>
        <span class="chart-card-subtitle">按时间段聚合</span>
      </div>
      <LineChart
        :x-data="timelineLabels"
        :series="timelineTokenSeries"
        height="260px"
        y-label="Token"
        right-y-label="成本 ($)"
        :value-formatter="formatTokens"
        :right-value-formatter="formatCost"
        :tooltip-formatter="tokenCostTooltipFormatter"
      />
    </div>

    <!-- Code Changes -->
    <div class="chart-card" data-testid="code-changes-section">
      <div class="chart-card-header">
        <span class="chart-card-title">代码变更趋势</span>
        <span class="chart-card-subtitle">新增 / 删除 / 变更文件</span>
      </div>
      <LineChart
        :x-data="timelineLabels"
        :series="codeChangesSeries"
        height="260px"
        :show-area="true"
        :smooth="true"
        y-label="数量"
      />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onActivated } from 'vue'
import MetricCard from '../components/MetricCard.vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import HeatmapChart from '../charts/HeatmapChart.vue'
import LineChart from '../charts/LineChart.vue'
import TimeRangePicker from '../components/TimeRangePicker.vue'
import type { DashboardEfficiencyHeatmapPoint } from '../api/client'
import { useEfficiencyStore } from '../stores/efficiency'
import { formatCost, formatTokens } from '../utils/format'
import { formatBucketLocal, getRangeMs, type TimeRange } from '../utils/timezone'

// ── Store ───────────────────────────────────────────────────────────
const { efficiencyData, loading, error, lastFetchedAt, fetchEfficiency } = useEfficiencyStore()

// ── State ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 60_000

const selectedPeriod = ref<TimeRange>('7d')

// ── Data Fetching ──────────────────────────────────────────────────

function fetchData(): void {
  const { start, end } = getRangeMs(selectedPeriod.value)
  void fetchEfficiency(start, end, { range: selectedPeriod.value })
}

// Initial load
onMounted(() => { fetchData() })

// Re-fetch on activation if stale (>60s)
onActivated(() => {
  if (!lastFetchedAt.value || Date.now() - lastFetchedAt.value > STALE_THRESHOLD_MS) {
    fetchData()
  }
})

// User-initiated period change → refetch
watch(selectedPeriod, () => { fetchData() })

// ── Formatting Helpers ─────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return '—'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`
}

function formatRate(value: number | null): string {
  if (value === null) return '—'
  return `${value.toFixed(1)}`
}

// ── Efficiency Metrics ─────────────────────────────────────────────

const summary = computed(() => efficiencyData.value?.summary ?? null)

const avgSessionDuration = computed(() => {
  if (!summary.value) return '—'
  return formatDuration(summary.value.avg_session_duration_ms)
})

const costPerSession = computed(() => {
  if (!summary.value) return '—'
  return formatCost(summary.value.avg_cost_per_session, 3)
})

const messagesPerActiveHour = computed(() => {
  if (!summary.value) return '—'
  return formatRate(summary.value.messages_per_active_hour)
})

const filesChanged = computed(() => {
  if (!summary.value) return '—'
  return summary.value.total_files_changed.toLocaleString()
})

// ── Working Hour Heatmap ───────────────────────────────────────────

const dayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function mapHeatmapPoint(p: DashboardEfficiencyHeatmapPoint): { day: number; hour: number; value: number } {
  // API weekday: 0=Sunday (SQLite strftime('%w')), 6=Saturday
  // Chart day: 0=Monday, 6=Sunday
  const day = p.weekday === 0 ? 6 : p.weekday - 1
  return { day, hour: p.hour, value: p.messages }
}

const heatmapData = computed(() => {
  if (!efficiencyData.value) return []
  return efficiencyData.value.heatmap.map(mapHeatmapPoint)
})

// ── Timeline Charts ────────────────────────────────────────────────

const timelineLabels = computed(() => {
  if (!efficiencyData.value) return []
  return efficiencyData.value.timeline.map(p => formatBucketLocal(p.bucket))
})

const timelineTokenSeries = computed(() => {
  if (!efficiencyData.value) return []
  return [
    { name: 'Token', data: efficiencyData.value.timeline.map(p => p.tokens), color: '#3b82f6' },
    { name: '成本 ($)', data: efficiencyData.value.timeline.map((p) => Number((p.cost_usd ?? 0).toFixed(4))), color: '#f59e0b', yAxisIndex: 1 },
  ]
})

const tokenCostTooltipFormatter = (params: unknown): string => {
  const list = params as Array<{
    axisValueLabel: string
    seriesName: string
    value: number
    color: string
  }>
  if (!Array.isArray(list) || list.length === 0) return ''
  const header = list[0].axisValueLabel ?? ''
  const lines = list.map((p) => {
    const formatted = p.seriesName === 'Token' ? formatTokens(p.value) : formatCost(p.value)
    return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px"></span>${p.seriesName}: <b>${formatted}</b>`
  })
  return `<div style="font-size:12px">${header ? `<div style="margin-bottom:4px">${header}</div>` : ''}${lines.join('<br>')}</div>`
}

// ── Code Changes ───────────────────────────────────────────────────

const codeChangesSeries = computed(() => {
  if (!efficiencyData.value) return []
  return [
    { name: '新增行', data: efficiencyData.value.timeline.map(p => p.lines_added), color: '#16a34a' },
    { name: '删除行', data: efficiencyData.value.timeline.map(p => p.lines_deleted), color: '#ef4444' },
    { name: '变更文件', data: efficiencyData.value.timeline.map(p => p.files_changed), color: '#3b82f6' },
  ]
})
</script>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

/* ── Header ───────────────────────────────────────────────────────── */

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.view-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--text);
}

/* ── Metrics Grid ─────────────────────────────────────────────────── */

.metrics-grid {
  /* Grid handled by .resp-metrics-4 utility */
  gap: var(--spacing-3);
}

/* ── Chart Cards ──────────────────────────────────────────────────── */

.chart-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.chart-card-header {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-1);
}

.chart-card-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

.chart-card-subtitle {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* ── Chart Row ────────────────────────────────────────────────────── */

.chart-row {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-3);
}

</style>
