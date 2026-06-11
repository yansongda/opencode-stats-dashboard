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

const lastParams = ref<{ start?: number; end?: number } | null>(null)

export async function fetchOverview(
  start?: number,
  end?: number,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent ?? false
  const isSilentOnlyRefresh = options !== undefined && start === undefined && end === undefined

  if (arguments.length > 0 && !isSilentOnlyRefresh) {
    lastParams.value = { start, end }
  } else if (lastParams.value) {
    start = lastParams.value.start
    end = lastParams.value.end
  }

  if (!silent) {
    loading.value = true
    error.value = null
  }

  try {
    const [overviewResult, projectsResult] = await Promise.allSettled([
      fetchDashboardOverview(start, end),
      fetchDashboardProjects(start, end),
    ])

    const failedMessages: string[] = []

    if (overviewResult.status === 'fulfilled') {
      const overviewData = overviewResult.value
      overview.value = overviewData.summary
      trend.value = overviewData.trend ?? []
      topModels.value = overviewData.top_models ?? []
      topTools.value = overviewData.top_tools ?? []
      modelMessageDistribution.value = overviewData.model_message_distribution ?? []
    } else {
      const msg = `overview failed: ${overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason)}`
      if (silent) {
        console.warn(`[silent fetch] ${msg}`)
      } else {
        failedMessages.push(msg)
      }
    }

    if (projectsResult.status === 'fulfilled') {
      projects.value = projectsResult.value.projects ?? []
    } else {
      const msg = `projects failed: ${projectsResult.reason instanceof Error ? projectsResult.reason.message : String(projectsResult.reason)}`
      if (silent) {
        console.warn(`[silent fetch] ${msg}`)
      } else {
        failedMessages.push(msg)
      }
    }

    if (overviewResult.status === 'fulfilled' || projectsResult.status === 'fulfilled') {
      lastFetchedAt.value = Date.now()
    }

    if (!silent && failedMessages.length > 0) {
      error.value = failedMessages.join('; ')
    }
  } finally {
    if (!silent) {
      loading.value = false
    }
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
