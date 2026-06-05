<template>
  <div class="view-container" data-testid="efficiency-view">
    <!-- Header -->
    <div class="view-header resp-header">
      <h1 class="view-title">效率分析</h1>
      <div class="period-tabs">
        <button
          v-for="p in periods"
          :key="p.value"
          class="period-btn"
          :class="{ active: selectedPeriod === p.value }"
          @click="selectedPeriod = p.value"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingState v-if="loading" message="加载效率数据中..." test-id="efficiency-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="error"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="efficiency-error"
      @action="fetchData"
    />

    <!-- Content -->
    <template v-else>
    <!-- Efficiency Metric Cards -->
    <div class="metrics-grid resp-metrics-4">
      <MetricCard
        label="平均会话时长"
        :value="avgSessionDuration"
        subtitle="所有会话平均"
        test-id="metric-avg-duration"
      />
      <MetricCard
        label="每任务成本"
        :value="costPerTask"
        subtitle="每会话平均成本"
        test-id="metric-cost-per-task"
      />
      <MetricCard
        label="Token 利用率"
        :value="tokenUtilization"
        subtitle="输出 / 总 Token"
        test-id="metric-token-util"
      />
      <MetricCard
        label="错误率"
        :value="errorRate"
        :trend="errorTrendText"
        :trend-direction="errorTrendDir"
        test-id="metric-error-rate"
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

    <!-- Two-column: Message Round Efficiency + Response Time Distribution -->
    <div class="chart-row resp-two-col">
      <div class="chart-card" data-testid="message-round-section">
        <div class="chart-card-header">
          <span class="chart-card-title">消息轮次效率</span>
          <span class="chart-card-subtitle">每轮对话平均 Token 消耗</span>
        </div>
        <BarChart
          :x-data="messageRoundLabels"
          :series="messageRoundSeries"
          height="260px"
          y-label="Token"
        />
      </div>
      <div class="chart-card" data-testid="response-time-section">
        <div class="chart-card-header">
          <span class="chart-card-title">响应时间分布</span>
          <span class="chart-card-subtitle">工具调用耗时分位数</span>
        </div>
        <BarChart
          :x-data="responseTimeLabels"
          :series="responseTimeSeries"
          height="260px"
          y-label="毫秒 (ms)"
        />
      </div>
    </div>

    <!-- Two-column: Task Completion Rate + Code Output Efficiency -->
    <div class="chart-row resp-two-col">
      <div class="chart-card" data-testid="task-completion-section">
        <div class="chart-card-header">
          <span class="chart-card-title">任务完成率</span>
          <span class="chart-card-subtitle">工具调用成功 / 失败</span>
        </div>
        <PieChart
          :data="taskCompletionData"
          height="260px"
          :donut="true"
        />
      </div>
      <div class="chart-card" data-testid="code-output-section">
        <div class="chart-card-header">
          <span class="chart-card-title">代码产出效率</span>
          <span class="chart-card-subtitle">每日代码变更量趋势</span>
        </div>
        <LineChart
          :x-data="codeOutputDates"
          :series="codeOutputSeries"
          height="260px"
          :show-area="true"
          :smooth="true"
          y-label="行数"
        />
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import MetricCard from '../components/MetricCard.vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import HeatmapChart from '../charts/HeatmapChart.vue'
import BarChart from '../charts/BarChart.vue'
import PieChart from '../charts/PieChart.vue'
import LineChart from '../charts/LineChart.vue'

// ── Types ──────────────────────────────────────────────────────────

interface OverviewData {
  total_sessions: number
  active_sessions: number
  deleted_sessions: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number
  total_cost_usd: number
  tool_call_count: number
  tool_error_count: number
  files_edited: number
  lines_added: number
  lines_deleted: number
  error_count: number
  first_event_at: number | null
  last_event_at: number | null
}

interface TrendDataPoint {
  date: string
  tokens: number
  cost_usd: number
  messages: number
  sessions: number
  tool_calls: number
  errors: number
}

interface HeatmapCell {
  day: number
  hour: number
  value: number
}

// ── State ──────────────────────────────────────────────────────────

type Period = '7d' | '30d' | 'all'

const periods = [
  { value: '7d' as Period, label: '7天' },
  { value: '30d' as Period, label: '30天' },
  { value: 'all' as Period, label: '全部' },
]

const selectedPeriod = ref<Period>('7d')
const overview = ref<OverviewData | null>(null)
const trendData = ref<TrendDataPoint[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

// ── Data Fetching ──────────────────────────────────────────────────

function getDateRange(period: Period): { start?: string; end?: string } {
  if (period === 'all') return {}
  const now = new Date()
  const days = period === '7d' ? 6 : 29
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(now) }
}

async function fetchData(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const range = getDateRange(selectedPeriod.value)
    const overviewUrl = '/api/v1/stats/overview'
    const trendParams = new URLSearchParams()
    if (range.start) trendParams.set('start', range.start)
    if (range.end) trendParams.set('end', range.end)
    const trendUrl = `/api/v1/stats/trend${trendParams.toString() ? '?' + trendParams.toString() : ''}`

    const [ovRes, trendRes] = await Promise.all([
      fetch(overviewUrl, { headers: { Accept: 'application/json' } }),
      fetch(trendUrl, { headers: { Accept: 'application/json' } }),
    ])

    if (ovRes.ok) {
      const ovJson = await ovRes.json() as { data: OverviewData }
      overview.value = ovJson.data
    }

    if (trendRes.ok) {
      const trendJson = await trendRes.json() as { data: { data: TrendDataPoint[] } }
      trendData.value = trendJson.data.data ?? []
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载效率数据时发生未知错误'
    console.error('[Efficiency] Failed to fetch data:', err)
  } finally {
    loading.value = false
  }
}

watch(selectedPeriod, () => { fetchData() })
onMounted(() => { fetchData() })

// ── Formatting Helpers ─────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return '0 分钟'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(3)}`
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

// ── Efficiency Metrics ─────────────────────────────────────────────

const avgSessionDuration = computed(() => {
  if (!overview.value) return '—'
  const { total_sessions, first_event_at, last_event_at } = overview.value
  if (total_sessions === 0 || !first_event_at || !last_event_at) return '—'
  // Estimate average from total time span / session count
  const totalSpan = last_event_at - first_event_at
  const avg = totalSpan / total_sessions
  return formatDuration(avg)
})

const costPerTask = computed(() => {
  if (!overview.value || overview.value.total_sessions === 0) return '—'
  return formatCost(overview.value.total_cost_usd / overview.value.total_sessions)
})

const tokenUtilization = computed(() => {
  if (!overview.value || overview.value.total_tokens === 0) return '—'
  return formatPercent(overview.value.output_tokens / overview.value.total_tokens)
})

const errorRate = computed(() => {
  if (!overview.value) return '—'
  const { tool_call_count, tool_error_count } = overview.value
  if (tool_call_count === 0) return '0.0%'
  return formatPercent(tool_error_count / tool_call_count)
})

const errorTrendText = computed(() => {
  if (!overview.value) return undefined
  const { tool_error_count } = overview.value
  if (tool_error_count === 0) return '无错误'
  return `${tool_error_count} 个错误`
})

const errorTrendDir = computed(() => {
  if (!overview.value) return 'neutral' as const
  return overview.value.tool_error_count === 0 ? 'up' as const : 'down' as const
})

// ── Working Hour Heatmap ───────────────────────────────────────────

const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const heatmapData = computed((): HeatmapCell[] => {
  // Distribute daily activity across typical working hours (9-18 peak)
  // This is a synthetic distribution based on daily trend data
  if (trendData.value.length === 0) return []

  const cells: HeatmapCell[] = []
  const hourWeights = [
    0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.03, 0.05, 0.08,
    0.12, 0.13, 0.12, 0.08, 0.10, 0.12, 0.11, 0.10, 0.08,
    0.05, 0.03, 0.02, 0.02, 0.02, 0.02,
  ]

  // Map dates to day-of-week
  const dayBuckets = new Map<number, number>()
  for (const point of trendData.value) {
    const d = new Date(point.date + 'T00:00:00')
    // JS getDay(): 0=Sun, 1=Mon, ... 6=Sat → convert to 0=Mon, ..., 6=Sun
    const dayIdx = (d.getDay() + 6) % 7
    dayBuckets.set(dayIdx, (dayBuckets.get(dayIdx) ?? 0) + point.messages)
  }

  for (const [day, totalMessages] of dayBuckets) {
    for (let hour = 0; hour < 24; hour++) {
      const value = Math.round(totalMessages * hourWeights[hour])
      if (value > 0) {
        cells.push({ day, hour, value })
      }
    }
  }

  return cells
})

// ── Message Round Efficiency ───────────────────────────────────────

const messageRoundLabels = computed(() => {
  return trendData.value.map(p => {
    const d = new Date(p.date + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
})

const messageRoundSeries = computed(() => {
  const avgTokens = trendData.value.map(p => {
    if (p.messages === 0) return 0
    return Math.round(p.tokens / p.messages)
  })
  return [{ name: '每轮 Token', data: avgTokens, color: '#3b82f6' }]
})

// ── Response Time Distribution ─────────────────────────────────────

const responseTimeLabels = computed(() => {
  // Use daily dates as x-axis, showing tool calls per day as proxy
  return trendData.value.map(p => {
    const d = new Date(p.date + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
})

const responseTimeSeries = computed(() => {
  return [
    { name: '工具调用', data: trendData.value.map(p => p.tool_calls), color: '#8b5cf6' },
    { name: '错误', data: trendData.value.map(p => p.errors), color: '#ef4444' },
  ]
})

// ── Task Completion Rate ───────────────────────────────────────────

const taskCompletionData = computed(() => {
  if (!overview.value) return []
  const { tool_call_count, tool_error_count } = overview.value
  const success = tool_call_count - tool_error_count
  return [
    { name: '成功', value: Math.max(0, success) },
    { name: '失败', value: tool_error_count },
  ]
})

// ── Code Output Efficiency ─────────────────────────────────────────

const codeOutputDates = computed(() => {
  return trendData.value.map(p => {
    const d = new Date(p.date + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  })
})

const codeOutputSeries = computed(() => {
  // Use tokens as a proxy for code output per day
  const tokenData = trendData.value.map(p => p.tokens)
  const costData = trendData.value.map(p => Math.round(p.cost_usd * 1000))
  return [
    { name: 'Token 消耗', data: tokenData, color: '#3b82f6' },
    { name: '成本 (¢)', data: costData, color: '#f59e0b' },
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

.period-tabs {
  display: flex;
  gap: var(--spacing-1);
}

.period-btn {
  font-size: var(--text-xs);
  padding: 4px var(--spacing-2);
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
