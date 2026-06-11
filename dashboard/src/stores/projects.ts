import { ref, type Ref } from 'vue'
import {
  fetchDashboardProjects,
  type DashboardProjectItem,
  type DashboardProjectActivityTrendPoint,
  type DashboardProjectModelUsageItem,
} from '../api/client'
import { getRangeMs, type TimeRange } from '../utils/timezone'

const projects = ref<DashboardProjectItem[]>([]) as Ref<DashboardProjectItem[]>
const activityTrend = ref<DashboardProjectActivityTrendPoint[]>([]) as Ref<DashboardProjectActivityTrendPoint[]>
const projectModelUsage = ref<DashboardProjectModelUsageItem[]>([]) as Ref<DashboardProjectModelUsageItem[]>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

const lastParams = ref<{
  start?: number
  end?: number
  params?: { sort?: string; order?: 'asc' | 'desc' }
  range?: TimeRange
} | null>(null)

export async function fetchProjects(
  start?: number,
  end?: number,
  params?: { sort?: string; order?: 'asc' | 'desc' },
  options?: { silent?: boolean; range?: TimeRange },
): Promise<boolean> {
  const silent = options?.silent === true
  const isSilentOnlyRefresh = options !== undefined && start === undefined && end === undefined && params === undefined

  if (arguments.length > 0 && !isSilentOnlyRefresh) {
    lastParams.value = { start, end, params, range: options?.range }
  } else if (lastParams.value?.range) {
    const range = getRangeMs(lastParams.value.range)
    start = range.start
    end = range.end
    params = lastParams.value.params
  } else if (lastParams.value) {
    start = lastParams.value.start
    end = lastParams.value.end
    params = lastParams.value.params
  }

  if (!silent) {
    loading.value = true
    error.value = null
  }
  try {
    const data = await fetchDashboardProjects(start, end, params)
    projects.value = data.projects
    activityTrend.value = data.activity_trend
    projectModelUsage.value = data.project_model_usage
    lastFetchedAt.value = Date.now()
    return true
  } catch (err) {
    if (silent) {
      console.warn('[silent fetch] projects failed:', err)
    } else {
      error.value = err instanceof Error ? err.message : '加载项目数据时发生未知错误'
    }
    return false
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

export function useProjectsStore() {
  return {
    projects,
    activityTrend,
    projectModelUsage,
    loading,
    error,
    lastFetchedAt,
    fetchProjects,
  }
}
