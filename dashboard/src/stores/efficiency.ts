import { ref, type Ref } from 'vue'
import {
  fetchDashboardEfficiency,
  type DashboardEfficiencyData,
} from '../api/client'

const efficiencyData = ref<DashboardEfficiencyData | null>(null) as Ref<DashboardEfficiencyData | null>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

const lastParams = ref<{ start?: number; end?: number } | null>(null)

export async function fetchEfficiency(
  start?: number,
  end?: number,
  options?: { silent?: boolean },
): Promise<void> {
  const silent = options?.silent === true
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
    const data = await fetchDashboardEfficiency(start, end)
    efficiencyData.value = data
    lastFetchedAt.value = Date.now()
  } catch (err) {
    if (silent) {
      console.warn('[silent fetch] efficiency failed:', err)
    } else {
      error.value = err instanceof Error ? err.message : '加载效率数据时发生未知错误'
    }
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
