<template>
  <div class="view-container" data-testid="projects-view">
    <div class="view-header resp-header">
      <h1 class="view-title">项目对比</h1>
      <TimeRangePicker v-model="selectedPeriod" />
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
              :class="{ sorted: sortKey === 'message_count' }"
              @click="toggleSort('message_count')"
            >
              消息数
              <span class="sort-indicator">{{ sortIndicator('message_count') }}</span>
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
            <td class="col-number">{{ formatNumber(project.message_count) }}</td>
            <td class="col-number">{{ formatTokens(project.total_tokens) }}</td>
            <td class="col-number">{{ formatCost(project.cost_usd) }}</td>
            <td class="col-model">
              <span v-if="project.primary_model" class="model-tag">{{ project.primary_model }}</span>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="col-date">{{ formatLastActive(project.last_event_at_ms) }}</td>
          </tr>
          <tr v-if="store.projects.value.length === 0 && !store.loading.value">
            <td colspan="7" class="empty-state">暂无项目数据</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Charts Row -->
    <div class="charts-row">
      <!-- Project Activity Trend -->
      <div class="chart-card" data-testid="activity-trend-chart">
        <div class="chart-card-header">
          <span class="chart-card-title">项目活跃度趋势</span>
          <span class="chart-card-subtitle">仅显示消息最多的 6 个项目</span>
        </div>
        <LineChart
          :x-data="trendDateLabels"
          :series="trendSeries"
          :loading="store.loading.value"
          height="280px"
          y-label="消息数"
          :value-formatter="formatNumber"
          :smooth="true"
          :show-area="true"
          :show-legend="true"
        />
      </div>
    </div>

    <div class="chart-card" data-testid="model-distribution">
      <div class="chart-card-header">
        <h3 class="chart-card-title">模型分布</h3>
        <span class="chart-card-subtitle">仅显示消息最多的 8 个项目 × 5 个模型</span>
      </div>
      <div class="shared-legend" v-if="topModels.length > 1">
        <button
          v-for="model in topModels"
          :key="model.name"
          type="button"
          class="legend-item"
          :class="{ dimmed: hiddenModels.has(model.name) }"
          @click="toggleModel(model.name)"
        >
          <span class="legend-dot" :style="{ background: model.color }" />
          <span class="legend-label">{{ model.name }}</span>
        </button>
      </div>
      <div class="distribution-panes">
        <div class="chart-pane">
          <h4 class="chart-pane-title">会话分布</h4>
          <BarChart
            :x-data="modelProjectNames"
            :series="sessionSeries"
            :loading="store.loading.value"
            height="280px"
            :stacked="true"
            y-label="会话数"
            :show-legend="false"
          />
        </div>
        <div class="chart-pane">
          <h4 class="chart-pane-title">消息分布</h4>
          <BarChart
            :x-data="modelProjectNames"
            :series="messageSeries"
            :loading="store.loading.value"
            height="280px"
            :stacked="true"
            y-label="消息数"
            :show-legend="false"
          />
        </div>
      </div>
    </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";
import BarChart from "../charts/BarChart.vue";
import LineChart from "../charts/LineChart.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import TimeRangePicker from "../components/TimeRangePicker.vue";
import { useProjectsStore } from "../stores/projects";
import { formatCost, formatNumber, formatTokens } from "../utils/format";
import {
  formatBucketLocal,
  formatRelativeTimeFromDate,
  getRangeMs,
  type TimeRange,
} from "../utils/timezone";

// ── Store ──────────────────────────────────────────────────────────

const store = useProjectsStore();

// ── Period ─────────────────────────────────────────────────────────

const selectedPeriod = ref<TimeRange>("7d");

function refreshWithSort(): void {
  const { start, end } = getRangeMs(selectedPeriod.value);
  void store.fetchProjects(
    start,
    end,
    { sort: sortKey.value, order: sortDir.value },
    { range: selectedPeriod.value },
  );
}

function refreshData(): void {
  refreshWithSort();
}

watch(selectedPeriod, () => {
  refreshWithSort();
});

// ── Lifecycle ──────────────────────────────────────────────────────

const STALE_MS = 60_000;

onMounted(() => {
  refreshWithSort();
});

onActivated(() => {
  const last = store.lastFetchedAt.value;
  if (last === null || Date.now() - last > STALE_MS) {
    refreshWithSort();
  }
});

// ── Sorting ────────────────────────────────────────────────────────

type SortKey =
  | "project_path"
  | "session_count"
  | "message_count"
  | "total_tokens"
  | "cost_usd";
const sortKey = ref<SortKey>("cost_usd");
const sortDir = ref<"asc" | "desc">("desc");

function toggleSort(key: SortKey): void {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
  } else {
    sortKey.value = key;
    sortDir.value = key === "project_path" ? "asc" : "desc";
  }
  refreshWithSort();
}

function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return "↕";
  return sortDir.value === "asc" ? "↑" : "↓";
}

const sortedProjects = computed(() => {
  const list = [...store.projects.value];
  list.sort((a, b) => {
    const aVal = a[sortKey.value] ?? "";
    const bVal = b[sortKey.value] ?? "";
    let cmp = 0;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    return sortDir.value === "asc" ? cmp : -cmp;
  });
  return list;
});

// ── Trend Chart Data (aggregate activity trend) ────────────────────

const trendDates = computed(() => {
  const dates = new Set<string>();
  for (const point of store.activityTrend.value) {
    dates.add(point.date);
  }
  return [...dates].sort();
});

const trendDateLabels = computed(() => trendDates.value.map(formatBucketLocal));

const MAX_TREND_PROJECTS = 6;

const trendSeries = computed(() => {
  const usage = store.activityTrend.value;
  if (usage.length === 0) return [];

  // Rank projects by total messages over the period
  const projectMessages = new Map<string, number>();
  for (const point of usage) {
    projectMessages.set(
      point.project_path,
      (projectMessages.get(point.project_path) ?? 0) + point.messages,
    );
  }
  const topProjects = [...projectMessages.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TREND_PROJECTS)
    .map(([path]) => path);

  // Build a lookup: projectPath -> date -> messages
  const lookup = new Map<string, Map<string, number>>();
  for (const point of usage) {
    if (!topProjects.includes(point.project_path)) continue;
    if (!lookup.has(point.project_path))
      lookup.set(point.project_path, new Map());
    lookup.get(point.project_path)?.set(point.date, point.messages);
  }

  return topProjects.map((projectPath, idx) => ({
    name: truncatePath(projectPath),
    data: trendDates.value.map(
      (date) => lookup.get(projectPath)?.get(date) ?? 0,
    ),
    color: CHART_COLORS[idx % CHART_COLORS.length],
  }));
});

// ── Model Distribution Chart Data (from project_model_usage) ──────

const CHART_COLORS = [
  "#3b82f6",
  "#22c55e",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#ec4899",
];
const MAX_MODEL_PROJECTS = 8;
const MAX_MODEL_MODELS = 5;

/** Top N projects ranked by total messages (shared across both panes). */
const rankedProjects = computed(() => {
  const usage = store.projectModelUsage.value;
  const totals = new Map<string, number>();
  for (const item of usage) {
    totals.set(
      item.project_path,
      (totals.get(item.project_path) ?? 0) + item.messages,
    );
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MODEL_PROJECTS)
    .map(([path]) => path);
});

/** Top N models ranked by total messages (shared across both panes). */
const rankedModels = computed(() => {
  const usage = store.projectModelUsage.value;
  const totals = new Map<string, number>();
  for (const item of usage) {
    totals.set(item.model, (totals.get(item.model) ?? 0) + item.messages);
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MODEL_MODELS)
    .map(([model]) => model);
});

/** Models with color for the shared legend. */
const topModels = computed(() =>
  rankedModels.value.map((name, idx) => ({
    name,
    color: CHART_COLORS[idx % CHART_COLORS.length],
  })),
);

/** Truncated project names for x-axis. */
const modelProjectNames = computed(() =>
  rankedProjects.value.map(truncatePath),
);

/** Hidden models toggle (replaced as new Set for Vue reactivity). */
const hiddenModels = ref<Set<string>>(new Set());

function toggleModel(name: string): void {
  const next = new Set(hiddenModels.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  hiddenModels.value = next;
}

type ModelUsageItem = {
  project_path: string;
  model: string;
  sessions: number;
  messages: number;
};

/** Build a series array from a value accessor, zeroing hidden models. */
function buildSeries(
  getValue: (item: ModelUsageItem) => number,
): Array<{ name: string; data: number[]; color: string }> {
  const usage = store.projectModelUsage.value;
  if (usage.length === 0) return [];
  const projects = rankedProjects.value;
  const hidden = hiddenModels.value;

  return topModels.value.map((model) => ({
    name: model.name,
    data: hidden.has(model.name)
      ? projects.map(() => 0)
      : projects.map((projectPath) => {
          const item = usage.find(
            (u) => u.project_path === projectPath && u.model === model.name,
          );
          return item ? getValue(item) : 0;
        }),
    color: model.color,
  }));
}

/** Session-count series for 会话分布. */
const sessionSeries = computed(() => buildSeries((item) => item.sessions));

/** Message-count series for 消息分布. */
const messageSeries = computed(() => buildSeries((item) => item.messages));

// ── Formatters ─────────────────────────────────────────────────────

function truncatePath(path: string): string {
  if (path.length <= 35) return path;
  const parts = path.split("/");
  if (parts.length <= 3) return `…${path.slice(-33)}`;
  return `${parts[0]}/…/${parts.slice(-2).join("/")}`;
}

function formatLastActive(ts: number | null): string {
  if (ts === null) return "—";
  return formatRelativeTimeFromDate(new Date(ts));
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

.chart-title,
.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text);
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

.distribution-panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-4);
}

.chart-pane {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-2);
  min-width: 0;
}

.chart-pane-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-muted);
  text-align: center;
}

/* ── Shared Legend ─────────────────────────────────────────────────── */

.shared-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--spacing-3);
  padding: var(--spacing-1) 0;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-1);
  padding: 0;
  color: inherit;
  background: transparent;
  border: none;
  cursor: pointer;
  user-select: none;
  transition: opacity 0.15s ease;
}

.legend-item.dimmed {
  opacity: 0.35;
}

.legend-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
}

@media (max-width: 767px) {
  .distribution-panes {
    grid-template-columns: 1fr;
  }
}

</style>
