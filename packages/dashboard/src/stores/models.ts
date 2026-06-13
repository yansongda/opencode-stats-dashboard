import { type Ref, ref } from "vue";
import {
  type DashboardModelCostTrendPoint,
  type DashboardModelItem,
  fetchDashboardModels,
} from "../api/client";
import { getRangeMs, type TimeRange } from "../utils/timezone";

const models = ref<DashboardModelItem[]>([]) as Ref<DashboardModelItem[]>;
const modelsCostTrend = ref<DashboardModelCostTrendPoint[]>([]) as Ref<
  DashboardModelCostTrendPoint[]
>;
const loading = ref(false) as Ref<boolean>;
const error = ref<string | null>(null) as Ref<string | null>;
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>;

const lastParams = ref<{
  start?: number;
  end?: number;
  range?: TimeRange;
} | null>(null);

export async function fetchModels(
  start?: number,
  end?: number,
  options?: { silent?: boolean; range?: TimeRange },
): Promise<boolean> {
  const silent = options?.silent === true;
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
    const data = await fetchDashboardModels(start, end);
    models.value = data.models;
    modelsCostTrend.value = data.cost_trend;
    lastFetchedAt.value = Date.now();
    return true;
  } catch (err) {
    if (silent) {
      console.warn("[silent fetch] models failed:", err);
    } else {
      error.value =
        err instanceof Error ? err.message : "加载模型数据时发生未知错误";
    }
    return false;
  } finally {
    if (!silent) {
      loading.value = false;
    }
  }
}

export function useModelsStore() {
  return {
    models,
    modelsCostTrend,
    loading,
    error,
    lastFetchedAt,
    fetchModels,
  };
}
