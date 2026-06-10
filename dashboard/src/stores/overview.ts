import { ref, type Ref } from 'vue'
import {
  fetchDashboardOverview,
  fetchDashboardProjects,
  type DashboardOverviewSummary,
  type DashboardOverviewTrendPoint,
  type DashboardOverviewTopModel,
  type DashboardOverviewTopTool,
  type DashboardProjectItem,
} from '../api/client'

export interface ModelMessageDistributionItem {
  model: string
  message_count: number
  percentage: number
}

const overview = ref<DashboardOverviewSummary | null>(null) as Ref<DashboardOverviewSummary | null>
const trend = ref<DashboardOverviewTrendPoint[]>([]) as Ref<DashboardOverviewTrendPoint[]>
const topModels = ref<DashboardOverviewTopModel[]>([]) as Ref<DashboardOverviewTopModel[]>
const topTools = ref<DashboardOverviewTopTool[]>([]) as Ref<DashboardOverviewTopTool[]>
const modelMessageDistribution = ref<ModelMessageDistributionItem[]>([]) as Ref<ModelMessageDistributionItem[]>
const projects = ref<DashboardProjectItem[]>([]) as Ref<DashboardProjectItem[]>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

export async function fetchOverview(start?: number, end?: number): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [overviewData, projectsData] = await Promise.all([
      fetchDashboardOverview(start, end),
      fetchDashboardProjects(start, end),
    ])
    overview.value = overviewData.summary
    trend.value = overviewData.trend ?? []
    topModels.value = overviewData.top_models ?? []
    topTools.value = overviewData.top_tools ?? []
    modelMessageDistribution.value = overviewData.model_message_distribution ?? []
    projects.value = projectsData.projects ?? []
    lastFetchedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载数据时发生未知错误'
  } finally {
    loading.value = false
  }
}

export function useOverviewStore() {
  return {
    overview,
    trend,
    topModels,
    topTools,
    modelMessageDistribution,
    projects,
    loading,
    error,
    lastFetchedAt,
    fetchOverview,
  }
}
