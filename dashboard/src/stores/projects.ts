import { ref, type Ref } from 'vue'
import {
  fetchDashboardProjects,
  type DashboardProjectItem,
  type DashboardProjectsSummary,
  type DashboardProjectActivityTrendPoint,
  type DashboardProjectModelUsageItem,
} from '../api/client'

const projects = ref<DashboardProjectItem[]>([]) as Ref<DashboardProjectItem[]>
const projectsSummary = ref<DashboardProjectsSummary | null>(null) as Ref<DashboardProjectsSummary | null>
const activityTrend = ref<DashboardProjectActivityTrendPoint[]>([]) as Ref<DashboardProjectActivityTrendPoint[]>
const projectModelUsage = ref<DashboardProjectModelUsageItem[]>([]) as Ref<DashboardProjectModelUsageItem[]>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

const lastParams = ref<{
  start?: number
  end?: number
  params?: { sort?: string; order?: 'asc' | 'desc' }
} | null>(null)

export async function fetchProjects(
  start?: number,
  end?: number,
  params?: { sort?: string; order?: 'asc' | 'desc' },
): Promise<void> {
  if (arguments.length > 0) {
    lastParams.value = { start, end, params }
  } else if (lastParams.value) {
    start = lastParams.value.start
    end = lastParams.value.end
    params = lastParams.value.params
  }

  loading.value = true
  error.value = null
  try {
    const data = await fetchDashboardProjects(start, end, params)
    projects.value = data.projects
    projectsSummary.value = data.summary
    activityTrend.value = data.activity_trend
    projectModelUsage.value = data.project_model_usage
    lastFetchedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载项目数据时发生未知错误'
  } finally {
    loading.value = false
  }
}

export function useProjectsStore() {
  return {
    projects,
    projectsSummary,
    activityTrend,
    projectModelUsage,
    loading,
    error,
    lastFetchedAt,
    fetchProjects,
  }
}
