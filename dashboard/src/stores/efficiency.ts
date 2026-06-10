import { ref, type Ref } from 'vue'
import {
  fetchDashboardEfficiency,
  type DashboardEfficiencyData,
} from '../api/client'

const efficiencyData = ref<DashboardEfficiencyData | null>(null) as Ref<DashboardEfficiencyData | null>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

export async function fetchEfficiency(start?: number, end?: number): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const data = await fetchDashboardEfficiency(start, end)
    efficiencyData.value = data
    lastFetchedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载效率数据时发生未知错误'
  } finally {
    loading.value = false
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
