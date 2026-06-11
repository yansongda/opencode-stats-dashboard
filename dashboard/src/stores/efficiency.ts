import { ref, type Ref } from 'vue'
import {
  fetchDashboardEfficiency,
  type DashboardEfficiencyData,
} from '../api/client'
import { getRangeMs, type TimeRange } from '../utils/timezone'

const efficiencyData = ref<DashboardEfficiencyData | null>(null) as Ref<DashboardEfficiencyData | null>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

const lastParams = ref<{ start?: number; end?: number; range?: TimeRange } | null>(null)

export async function fetchEfficiency(
  start?: number,
  end?: number,
  options?: { silent?: boolean; range?: TimeRange },
): Promise<boolean> {
  const silent = options?.silent === true
  const isSilentOnlyRefresh = options !== undefined && start === undefined && end === undefined

  if (arguments.length > 0 && !isSilentOnlyRefresh) {
    lastParams.value = { start, end, range: options?.range }
  } else if (lastParams.value?.range) {
    const range = getRangeMs(lastParams.value.range)
    start = range.start
    end = range.end
  } else if (lastParams.value) {
    start = lastParams.value.start
    end = lastParams.value.end
  }

  if (!silent) {
    loading.value = true
    error.value = null
  }
  try {
    const data = await fetchDashboardEfficiency(start, end)
    efficiencyData.value = data
    lastFetchedAt.value = Date.now()
    return true
  } catch (err) {
    if (silent) {
      console.warn('[silent fetch] efficiency failed:', err)
    } else {
      error.value = err instanceof Error ? err.message : '加载效率数据时发生未知错误'
    }
    return false
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

export function useEfficiencyStore() {
  return {
    efficiencyData,
    loading,
    error,
    lastFetchedAt,
    fetchEfficiency,
  }
}
