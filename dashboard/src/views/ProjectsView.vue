<template>
  <div class="view-container" data-testid="projects-view">
    <div class="view-header resp-header">
      <h1 class="view-title">项目对比</h1>
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

    <!-- Loading State (initial no-data only) -->
    <LoadingState v-if="store.loading.value && store.projects.value.length === 0" message="加载项目数据中..." test-id="projects-loading" />

    <!-- Error State (no-data only; preserves content when data exists) -->
    <EmptyState
      v-else-if="store.error.value && store.projects.value.length === 0"
      variant="error"
      title="数据加载失败"
      :description="store.error.value"
      action-label="重试"
      test-id="projects-error"
      @action="refreshData"
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
              :class="{ sorted: sortKey === 'cost_usd' }"
              @click="toggleSort('cost_usd')"
            >
              成本
              <span class="sort-indicator">{{ sortIndicator('cost_usd') }}</span>
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
            <td class="col-number">{{ formatCost(project.cost_usd) }}</td>
            <td class="col-model">
              <span v-if="project.primary_model" class="model-tag">{{ project.primary_model }}</span>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="col-date">{{ formatLastActive(project.last_event_at_ms) }}</td>
          </tr>
          <tr v-if="store.projects.value.length === 0 && !store.loading.value">
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
          :loading="store.loading.value"
          height="280px"
          y-label="会话数"
          :smooth="true"
          :show-area="true"
        />
      </div>
    </div>

    <div class="charts-row">
      <!-- Model Usage Distribution -->
      <div class="chart-card" data-testid="model-distribution-chart">
        <div class="chart-header">
          <span class="chart-title">模型使用分布</span>
        </div>
        <BarChart
          :x-data="modelProjectNames"
          :series="modelSeries"
          :loading="store.loading.value"
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
          :loading="store.loading.value"
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
import { ref, computed, onMounted, onActivated } from 'vue'
import { useProjectsStore } from '../stores/projects'
import { fetchDashboardTools, type DashboardToolItem } from '../api/client'
import EmptyState from '../components/EmptyState.vue'
import LoadingState from '../components/LoadingState.vue'
import { formatRelativeTimeFromDate } from '../utils/timezone'
import { formatNumber, formatTokens, formatCost } from '../utils/format'
import LineChart from '../charts/LineChart.vue'
import BarChart from '../charts/BarChart.vue'

// ── Store ──────────────────────────────────────────────────────────

const store = useProjectsStore()
const toolCalls = ref<DashboardToolItem[]>([])

// ── Period ─────────────────────────────────────────────────────────

type Period = '7d' | '30d' | 'all'

const periods: Array<{ value: Period; label: string }> = [
  { value: '7d', label: '7天' },
  { value: '30d', label: '30天' },
  { value: 'all', label: '全部' },
]

const selectedPeriod = ref<Period>('7d')

function getDateRange(period: Period): { start?: number; end?: number } {
  if (period === 'all') return {}
  const now = Date.now()
  const msPerDay = 86_400_000
  const days = period === '7d' ? 6 : 29
  return { start: now - days * msPerDay, end: now }
}

function selectPeriod(period: Period): void {
  selectedPeriod.value = period
  const { start, end } = getDateRange(period)
  void store.fetchProjects(start, end)
  void fetchTools(start, end)
}

function refreshData(): void {
  const { start, end } = getDateRange(selectedPeriod.value)
  void store.fetchProjects(start, end)
  void fetchTools(start, end)
}

async function fetchTools(start?: number, end?: number): Promise<void> {
  try {
    const data = await fetchDashboardTools(start, end)
    toolCalls.value = data.tools
  } catch {
    // Tool calls fetch failure is non-critical
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────

const STALE_MS = 60_000

onMounted(() => {
  const { start, end } = getDateRange(selectedPeriod.value)
  void store.fetchProjects(start, end)
  void fetchTools(start, end)
})

onActivated(() => {
  const last = store.lastFetchedAt.value
  if (last === null || Date.now() - last > STALE_MS) {
    const { start, end } = getDateRange(selectedPeriod.value)
    void store.fetchProjects(start, end)
    void fetchTools(start, end)
  }
})

// ── Sorting ────────────────────────────────────────────────────────

type SortKey = 'project_path' | 'session_count' | 'total_tokens' | 'cost_usd'
const sortKey = ref<SortKey>('cost_usd')
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
  const list = [...store.projects.value]
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

// ── Trend Chart Data (per-project activity trend) ──────────────────

const trendDates = computed(() => {
  const dates = new Set<string>()
  for (const point of store.activityTrend.value) {
    dates.add(point.date)
  }
  return [...dates].sort()
})

const trendSeries = computed(() => {
  const usage = store.activityTrend.value
  if (usage.length === 0) return []

  // Get top 5 projects by total sessions in the trend data
  const projectSessions = new Map<string, number>()
  for (const point of usage) {
    projectSessions.set(point.project_path, (projectSessions.get(point.project_path) ?? 0) + point.sessions)
  }
  const top5 = [...projectSessions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([path]) => path)

  const projectColors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6']

  return top5.map((projectPath, idx) => {
    const data = trendDates.value.map((date) => {
      const point = usage.find((p) => p.project_path === projectPath && p.date === date)
      return point?.sessions ?? 0
    })
    return {
      name: truncatePath(projectPath),
      data,
      color: projectColors[idx % projectColors.length],
    }
  })
})

// ── Model Distribution Chart Data (from project_model_usage) ──────

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

const modelProjectNames = computed(() => {
  const usage = store.projectModelUsage.value
  const projectMessages = new Map<string, number>()
  for (const item of usage) {
    projectMessages.set(item.project_path, (projectMessages.get(item.project_path) ?? 0) + item.messages)
  }
  return [...projectMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path]) => truncatePath(path))
})

const modelSeries = computed(() => {
  const usage = store.projectModelUsage.value
  if (usage.length === 0) return []

  // Get top 8 projects by total messages
  const projectMessages = new Map<string, number>()
  for (const item of usage) {
    projectMessages.set(item.project_path, (projectMessages.get(item.project_path) ?? 0) + item.messages)
  }
  const topProjects = [...projectMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([path]) => path)

  // Get top 5 models across all projects
  const modelMessages = new Map<string, number>()
  for (const item of usage) {
    modelMessages.set(item.model, (modelMessages.get(item.model) ?? 0) + item.messages)
  }
  const topModels = [...modelMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([model]) => model)

  return topModels.map((model, idx) => {
    const data = topProjects.map((projectPath) => {
      const item = usage.find((u) => u.project_path === projectPath && u.model === model)
      return item?.messages ?? 0
    })
    return {
      name: model,
      data,
      color: CHART_COLORS[idx % CHART_COLORS.length],
    }
  })
})

// ── Tool Distribution Chart Data ──────────────────────────────────

const toolNames = computed(() => toolCalls.value.slice(0, 10).map((t) => t.tool_name))

const toolSeries = computed(() => {
  if (toolCalls.value.length === 0) return []
  return [
    {
      name: '调用次数',
      data: toolCalls.value.slice(0, 10).map((t) => t.call_count),
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
  text-align: center;
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
