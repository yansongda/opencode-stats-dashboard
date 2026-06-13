<template>
    <div class="overview-container">
        <!-- Loading State (initial no-data only) -->
        <LoadingState
            v-if="loading && !overview"
            message="加载统计数据中..."
            test-id="overview-loading"
        />

        <!-- Error State (no-data only; preserves content when data exists) -->
        <EmptyState
            v-else-if="error && !overview"
            variant="error"
            title="数据加载失败"
            :description="error"
            action-label="重试"
            test-id="overview-error"
            @action="retryFetch"
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
            <!-- Page Header -->
            <div class="view-header resp-header">
                <h1 class="view-title">概览</h1>
                <TimeRangePicker v-model="selectedPeriod" />
            </div>

            <!-- Metric Cards -->
            <div class="metrics-row resp-metrics-5" data-testid="metrics-row">
                <MetricCard
                    label="总会话"
                    :value="overview?.total_sessions ?? 0"
                    secondary-label="总消息数"
                    :secondary-value="overview?.total_messages ?? 0"
                    :subtitle="`${overview?.active_sessions ?? 0} 活跃 · ${overview?.deleted_sessions ?? 0} 已删除`"
                    test-id="metric-sessions"
                />
                <MetricCard
                    label="总 Token"
                    :value="formatTokens(overview?.total_tokens ?? 0)"
                    secondary-label="成本"
                    :secondary-value="formatCost(overview?.total_cost_usd ?? 0)"
                    :subtitle="`入 ${formatTokens(overview?.input_tokens ?? 0)} · 出 ${formatTokens(overview?.output_tokens ?? 0)}`"
                    test-id="metric-tokens"
                />
                <MetricCard
                    label="平均项目 Token"
                    :value="formatTokens(avgProjectTokens)"
                    secondary-label="成本"
                    :secondary-value="formatCost(avgProjectCost)"
                    :subtitle="`平均 ${formatNumber(avgProjectMessages)} 消息 / 项目`"
                    test-id="metric-avg-cost"
                />
                <MetricCard
                    label="工具调用"
                    :value="overview?.total_tool_calls ?? 0"
                    :subtitle="`错误 ${overview?.total_tool_errors ?? 0} · 成功率 ${toolSuccessRate}%`"
                    test-id="metric-tools"
                />
                <MetricCard
                    label="变更代码"
                    :value="
                        (
                            (overview?.lines_added ?? 0) -
                            (overview?.lines_deleted ?? 0)
                        ).toLocaleString()
                    "
                    secondary-label="变更文件"
                    :secondary-value="overview?.files_changed ?? 0"
                    :subtitle="`+${overview?.lines_added ?? 0} 行 · -${overview?.lines_deleted ?? 0} 行`"
                    test-id="metric-code"
                />
            </div>

            <!-- Usage Trend (dual y-axis: Token left, Messages right) -->
            <div class="trend-section" data-testid="trend-section">
                <h3 class="section-title">使用趋势</h3>
                <LineChart
                    :x-data="trendDates"
                    :series="trendSeries"
                    height="260px"
                    :smooth="true"
                    :show-area="true"
                    y-label="Token"
                    :value-formatter="formatTokens"
                    right-y-label="消息"
                    :right-value-formatter="formatNumber"
                />
            </div>

            <!-- Working Hour Heatmap -->
            <div class="chart-card" data-testid="working-hour-heatmap">
                <div class="chart-card-header">
                    <h3 class="chart-card-title">工作时段分布</h3>
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

            <!-- Model Distribution: cost + messages in one card -->
            <div class="chart-card" data-testid="model-distribution">
                <div class="chart-card-header">
                    <h3 class="chart-card-title">模型分布</h3>
                    <span class="chart-card-subtitle">成本分布仅显示成本最高的 5 个模型，消息分布显示全部有消息的模型</span>
                </div>
                <EmptyState
                    v-if="modelCostPieRawData.length === 0 && modelMessagePieRawData.length === 0"
                    title="暂无模型数据"
                    data-testid="model-distribution-empty"
                />
                <template v-else>
                    <div
                        v-if="modelLegendItems.length > 0"
                        class="shared-legend"
                    >
                        <button
                            v-for="item in modelLegendItems"
                            :key="item.name"
                            type="button"
                            class="legend-item"
                            :class="{ 'legend-item--hidden': hiddenModels.has(item.name) }"
                            :aria-pressed="!hiddenModels.has(item.name)"
                            :title="`切换 ${item.name}`"
                            @click="toggleModel(item.name)"
                        >
                            <span
                                class="legend-dot"
                                :style="{ backgroundColor: item.color }"
                            />
                            {{ item.name }}
                        </button>
                    </div>
                    <div class="distribution-pies">
                        <div class="pie-pane">
                            <h4 class="pie-pane-title">成本分布</h4>
                            <PieChart
                                v-if="modelCostPieData.length > 0"
                                :data="modelCostPieData"
                                height="240px"
                                :donut="true"
                                :show-legend="false"
                                :tooltip-formatter="modelCostTooltip"
                            />
                            <EmptyState
                                v-else
                                title="当前成本为 $0.00，暂无成本占比"
                                data-testid="model-cost-empty"
                            />
                        </div>
                        <div class="pie-pane">
                            <h4 class="pie-pane-title">消息分布</h4>
                            <PieChart
                                v-if="modelMessagePieData.length > 0"
                                :data="modelMessagePieData"
                                height="240px"
                                :donut="true"
                                :show-legend="false"
                                :tooltip-formatter="modelMessageTooltip"
                            />
                            <EmptyState
                                v-else
                                title="暂无消息数据"
                                data-testid="model-message-empty"
                            />
                        </div>
                    </div>
                </template>
            </div>

            <!-- Project Distribution: cost + sessions in one card -->
            <div class="chart-card" data-testid="project-distribution">
                <div class="chart-card-header">
                    <h3 class="chart-card-title">项目分布</h3>
                    <span class="chart-card-subtitle">仅显示用量最高的 8 个项目，其余归入「其他」</span>
                </div>
                <EmptyState
                    v-if="projectCostPieRawData.length === 0 && projectSessionPieRawData.length === 0"
                    title="暂无项目数据"
                    data-testid="project-distribution-empty"
                />
                <template v-else>
                    <div
                        v-if="projectLegendItems.length > 0"
                        class="shared-legend"
                    >
                        <button
                            v-for="item in projectLegendItems"
                            :key="item.name"
                            type="button"
                            class="legend-item"
                            :class="{ 'legend-item--hidden': hiddenProjects.has(item.name) }"
                            :aria-pressed="!hiddenProjects.has(item.name)"
                            :title="`切换 ${item.name}`"
                            @click="toggleProject(item.name)"
                        >
                            <span
                                class="legend-dot"
                                :style="{ backgroundColor: item.color }"
                            />
                            {{ item.name }}
                        </button>
                    </div>
                    <div class="distribution-pies">
                        <div class="pie-pane">
                            <h4 class="pie-pane-title">成本分布</h4>
                            <PieChart
                                v-if="projectCostPieData.length > 0"
                                :data="projectCostPieData"
                                height="240px"
                                :donut="true"
                                :show-legend="false"
                                :tooltip-formatter="projectCostTooltip"
                            />
                            <EmptyState
                                v-else
                                title="当前成本为 $0.00，暂无成本占比"
                                data-testid="project-cost-empty"
                            />
                        </div>
                        <div class="pie-pane">
                            <h4 class="pie-pane-title">会话分布</h4>
                            <PieChart
                                v-if="projectSessionPieData.length > 0"
                                :data="projectSessionPieData"
                                height="240px"
                                :donut="true"
                                :show-legend="false"
                                :tooltip-formatter="projectSessionTooltip"
                            />
                            <EmptyState
                                v-else
                                title="暂无会话数据"
                                data-testid="project-session-empty"
                            />
                        </div>
                    </div>
                </template>
            </div>

        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from "vue";
import type {
  DashboardEfficiencyHeatmapPoint,
  DashboardOverviewProjectDistributionItem,
} from "../api/client";
import HeatmapChart from "../charts/HeatmapChart.vue";
import LineChart from "../charts/LineChart.vue";
import PieChart from "../charts/PieChart.vue";
import EmptyState from "../components/EmptyState.vue";
import LoadingState from "../components/LoadingState.vue";
import MetricCard from "../components/MetricCard.vue";
import TimeRangePicker from "../components/TimeRangePicker.vue";
import { useOverviewStore } from "../stores/overview";
import { formatCost, formatNumber, formatTokens } from "../utils/format";
import {
  formatBucketLocal,
  getRangeMs,
  type TimeRange,
} from "../utils/timezone";

// ── ECharts default palette (matches PieChart.vue) ─────────────────

const ECHARTS_COLORS = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#ea7ccc",
  "#8884d8",
];

// ── Store ──────────────────────────────────────────────────────────

const store = useOverviewStore();

// ── Helpers ─────────────────────────────────────────────────────────

function divideOrNull(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
): number | null {
  if (denominator == null || denominator === 0) return null;
  if (numerator == null) return null;
  return numerator / denominator;
}

const selectedPeriod = ref<TimeRange>("7d");
const STALE_MS = 60_000;

function doFetch(): void {
  const { start, end } = getRangeMs(selectedPeriod.value);
  void store.fetchOverview(start, end, { range: selectedPeriod.value });
}

function retryFetch(): void {
  doFetch();
}

function fetchIfStale(): void {
  if (
    !store.lastFetchedAt.value ||
    Date.now() - store.lastFetchedAt.value > STALE_MS
  ) {
    doFetch();
  }
}

watch(selectedPeriod, () => doFetch());

// ── Derived Data ───────────────────────────────────────────────────

const overview = computed(() => store.overview.value);
const loading = computed(() => store.loading.value);
const error = computed(() => store.error.value);
const trendData = computed(() => store.trend.value);
const topModels = computed(() => store.topModels.value);
const projects = computed(() => store.projects.value);

const toolSuccessRate = computed(() => {
  if (!overview.value) return "100";
  const total = overview.value.total_tool_calls;
  if (total === 0) return "100";
  return ((1 - overview.value.total_tool_errors / total) * 100).toFixed(1);
});

// ── Average project fallbacks (backend may omit avg_project_* fields) ─

const avgProjectTokens = computed(
  () =>
    overview.value?.avg_project_tokens ??
    divideOrNull(overview.value?.total_tokens, overview.value?.total_projects),
);

const avgProjectCost = computed(
  () =>
    overview.value?.avg_project_cost ??
    divideOrNull(
      overview.value?.total_cost_usd,
      overview.value?.total_projects,
    ),
);

const avgProjectMessages = computed(
  () =>
    overview.value?.avg_project_messages ??
    divideOrNull(
      overview.value?.total_messages,
      overview.value?.total_projects,
    ),
);

const trendDates = computed(() =>
  trendData.value.map((d) => formatBucketLocal(d.date)),
);

const trendSeries = computed(() => [
  {
    name: "Token",
    data: trendData.value.map((d) => d.tokens),
    color: "#3b82f6",
    yAxisIndex: 0,
  },
  {
    name: "消息",
    data: trendData.value.map((d) => d.messages),
    color: "#16a34a",
    yAxisIndex: 1,
  },
]);

// ── Legend toggle state ──────────────────────────────────────────────

const hiddenModels = ref<Set<string>>(new Set());
const hiddenProjects = ref<Set<string>>(new Set());

function toggleModel(name: string): void {
  const next = new Set(hiddenModels.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  hiddenModels.value = next;
}

function toggleProject(name: string): void {
  const next = new Set(hiddenProjects.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  hiddenProjects.value = next;
}

// ── Model Distribution ─────────────────────────────────────────────

const modelCostPieRawData = computed(() =>
  topModels.value.map((m) => ({
    name: m.model,
    value: Math.round(m.cost_usd * 10000) / 10000,
  })),
);

const modelMessagePieRawData = computed(() =>
  store.modelMessageDistribution.value
    .filter((m) => m.message_count > 0)
    .map((m) => ({ name: m.model, value: m.message_count })),
);

const modelCostPieData = computed(() =>
  modelCostPieRawData.value.filter((d) => !hiddenModels.value.has(d.name)),
);

const modelMessagePieData = computed(() =>
  modelMessagePieRawData.value.filter((d) => !hiddenModels.value.has(d.name)),
);

const modelLegendItems = computed(() => {
  const seen = new Set<string>();
  const items: Array<{ name: string; color: string }> = [];
  // Cost pie names first (primary ordering)
  for (const d of modelCostPieRawData.value) {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      items.push({
        name: d.name,
        color: ECHARTS_COLORS[items.length % ECHARTS_COLORS.length],
      });
    }
  }
  // Message pie names (append unseen)
  for (const d of modelMessagePieRawData.value) {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      items.push({
        name: d.name,
        color: ECHARTS_COLORS[items.length % ECHARTS_COLORS.length],
      });
    }
  }
  return items;
});

const modelCostTooltip = (params: unknown): string => {
  const p = params as { name: string; value: number; percent: number };
  return `${p.name}<br/>成本: ${formatCost(p.value)} (${p.percent.toFixed(1)}%)`;
};

const modelMessageTooltip = (params: unknown): string => {
  const p = params as { name: string; value: number; percent: number };
  const entry = store.modelMessageDistribution.value.find(
    (m) => m.model === p.name,
  );
  const pct = entry?.percentage ?? p.percent;
  return `${p.name}<br/>消息: ${formatNumber(p.value)} (${pct.toFixed(1)}%)`;
};

// ── Project Distribution ───────────────────────────────────────────

const MAX_PIE_SLICES = 8;

function formatProjectPath(path: string): string {
  if (!path) return "";
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return segments.join("/");
  return `.../${segments.slice(-2).join("/")}`;
}

function buildProjectPieData(
  items: DashboardOverviewProjectDistributionItem[],
  accessor: (p: DashboardOverviewProjectDistributionItem) => number,
  precision: number,
): Array<{ name: string; value: number }> {
  const withData = items.filter((p) => accessor(p) > 0);
  if (withData.length === 0) return [];
  const sorted = [...withData].sort((a, b) => accessor(b) - accessor(a));
  const top = sorted.slice(0, MAX_PIE_SLICES);
  const rest = sorted.slice(MAX_PIE_SLICES);
  const result: Array<{ name: string; value: number }> = top.map((p) => ({
    name: formatProjectPath(p.project_path ?? ""),
    value: precision > 0 ? Number(accessor(p).toFixed(precision)) : accessor(p),
  }));
  if (rest.length > 0) {
    const otherSum = rest.reduce((sum, p) => sum + accessor(p), 0);
    result.push({
      name: "其他",
      value: precision > 0 ? Number(otherSum.toFixed(precision)) : otherSum,
    });
  }
  return result;
}

const projectCostPieRawData = computed(() =>
  buildProjectPieData(projects.value, (p) => p.cost_usd, 4),
);

const projectSessionPieRawData = computed(() =>
  buildProjectPieData(projects.value, (p) => p.session_count, 0),
);

const projectCostPieData = computed(() =>
  projectCostPieRawData.value.filter((d) => !hiddenProjects.value.has(d.name)),
);

const projectSessionPieData = computed(() =>
  projectSessionPieRawData.value.filter(
    (d) => !hiddenProjects.value.has(d.name),
  ),
);

const projectLegendItems = computed(() => {
  const seen = new Set<string>();
  const items: Array<{ name: string; color: string }> = [];
  for (const d of projectCostPieRawData.value) {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      items.push({
        name: d.name,
        color: ECHARTS_COLORS[items.length % ECHARTS_COLORS.length],
      });
    }
  }
  for (const d of projectSessionPieRawData.value) {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      items.push({
        name: d.name,
        color: ECHARTS_COLORS[items.length % ECHARTS_COLORS.length],
      });
    }
  }
  return items;
});

const projectCostTooltip = (params: unknown): string => {
  const p = params as { name: string; value: number; percent: number };
  return `${p.name}<br/>成本: ${formatCost(p.value)} (${p.percent.toFixed(1)}%)`;
};

const projectSessionTooltip = (params: unknown): string => {
  const p = params as { name: string; value: number; percent: number };
  return `${p.name}<br/>会话: ${p.value.toLocaleString("en-US")} (${p.percent.toFixed(1)}%)`;
};

// ── Working Hour Heatmap ───────────────────────────────────────────

const dayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function mapHeatmapPoint(p: DashboardEfficiencyHeatmapPoint): {
  day: number;
  hour: number;
  value: number;
} {
  // API weekday: 0=Sunday (SQLite strftime('%w')), 6=Saturday
  // Chart day: 0=Monday, 6=Sunday
  const day = p.weekday === 0 ? 6 : p.weekday - 1;
  return { day, hour: p.hour, value: p.messages };
}

const heatmapData = computed(() => store.heatmap.value.map(mapHeatmapPoint));

// ── Lifecycle ──────────────────────────────────────────────────────

onMounted(fetchIfStale);
onActivated(fetchIfStale);
</script>

<style scoped>
.overview-container {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
}

/* ── View Header ─────────────────────────────────────────────────── */

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

/* ── Trend Section ──────────────────────────────────────────────── */

.trend-section {
    background-color: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--spacing-4);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3);
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

/* ── Shared Legend ───────────────────────────────────────────────── */

.shared-legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-2) var(--spacing-3);
    justify-content: center;
}

.legend-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    border: none;
    background: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    transition: opacity 0.15s ease;
}

.legend-item:hover {
    opacity: 0.8;
}

.legend-item--hidden {
    opacity: 0.35;
    text-decoration: line-through;
}

.legend-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}

/* ── Distribution Pies (side by side) ───────────────────────────── */

.distribution-pies {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--spacing-4);
}

.pie-pane {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-2);
    min-width: 0;
}

.pie-pane-title {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-muted);
    text-align: center;
}

/* ── Responsive: pies stack on mobile ───────────────────────────── */

@media (max-width: 767px) {
    .distribution-pies {
        grid-template-columns: 1fr;
    }
}
</style>
