<template>
  <div class="view-container" data-testid="projects-view">
    <div class="view-header resp-header">
      <h1 class="view-title">项目对比</h1>
      <div class="time-range-selector">
        <button
          v-for="range in timeRanges"
          :key="range.value"
          class="range-btn"
          :class="{ active: selectedRange === range.value }"
          @click="selectRange(range.value)"
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <LoadingState v-if="loading" message="加载项目数据中..." test-id="projects-loading" />

    <!-- Error State -->
    <EmptyState
      v-else-if="error"
      variant="error"
      title="数据加载失败"
      :description="error"
      action-label="重试"
      test-id="projects-error"
      @action="loadAllData"
    />

    <!-- Content -->
    <template v-else>
    <!-- Project List Table -->
    <div class="table-wrapper resp-table-wrapper" data-testid="projects-table">
      <table class="data-table">
        <thead>
          <tr>
            <th
              class="col-project sortable"
              :class="{ sorted: sortKey === 'project_path' }"
              @click="toggleSort('project_path')"
            >
              项目路径
              <span class="sort-indicator">{{ sortIndicator('project_path') }}</span>
            </th>
            <th
              class="col-number sortable"
              :class="{ sorted: sortKey === 'session_count' }"
              @click="toggleSort('session_count')"
            >
              会话数
              <span class="sort-indicator">{{ sortIndicator('session_count') }}</span>
            </th>
            <th
              class="col-number sortable"
              :class="{ sorted: sortKey === 'total_tokens' }"
              @click="toggleSort('total_tokens')"
            >
              Token
              <span class="sort-indicator">{{ sortIndicator('total_tokens') }}</span>
            </th>
            <th
              class="col-number sortable"
              :class="{ sorted: sortKey === 'total_cost_usd' }"
              @click="toggleSort('total_cost_usd')"
            >
              成本
              <span class="sort-indicator">{{ sortIndicator('total_cost_usd') }}</span>
            </th>
            <th class="col-model">主模型</th>
            <th class="col-date">最后活跃</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="project in sortedProjects" :key="project.project_path">
            <td class="col-project" :title="project.project_path">
              <span class="project-path">{{ truncatePath(project.project_path) }}</span>
            </td>
            <td class="col-number">{{ formatNumber(project.session_count) }}</td>
            <td class="col-number">{{ formatTokens(project.total_tokens) }}</td>
            <td class="col-number">{{ formatCost(project.total_cost_usd) }}</td>
            <td class="col-model">
              <span v-if="project.primary_model" class="model-tag">{{ project.primary_model }}</span>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="col-date">{{ formatLastActive(project.last_event_at) }}</td>
          </tr>
          <tr v-if="projects.length === 0 && !loading">
            <td colspan="6" class="empty-state">暂无项目数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Project Activity Trend -->
      <div class="chart-card" data-testid="activity-trend-chart">
        <div class="chart-header">
          <span class="chart-title">项目活跃度趋势</span>
        </div>
        <LineChart
          :x-data="trendDates"
          :series="trendSeries"
          :loading="loading"
          height="280px"
          y-label="会话数"
          :smooth="true"
          :show-area="true"
        />
      </div>
    </div>

    <div class="charts-row charts-row-split resp-two-col">
      <!-- Model Usage Distribution -->
      <div class="chart-card" data-testid="model-distribution-chart">
        <div class="chart-header">
          <span class="chart-title">模型使用分布</span>
        </div>
        <BarChart
          :x-data="modelProjectNames"
          :series="modelSeries"
          :loading="loading"
          height="280px"
          :stacked="true"
          y-label="会话数"
        />
      </div>

      <!-- Tool Usage Distribution -->
      <div class="chart-card" data-testid="tool-distribution-chart">
        <div class="chart-header">
          <span class="chart-title">工具使用分布</span>
        </div>
        <BarChart
          :x-data="toolNames"
          :series="toolSeries"
          :loading="loading"
          height="280px"
          y-label="调用次数"
          :horizontal="true"
        />
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import {
  fetchStatsProjects,
  fetchStatsTrend,
  fetchStatsModels,
  fetchStatsTools,
  type ProjectStatsItem,
  type TrendDataPoint,
  type StatsModelItem,
  type ToolStatsItem,
} from '../api/client'
import { formatRelativeTimeFromDate } from '../utils/timezone'
import LineChart from '../charts/LineChart.vue'
import BarChart from '../charts/BarChart.vue'

// ── Time Range ─────────────────────────────────────────────────────

type TimeRange = '7d' | '30d' | '90d' | 'all'

const timeRanges: Array<{ value: TimeRange; label: string }> = [
  { value: '7d', label: '7 天' },
  { value: '30d', label: '30 天' },
  { value: '90d', label: '90 天' },
  { value: 'all', label: '全部' },
]

const selectedRange = ref<TimeRange>('30d')

function getDateRange(): { start?: string; end?: string } {
  if (selectedRange.value === 'all') return {}
  const now = new Date()
  const days = selectedRange.value === '7d' ? 7 : selectedRange.value === '30d' ? 30 : 90
  const start = new Date(now)
  start.setDate(start.getDate() - days)
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(now) }
}

function selectRange(range: TimeRange): void {
  selectedRange.value = range
  loadAllData()
}

// ── Data State ─────────────────────────────────────────────────────

const loading = ref(false)
const error = ref<string | null>(null)
const projects = ref<ProjectStatsItem[]>([])
const trendData = ref<TrendDataPoint[]>([])
const modelData = ref<StatsModelItem[]>([])
const toolData = ref<ToolStatsItem[]>([])

async function loadAllData(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const params = getDateRange()
    const [projResult, trendResult, modelResult, toolResult] = await Promise.all([
      fetchStatsProjects(params),
      fetchStatsTrend(params),
      fetchStatsModels(params),
      fetchStatsTools(params),
    ])
    projects.value = projResult.projects
    trendData.value = trendResult.data
    modelData.value = modelResult.models
    toolData.value = toolResult.tools
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载项目数据时发生未知错误'
    console.error('[Projects] Failed to load data:', err)
  } finally {
    loading.value = false
  }
}

onMounted(loadAllData)

// ── Sorting ────────────────────────────────────────────────────────

type SortKey = 'project_path' | 'session_count' | 'total_tokens' | 'total_cost_usd'
const sortKey = ref<SortKey>('total_cost_usd')
const sortDir = ref<'asc' | 'desc'>('desc')

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = key === 'project_path' ? 'asc' : 'desc'
  }
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const sortedProjects = computed(() => {
  const list = [...projects.value]
  list.sort((a, b) => {
    const aVal = a[sortKey.value] ?? ''
    const bVal = b[sortKey.value] ?? ''
    let cmp = 0
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal
    } else {
      cmp = String(aVal).localeCompare(String(bVal))
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })
  return list
})

// ── Trend Chart Data ───────────────────────────────────────────────

const trendDates = computed(() => trendData.value.map((d) => d.date))

const trendSeries = computed(() => {
  if (projects.value.length === 0) return []
  const top5 = [...projects.value]
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 5)
    .map((p) => p.project_path)

  const projectColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']

  return top5.map((projectPath, idx) => {
    const data = trendData.value.map((d) => {
      const match = d
      return match.sessions
    })
    return {
      name: truncatePath(projectPath),
      data,
      color: projectColors[idx % projectColors.length],
    }
  })
})

// ── Model Distribution Chart Data ──────────────────────────────────

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const modelProjectNames = computed(() => {
  return projects.value.slice(0, 8).map((p) => truncatePath(p.project_path))
})

const modelSeries = computed(() => {
  if (modelData.value.length === 0) return []

  const topModels = [...modelData.value]
    .sort((a, b) => b.session_count - a.session_count)
    .slice(0, 5)
    .map((m) => m.model)

  return topModels.map((model, idx) => {
    const data = projects.value.slice(0, 8).map(() => {
      const modelItem = modelData.value.find((m) => m.model === model)
      return modelItem ? Math.round(modelItem.session_count / Math.max(projects.value.length, 1)) : 0
    })
    return {
      name: model,
      data,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }
  })
})

// ── Tool Distribution Chart Data ───────────────────────────────────

const toolNames = computed(() => toolData.value.slice(0, 10).map((t) => t.tool_name))

const toolSeries = computed(() => {
  if (toolData.value.length === 0) return []
  return [
    {
      name: '调用次数',
      data: toolData.value.slice(0, 10).map((t) => t.call_count),
      color: '#3b82f6',
    },
  ]
})

// ── Formatters ─────────────────────────────────────────────────────

function truncatePath(path: string): string {
  if (path.length <= 35) return path
  const parts = path.split('/')
  if (parts.length <= 3) return '…' + path.slice(-33)
  return parts[0] + '/…/' + parts.slice(-2).join('/')
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return tokens.toLocaleString()
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`
}

function formatLastActive(ts: number | null): string {
  if (ts === null) return '—'
  return formatRelativeTimeFromDate(new Date(ts))
}
</script>

<style scoped>
.view-container {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-4);
}

.view-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--spacing-3);
}

.view-title {
  font-size: var(--text-2xl);
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.time-range-selector {
  display: flex;
  gap: var(--spacing-1);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.range-btn {
  font-size: var(--text-xs);
  padding: var(--spacing-1) var(--spacing-2);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  background: transparent;
  color: var(--text-muted);
  transition: all 0.15s ease;
  line-height: 1.4;
  white-space: nowrap;
}

.range-btn:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.05);
}

.range-btn.active {
  background: var(--primary);
  color: #fff;
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
  text-align: left;
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
}

.data-table tbody tr {
  transition: background-color 0.1s ease;
}

.data-table tbody tr:hover {
  background: rgba(255, 255, 255, 0.03);
}

.col-project {
  min-width: 180px;
  max-width: 350px;
}

.project-path {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: var(--text-sm);
  color: var(--primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 320px;
}

.col-number {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  min-width: 80px;
}

.col-model {
  min-width: 100px;
}

.model-tag {
  display: inline-block;
  padding: 1px var(--spacing-2);
  border-radius: var(--radius-lg);
  font-size: var(--text-xs);
  font-weight: 500;
  color: var(--primary);
  background: rgba(59, 130, 246, 0.1);
}

.col-date {
  white-space: nowrap;
  min-width: 100px;
  color: var(--text-muted);
  font-size: var(--text-sm);
}

.text-muted {
  color: var(--text-muted);
}

.empty-state {
  text-align: center;
  color: var(--text-muted);
  padding: var(--spacing-6) !important;
  font-style: italic;
}

/* ── Charts ─────────────────────────────────────────────────────────── */

.charts-row {
  display: flex;
  gap: var(--spacing-3);
}

.charts-row-split {
  /* Grid handled by .resp-two-col utility */
  gap: var(--spacing-3);
}

.chart-card {
  flex: 1;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.chart-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
}

</style>
