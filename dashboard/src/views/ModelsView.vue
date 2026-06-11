<template>
  <div class="view-container" data-testid="models-view">
    <!-- Header -->
    <div class="view-header resp-header">
      <h1 class="view-title">模型对比</h1>
      <TimeRangePicker v-model="selectedPeriod" />
    </div>

    <!-- Loading State (initial no-data only) -->
    <LoadingState v-if="store.loading.value && store.models.value.length === 0" message="加载模型数据中..." test-id="models-loading" />

    <!-- Error State (no-data only; preserves content when data exists) -->
    <EmptyState
      v-else-if="store.error.value && store.models.value.length === 0"
      variant="error"
      title="数据加载失败"
      :description="store.error.value"
      action-label="重试"
      test-id="models-error"
      @action="retry"
    />

    <!-- Content -->
    <template v-else>
    <!-- Model Comparison Table -->
    <div class="table-wrapper resp-table-wrapper" data-testid="models-table-wrapper">
      <table class="data-table" data-testid="models-table">
        <thead>
          <tr>
            <th class="col-sortable" @click="toggleSort('model')">
              模型 <span class="sort-arrow">{{ sortIndicator('model') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('session_count')">
              会话数 <span class="sort-arrow">{{ sortIndicator('session_count') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('message_count')">
              消息数 <span class="sort-arrow">{{ sortIndicator('message_count') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('total_tokens')">
              Token <span class="sort-arrow">{{ sortIndicator('total_tokens') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('cost_usd')">
              成本 <span class="sort-arrow">{{ sortIndicator('cost_usd') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('avg_cost_per_message')">
              平均成本/消息 <span class="sort-arrow">{{ sortIndicator('avg_cost_per_message') }}</span>
            </th>
            <th class="col-sortable col-right" @click="toggleSort('error_count')">
              错误率 <span class="sort-arrow">{{ sortIndicator('error_count') }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="sortedModels.length === 0">
            <td colspan="7" class="empty-row">暂无数据</td>
          </tr>
          <tr v-for="m in sortedModels" :key="m.model" :data-testid="`model-row-${m.model}`">
            <td class="col-monospace">{{ m.model }}</td>
            <td class="col-right">{{ formatNumber(m.session_count) }}</td>
            <td class="col-right">{{ formatNumber(m.message_count) }}</td>
            <td class="col-right">{{ formatTokens(m.total_tokens) }}</td>
            <td class="col-right">{{ formatCost(m.cost_usd) }}</td>
            <td class="col-right">{{ formatCost(m.avg_cost_per_message ?? 0) }}</td>
            <td class="col-right">
              <span class="error-rate" :class="errorRateClass(m)">
                {{ formatErrorRate(m) }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Charts Row 1: Token + Message/Session side by side -->
    <div class="charts-grid resp-two-col">
      <!-- Token Breakdown (Stacked Bar) -->
      <div class="chart-card" data-testid="token-breakdown-chart">
        <div class="chart-card-header">
          <h3 class="chart-card-title">Token 细分对比</h3>
          <span class="chart-card-subtitle">默认展示成本最高的 20 个模型</span>
        </div>
        <BarChart
          :x-data="tokenChartLabels"
          :series="tokenChartSeries"
          :stacked="true"
          height="280px"
          y-label="Token"
          :value-formatter="formatTokens"
        />
      </div>

      <!-- Message/Session Comparison (Dual-Axis Bar) -->
      <div class="chart-card" data-testid="message-session-chart">
        <div class="chart-card-header">
          <h3 class="chart-card-title">消息会话数对比</h3>
          <span class="chart-card-subtitle">仅显示会话数最多的 8 个模型</span>
        </div>
        <BarChart
          :x-data="messageSessionChartLabels"
          :series="messageSessionChartSeries"
          height="280px"
          y-label="会话数"
          right-y-label="消息数"
          :value-formatter="formatNumber"
          :right-value-formatter="formatNumber"
        />
      </div>
    </div>

    <!-- Charts Row 2: Cost Comparison (full width) -->
    <div class="chart-card chart-card-full" data-testid="cost-trend-chart">
      <div class="chart-card-header">
        <h3 class="chart-card-title">成本对比</h3>
        <span class="chart-card-subtitle">默认展示成本最高的 20 个模型</span>
      </div>
      <BarChart
        :x-data="costChartLabels"
        :series="costChartSeries"
        height="280px"
        y-label="USD"
        :value-formatter="formatCost"
      />
    </div>

    <!-- Charts Row 3: Cost-Performance Scatter (full width) -->
    <div class="chart-card chart-card-full" data-testid="cost-performance-chart">
      <div class="chart-card-header">
        <h3 class="chart-card-title">性价比分析</h3>
        <span class="chart-card-subtitle">默认展示成本最高的 20 个模型</span>
      </div>
      <ScatterChart
        :data="scatterData"
        x-label="总成本 (USD)"
        y-label="输出 Token"
        height="300px"
        :x-value-formatter="formatCost"
        :y-value-formatter="formatTokens"
      />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onActivated } from 'vue'
import { useModelsStore } from '../stores/models'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import BarChart from '../charts/BarChart.vue'
import ScatterChart from '../charts/ScatterChart.vue'
import TimeRangePicker from '../components/TimeRangePicker.vue'
import type { DashboardModelItem } from '../api/client'
import { formatNumber, formatTokens, formatCost } from '../utils/format'
import { getRangeMs, formatBucketLocal, type TimeRange } from '../utils/timezone'

// ── Store ──────────────────────────────────────────────────────────────
const store = useModelsStore()

const STALE_MS = 60_000

// ── Time Range ─────────────────────────────────────────────────────────
const selectedPeriod = ref<TimeRange>('7d')

function fetchCurrentPeriod(): void {
  const { start, end } = getRangeMs(selectedPeriod.value)
  void store.fetchModels(start, end, { range: selectedPeriod.value })
}

function retry(): void {
  fetchCurrentPeriod()
}

watch(selectedPeriod, () => fetchCurrentPeriod())

onMounted(() => {
  if (store.models.value.length === 0) fetchCurrentPeriod()
})

onActivated(() => {
  const age = store.lastFetchedAt.value
  if (age === null || Date.now() - age > STALE_MS) fetchCurrentPeriod()
})

// ── Sort State ─────────────────────────────────────────────────────────
type SortKey = keyof DashboardModelItem
const sortKey = ref<SortKey | null>(null)
const sortAsc = ref(true)

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortAsc.value = !sortAsc.value
  } else {
    sortKey.value = key
    sortAsc.value = true
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortAsc.value ? '↑' : '↓'
}

// ── Computed: sorted models ────────────────────────────────────────────
const sortedModels = computed(() => {
  const data = [...store.models.value]
  if (!sortKey.value) return data

  const key = sortKey.value
  const dir = sortAsc.value ? 1 : -1

  return data.sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb)) * dir
  })
})

// ── Chart Data: Token Breakdown ────────────────────────────────────────
const CHART_COLORS = ['#3b82f6', '#16a34a', '#d97706', '#dc2626', '#8b5cf6', '#ec4899']

const tokenChartLabels = computed(() =>
  store.models.value.map((m) => truncateModel(m.model)),
)

const tokenChartSeries = computed(() => [
  {
    name: 'Input',
    data: store.models.value.map((m) => m.input_tokens),
    color: CHART_COLORS[0],
  },
  {
    name: 'Output',
    data: store.models.value.map((m) => m.output_tokens),
    color: CHART_COLORS[1],
  },
  {
    name: 'Reasoning',
    data: store.models.value.map((m) => m.reasoning_tokens),
    color: CHART_COLORS[2],
  },
])

// ── Chart Data: Cost Trend ─────────────────────────────────────────────
const costTrendDates = computed(() => {
  const dates = new Set<string>()
  for (const p of store.modelsCostTrend.value) dates.add(p.date)
  return [...dates].sort()
})

const costChartLabels = computed(() => costTrendDates.value.map(formatBucketLocal))

const costTrendModels = computed(() => {
  const models = new Set<string>()
  for (const p of store.modelsCostTrend.value) models.add(p.model)
  return [...models]
})

const costChartSeries = computed(() => {
  const dateSet = costTrendDates.value
  return costTrendModels.value.map((model, i) => ({
    name: truncateModel(model),
    data: dateSet.map((d) => {
      const pt = store.modelsCostTrend.value.find((p) => p.date === d && p.model === model)
      return pt?.cost_usd ?? 0
    }),
    color: CHART_COLORS[i % CHART_COLORS.length],
  }))
})

// ── Chart Data: Message/Session Comparison ────────────────────────────
const messageSessionChartLabels = computed(() =>
  [...store.models.value]
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 8)
    .map((m) => truncateModel(m.model)),
)

const messageSessionChartSeries = computed(() => {
  const top8 = [...store.models.value]
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 8)
  return [
    {
      name: '会话数',
      data: top8.map((m) => m.session_count),
      color: '#3b82f6',
      yAxisIndex: 0,
    },
    {
      name: '消息数',
      data: top8.map((m) => m.message_count),
      color: '#10b981',
      yAxisIndex: 1,
    },
  ]
})

// ── Chart Data: Scatter (Cost vs Output) ───────────────────────────────
const scatterData = computed(() =>
  store.models.value.map((m) => ({
    name: truncateModel(m.model),
    x: m.cost_usd,
    y: m.output_tokens,
    size: Math.max(8, Math.min(30, m.session_count / 2)),
  })),
)

// ── Formatting Helpers ─────────────────────────────────────────────────
function truncateModel(model: string): string {
  if (model.length <= 20) return model
  // Show last 18 chars with ellipsis prefix
  return '…' + model.slice(-18)
}

function formatErrorRate(m: DashboardModelItem): string {
  if (m.error_rate === null || m.error_rate === undefined) return '—'
  return `${(m.error_rate * 100).toFixed(1)}%`
}

function errorRateClass(m: DashboardModelItem): string {
  if (m.error_rate === null || m.error_rate === undefined) return ''
  const pct = m.error_rate * 100
  if (pct >= 5) return 'rate-high'
  if (pct >= 2) return 'rate-medium'
  return 'rate-low'
}
</script>

<style scoped>
/* ── View Container ─────────────────────────────────────────────────── */
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

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

/* ── Data Table ─────────────────────────────────────────────────────── */
.table-wrapper {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-base);
}

.data-table th {
  padding: var(--spacing-2) var(--spacing-3);
  background-color: var(--surface);
  border-bottom: 1px solid var(--border);
  text-align: center;
  font-weight: 600;
  color: var(--text-muted);
  font-size: var(--text-sm);
  white-space: nowrap;
  user-select: none;
}

.data-table td {
  padding: var(--spacing-2) var(--spacing-3);
  border-bottom: 1px solid rgba(51, 65, 85, 0.4);
  color: var(--text);
  white-space: nowrap;
  text-align: center;
}

.data-table tbody tr:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.col-sortable {
  cursor: pointer;
}

.col-sortable:hover {
  color: var(--text);
}

.sort-arrow {
  font-size: var(--text-xs);
  opacity: 0.6;
}

.col-right {
  text-align: center;
}

.col-monospace {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
}

.empty-row {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Error Rate ─────────────────────────────────────────────────────── */
.error-rate {
  font-weight: 600;
  font-size: var(--text-sm);
}

.rate-low {
  color: var(--success);
}

.rate-medium {
  color: var(--warning);
}

.rate-high {
  color: var(--danger);
}

/* ── Charts Grid ────────────────────────────────────────────────────── */
.charts-grid {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-4);
}

.chart-card {
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.chart-card-full {
  grid-column: 1 / -1;
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

</style>
