import { ref, type Ref } from 'vue'
import {
  fetchDashboardModels,
  type DashboardModelItem,
  type DashboardModelsSummary,
  type DashboardModelCostTrendPoint,
} from '../api/client'

const models = ref<DashboardModelItem[]>([]) as Ref<DashboardModelItem[]>
const modelsSummary = ref<DashboardModelsSummary | null>(null) as Ref<DashboardModelsSummary | null>
const modelsCostTrend = ref<DashboardModelCostTrendPoint[]>([]) as Ref<DashboardModelCostTrendPoint[]>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

const lastParams = ref<{ start?: number; end?: number } | null>(null)

export async function fetchModels(start?: number, end?: number): Promise<void> {
  if (arguments.length > 0) {
    lastParams.value = { start, end }
  } else if (lastParams.value) {
    start = lastParams.value.start
    end = lastParams.value.end
  }

  loading.value = true
  error.value = null
  try {
    const data = await fetchDashboardModels(start, end)
    models.value = data.models
    modelsSummary.value = data.summary
    modelsCostTrend.value = data.cost_trend
    lastFetchedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载模型数据时发生未知错误'
  } finally {
    loading.value = false
  }
}

export function useModelsStore() {
  return {
    models,
    modelsSummary,
    modelsCostTrend,
    loading,
    error,
    lastFetchedAt,
    fetchModels,
  }
}
