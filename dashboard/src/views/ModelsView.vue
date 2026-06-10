<template>
  <div class="view-container" data-testid="models-view">
    <!-- Header -->
    <div class="view-header resp-header">
      <h1 class="view-title">模型对比</h1>
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

    <!-- Loading State -->
    <LoadingState v-if="store.loading.value" message="加载模型数据中..." test-id="models-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="store.error.value"
      variant="error"
      title="数据加载失败"
      :description="store.error.value"
      action-label="重试"
      test-id="models-error"
      @action="store.refreshData"
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
            <td colspan="6" class="empty-row">暂无数据</td>
          </tr>
          <tr v-for="m in sortedModels" :key="m.model" :data-testid="`model-row-${m.model}`">
            <td class="col-monospace">{{ m.model }}</td>
            <td class="col-right">{{ formatNumber(m.session_count) }}</td>
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

    <!-- Charts Grid -->
    <div class="charts-grid resp-two-col">
      <!-- Token Breakdown (Stacked Bar) -->
      <div class="chart-card" data-testid="token-breakdown-chart">
        <h3 class="chart-title">Token 细分对比</h3>
        <BarChart
          :x-data="tokenChartLabels"
          :series="tokenChartSeries"
          :stacked="true"
          height="280px"
          y-label="Token"
        />
      </div>

      <!-- Cost Comparison (Bar) -->
      <div class="chart-card" data-testid="cost-trend-chart">
        <h3 class="chart-title">成本对比</h3>
        <BarChart
          :x-data="costChartLabels"
          :series="costChartSeries"
          height="280px"
          y-label="USD"
        />
      </div>
    </div>

    <!-- Cost-Performance Scatter -->
    <div class="chart-card chart-card-full" data-testid="cost-performance-chart">
      <h3 class="chart-title">性价比分析</h3>
      <ScatterChart
        :data="scatterData"
        x-label="总成本 (USD)"
        y-label="输出 Token"
        height="300px"
      />
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useStatsStore } from '../stores/stats'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import BarChart from '../charts/BarChart.vue'
import ScatterChart from '../charts/ScatterChart.vue'
import type { DashboardModelItem } from '../api/client'

// ── Store ──────────────────────────────────────────────────────────────
const store = useStatsStore()

// ── Time Range ─────────────────────────────────────────────────────────
type Period = '7d' | '30d' | 'all'

const periods = [
  { value: '7d' as Period, label: '7天' },
  { value: '30d' as Period, label: '30天' },
  { value: 'all' as Period, label: '全部' },
]

const selectedPeriod = ref<Period>('all')

function selectPeriod(p: Period): void {
  selectedPeriod.value = p
}

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

// ── Chart Data: Cost Comparison ────────────────────────────────────────
const costChartLabels = computed(() =>
  store.models.value.map((m) => truncateModel(m.model)),
)

const costChartSeries = computed(() => [
  {
    name: '总成本',
    data: store.models.value.map((m) => m.cost_usd),
    color: CHART_COLORS[0],
  },
])

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

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
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

/* ── Period Tabs ────────────────────────────────────────────────────── */
.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-xs);
  padding: var(--spacing-1) var(--spacing-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background-color: transparent;
  color: var(--text-muted);
  transition: all 0.15s ease;
  line-height: 1.4;
}

.period-btn:hover {
  color: var(--text);
  border-color: var(--text-muted);
}

.period-btn.active {
  background-color: var(--primary);
  border-color: var(--primary);
  color: white;
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

.chart-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

</style>
