<template>
  <div class="view-container" data-testid="tools-view">
    <!-- Header -->
    <div class="view-header resp-header">
      <h1 class="view-title">工具统计</h1>
      <div class="period-tabs">
        <button
          v-for="p in periods"
          :key="p.value"
          class="period-btn"
          :class="{ active: selectedPeriod === p.value }"
          :data-testid="`period-${p.value}`"
          @click="selectPeriod(p.value)"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingState v-if="loading" message="加载工具统计数据中..." test-id="tools-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="error"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="tools-error"
      @action="store.refreshData"
    />

    <!-- Content -->
    <template v-else>
    <!-- Summary Metrics -->
    <div class="metrics-grid resp-metrics-4" data-testid="tools-metrics">
      <div class="metric-tile">
        <div class="metric-value">{{ formatNumber(toolsData?.total_calls ?? 0) }}</div>
        <div class="metric-label">总调用次数</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatPercent(toolsData?.success_rate ?? 0) }}</div>
        <div class="metric-label">成功率</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ toolsData?.tools.length ?? 0 }}</div>
        <div class="metric-label">工具种类</div>
      </div>
      <div class="metric-tile">
        <div class="metric-value">{{ formatNumber(toolsData?.total_errors ?? 0) }}</div>
        <div class="metric-label">总错误数</div>
      </div>
    </div>

    <!-- Tool Ranking Table -->
    <section class="section" data-testid="tools-ranking">
      <h2 class="section-title">工具使用排行</h2>
      <div class="table-wrapper resp-table-wrapper">
        <table class="data-table">
          <thead>
            <tr>
              <th class="sortable" :class="{ sorted: sortKey === 'tool_name' }" @click="toggleSort('tool_name')">
                工具名称 <span class="sort-indicator">{{ sortIndicator('tool_name') }}</span>
              </th>
              <th class="sortable col-right" :class="{ sorted: sortKey === 'call_count' }" @click="toggleSort('call_count')">
                调用次数 <span class="sort-indicator">{{ sortIndicator('call_count') }}</span>
              </th>
              <th class="sortable col-right" :class="{ sorted: sortKey === 'success_rate' }" @click="toggleSort('success_rate')">
                成功率 <span class="sort-indicator">{{ sortIndicator('success_rate') }}</span>
              </th>
              <th class="sortable col-right" :class="{ sorted: sortKey === 'avg_duration_ms' }" @click="toggleSort('avg_duration_ms')">
                平均耗时 <span class="sort-indicator">{{ sortIndicator('avg_duration_ms') }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="sortedTools.length === 0">
              <td colspan="4">
                <EmptyState
                  title="暂无工具调用数据"
                  description="开始使用 OpenCode 后，工具调用记录将显示在这里"
                  test-id="tools-empty"
                />
              </td>
            </tr>
            <tr v-for="tool in sortedTools" :key="tool.tool_name">
              <td class="col-monospace">{{ tool.tool_name }}</td>
              <td class="col-right">{{ formatNumber(tool.call_count) }}</td>
              <td class="col-right">
                <span :class="rateClass(tool.success_rate)">{{ formatPercent(tool.success_rate) }}</span>
              </td>
              <td class="col-right">{{ formatDuration(tool.avg_duration_ms) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Tool Usage Trend -->
    <section class="section" data-testid="tools-trend">
      <h2 class="section-title">工具使用趋势</h2>
      <div v-if="trendData.length === 0" class="chart-empty">
        暂无趋势数据
      </div>
      <LineChart
        v-else
        :x-data="trendLabels"
        :series="trendSeries"
        height="280px"
        :smooth="true"
        :show-area="true"
        y-label="调用次数"
      />
    </section>

    <!-- Bottom Row: Error Distribution + Duration Distribution -->
    <div class="bottom-row resp-two-col" data-testid="tools-charts">
      <!-- Error Distribution Pie -->
      <section class="section bottom-section">
        <h2 class="section-title">错误分布</h2>
        <div v-if="errorPieData.length === 0" class="chart-empty">
          暂无错误数据
        </div>
        <PieChart
          v-else
          :data="errorPieData"
          height="280px"
          :donut="true"
          :show-label="true"
        />
      </section>

      <!-- Duration Distribution Histogram -->
      <section class="section bottom-section">
        <h2 class="section-title">耗时分布</h2>
        <div v-if="durationHistData.length === 0" class="chart-empty">
          暂无耗时数据
        </div>
        <BarChart
          v-else
          :x-data="durationLabels"
          :series="durationSeries"
          height="280px"
          y-label="工具数"
        />
      </section>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import LineChart from '../charts/LineChart.vue'
import PieChart from '../charts/PieChart.vue'
import BarChart from '../charts/BarChart.vue'
import { useStatsStore, type Period } from '../stores/stats'
import type { ToolStatsItem } from '../api/client'

// ── Store ──────────────────────────────────────────────────────────

const store = useStatsStore()

const periods = [
  { value: '7d' as const, label: '7天' },
  { value: '30d' as const, label: '30天' },
  { value: 'all' as const, label: '全部' },
]

function selectPeriod(period: Period): void {
  void store.setPeriod(period)
}

// ── Data from Store ────────────────────────────────────────────────

const loading = computed(() => store.loading.value)
const error = computed(() => store.error.value)
const toolsData = computed(() => ({
  tools: store.toolCalls.value,
  ...store.toolSummary.value,
}))
const trendData = computed(() => store.trend.value)
const selectedPeriod = computed(() => store.selectedPeriod.value)

// ── Sorting ──────────────────────────────────────────────────────────

type SortKey = keyof ToolStatsItem
const sortKey = ref<SortKey>('call_count')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'tool_name' ? 'asc' : 'desc'
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const sortedTools = computed<ToolStatsItem[]>(() => {
  const tools = toolsData.value?.tools ?? []
  const sorted = [...tools].sort((a, b) => {
    const aVal = a[sortKey.value]
    const bVal = b[sortKey.value]
    let cmp = 0
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal
    } else {
      cmp = String(aVal).localeCompare(String(bVal))
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })
  return sorted
})

// ── Trend Chart Data ─────────────────────────────────────────────────

const trendLabels = computed(() => trendData.value.map((d) => d.date))
const trendSeries = computed(() => [
  {
    name: '工具调用',
    data: trendData.value.map((d) => d.tool_calls),
    color: '#3b82f6',
  },
])

// ── Error Pie Data ───────────────────────────────────────────────────

const errorPieData = computed(() => {
  const tools = toolsData.value?.tools ?? []
  return tools
    .filter((t) => t.error_count > 0)
    .map((t) => ({
      name: t.tool_name,
      value: t.error_count,
    }))
    .sort((a, b) => b.value - a.value)
})

// ── Duration Histogram Data ──────────────────────────────────────────

interface DurationBucket {
  label: string
  count: number
}

const durationHistData = computed<DurationBucket[]>(() => {
  const tools = toolsData.value?.tools ?? []
  if (tools.length === 0) return []

  // Create duration buckets: <100ms, 100-500ms, 500ms-1s, 1-5s, 5-10s, 10s+
  const buckets: DurationBucket[] = [
    { label: '<100ms', count: 0 },
    { label: '100-500ms', count: 0 },
    { label: '0.5-1s', count: 0 },
    { label: '1-5s', count: 0 },
    { label: '5-10s', count: 0 },
    { label: '>10s', count: 0 },
  ]

  for (const tool of tools) {
    const ms = tool.avg_duration_ms
    if (ms < 100) buckets[0].count++
    else if (ms < 500) buckets[1].count++
    else if (ms < 1000) buckets[2].count++
    else if (ms < 5000) buckets[3].count++
    else if (ms < 10000) buckets[4].count++
    else buckets[5].count++
  }

  return buckets
})

const durationLabels = computed(() => durationHistData.value.map((b) => b.label))
const durationSeries = computed(() => [
  {
    name: '工具数',
    data: durationHistData.value.map((b) => b.count),
    color: '#8b5cf6',
  },
])

// ── Formatters ───────────────────────────────────────────────────────

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function rateClass(rate: number): string {
  if (rate >= 0.95) return 'rate-good'
  if (rate >= 0.80) return 'rate-warn'
  return 'rate-bad'
}
</script>

<style scoped>
/* ── View Container ─────────────────────────────────────────────────── */
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

/* ── View Header ────────────────────────────────────────────────────── */
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

.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-sm);
  padding: var(--spacing-1) var(--spacing-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background-color: var(--surface);
  color: var(--text-muted);
  transition: all 0.15s ease;
}

.period-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.period-btn.active {
  background-color: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

/* ── Metrics Grid ─────────────────────────────────────────────────── */
.metrics-grid {
  /* Grid handled by .resp-metrics-4 utility */
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
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Section ────────────────────────────────────────────────────────── */
.section {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

/* ── Data Table ─────────────────────────────────────────────────────── */
.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.data-table thead {
  background: var(--bg);
  position: sticky;
  top: 0;
  z-index: 1;
}

.data-table th {
  padding: var(--spacing-2) var(--spacing-3);
  text-align: center;
  font-weight: 500;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}

.data-table th.sortable {
  cursor: pointer;
  transition: color 0.15s ease;
}

.data-table th.sortable:hover {
  color: var(--text);
}

.data-table th.sorted {
  color: var(--primary);
}

.sort-indicator {
  font-size: var(--text-xs);
  margin-left: var(--spacing-1);
  opacity: 0.6;
}

.data-table td {
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  vertical-align: middle;
  text-align: center;
}

.data-table tbody tr {
  transition: background-color 0.1s ease;
}

.data-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.col-right {
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.col-monospace {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Rate Colors ────────────────────────────────────────────────────── */
.rate-good {
  color: var(--success);
}

.rate-warn {
  color: var(--warning);
}

.rate-bad {
  color: var(--danger);
}

/* ── Bottom Row ─────────────────────────────────────────────────────── */
.bottom-row {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-3);
}

.bottom-section {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
}

/* ── Chart Empty ────────────────────────────────────────────────────── */
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 280px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

</style>
