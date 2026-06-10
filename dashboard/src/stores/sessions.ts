import { ref, type Ref } from 'vue'
import {
  fetchDashboardSessions,
  type DashboardSessionListItem,
} from '../api/client'

const sessions = ref<DashboardSessionListItem[]>([]) as Ref<DashboardSessionListItem[]>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>
const lastFetchedAt = ref<number | null>(null) as Ref<number | null>

export async function fetchSessions(
  start?: number,
  end?: number,
  params?: { limit?: number; offset?: number; status?: string },
): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const res = await fetchDashboardSessions(start, end, params)
    sessions.value = res.data
    lastFetchedAt.value = Date.now()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载会话数据时发生未知错误'
  } finally {
    loading.value = false
  }
}

export function useSessionsStore() {
  return {
    sessions,
    loading,
    error,
    lastFetchedAt,
    fetchSessions,
  }
}
