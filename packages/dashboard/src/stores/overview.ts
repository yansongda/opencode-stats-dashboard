import { type Ref, ref } from "vue";
import {
  type DashboardEfficiencyHeatmapPoint,
  type DashboardOverviewProjectDistributionItem,
  type DashboardOverviewSummary,
  type DashboardOverviewTopModel,
  type DashboardOverviewTrendPoint,
  fetchDashboardOverview,
} from "../api/client";
import { getRangeMs, type TimeRange } from "../utils/timezone";

export interface ModelMessageDistributionItem {
  model: string;
  message_count: number;
  percentage: number;
}

const overview = ref<DashboardOverviewSummary | null>(
  null,
) as Ref<DashboardOverviewSummary | null>;
const trend = ref<DashboardOverviewTrendPoint[]>([]) as Ref<
  DashboardOverviewTrendPoint[]
>;
const heatmap = ref<DashboardEfficiencyHeatmapPoint[]>([]) as Ref<
  DashboardEfficiencyHeatmapPoint[]
>;
const topModels = ref<DashboardOverviewTopModel[]>([]) as Ref<
  DashboardOverviewTopModel[]
>;
const modelMessageDistribution = ref<ModelMessageDistributionItem[]>([]) as Ref<
  ModelMessageDistributionItem[]
>;
const projects = ref<DashboardOverviewProjectDistributionItem[]>([]) as Ref<
  DashboardOverviewProjectDistributionItem[]
>;
const loading = ref(false) as Ref<boolean>;
const error = ref<string | null>(null) as Ref<string | null>;
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>;

const lastParams = ref<{
  start?: number;
  end?: number;
  range?: TimeRange;
} | null>(null);

export async function fetchOverview(
  start?: number,
  end?: number,
  options?: { silent?: boolean; range?: TimeRange },
): Promise<boolean> {
  const silent = options?.silent ?? false;
  const _hasArgs =
    start !== undefined || end !== undefined || options !== undefined;
  const isSilentOnlyRefresh =
    options !== undefined && start === undefined && end === undefined;

  if (_hasArgs && !isSilentOnlyRefresh) {
    lastParams.value = { start, end, range: options?.range };
  } else if (lastParams.value?.range) {
    const range = getRangeMs(lastParams.value.range);
    start = range.start;
    end = range.end;
  } else if (lastParams.value) {
    start = lastParams.value.start;
    end = lastParams.value.end;
  }

  if (!silent) {
    loading.value = true;
    error.value = null;
  }

  try {
    const data = await fetchDashboardOverview(start, end);

    overview.value = data.summary;
    trend.value = data.trend ?? [];
    heatmap.value = data.heatmap ?? [];
    topModels.value = data.top_models ?? [];
    modelMessageDistribution.value = data.model_message_distribution ?? [];
    projects.value = data.project_distribution ?? [];

    lastFetchedAt.value = Date.now();
    return true;
  } catch (err) {
    const msg = `overview failed: ${err instanceof Error ? err.message : String(err)}`;
    if (silent) {
      console.warn(`[silent fetch] ${msg}`);
    } else {
      error.value = msg;
    }
    return false;
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

export function useOverviewStore() {
  return {
    overview,
    trend,
    heatmap,
    topModels,
    modelMessageDistribution,
    projects,
    loading,
    error,
    lastFetchedAt,
    fetchOverview,
  };
}
