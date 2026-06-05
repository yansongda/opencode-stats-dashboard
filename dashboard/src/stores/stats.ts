import { ref, type Ref } from 'vue'
import {
  fetchOverview,
  fetchSessions,
  fetchToolCalls,
  fetchStatsModels,
  fetchLatest,
  type OverviewResponse,
  type SessionRow,
  type ToolCallRow,
  type StatsModelItem,
} from '../api/client'
import { useSSE } from '../composables/useSSE'
import type { StatsUpdate } from '../../../src/types/sse'

export type RealtimeMode = 'sse' | 'polling' | 'disconnected'

export interface StatsStore {
  overview: Ref<OverviewResponse | null>
  sessions: Ref<SessionRow[]>
  toolCalls: Ref<ToolCallRow[]>
  models: Ref<StatsModelItem[]>
  realtimeMode: Ref<RealtimeMode>
  lastEventId: Ref<string | null>
  lastUpdatedAt: Ref<Date | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  start: () => Promise<void>
  stop: () => void
  refreshData: () => Promise<void>
}

const POLL_INTERVAL_MS = 5000

const overview = ref<OverviewResponse | null>(null) as Ref<OverviewResponse | null>
const sessions = ref<SessionRow[]>([]) as Ref<SessionRow[]>
const toolCalls = ref<ToolCallRow[]>([]) as Ref<ToolCallRow[]>
const models = ref<StatsModelItem[]>([]) as Ref<StatsModelItem[]>
const realtimeMode = ref<RealtimeMode>('disconnected') as Ref<RealtimeMode>
const lastEventId = ref<string | null>(null) as Ref<string | null>
const lastUpdatedAt = ref<Date | null>(null) as Ref<Date | null>
const loading = ref(false) as Ref<boolean>
const error = ref<string | null>(null) as Ref<string | null>

let pollTimer: ReturnType<typeof setInterval> | null = null
let started = false

const sse = useSSE({
  onMessage: (update: StatsUpdate) => {
    lastEventId.value = update.event_id
    realtimeMode.value = 'sse'
    refreshData().catch((err) => {
      console.error('[SSE] refreshData failed:', err)
    })
  },
})

async function refreshData(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [ov, sess, tc, mdl] = await Promise.all([
      fetchOverview(),
      fetchSessions({ include_deleted: true }),
      fetchToolCalls(),
      fetchStatsModels(),
    ])
    overview.value = ov
    sessions.value = sess.sessions
    toolCalls.value = tc.tool_calls
    models.value = mdl.models
    lastUpdatedAt.value = new Date()
    sse.markSynced()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载数据时发生未知错误'
    console.error('[Stats] Failed to refresh data:', err)
  } finally {
    loading.value = false
  }
}

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling(): void {
  stopPolling()
  realtimeMode.value = 'polling'
  pollTimer = setInterval(async () => {
    try {
      const latest = await fetchLatest()
      if (latest.last_event_id) {
        lastEventId.value = latest.last_event_id
      }
      await refreshData()
    } catch {
      // Silently ignore poll errors — will retry on next interval
    }
  }, POLL_INTERVAL_MS)
}

async function start(): Promise<void> {
  if (started) return
  started = true
  await refreshData()

  sse.connect()

  if (sse.connectionState.value === 'connected' || sse.connectionState.value === 'connecting') {
    realtimeMode.value = 'sse'
  } else {
    startPolling()
  }
}

function stop(): void {
  started = false
  sse.disconnect()
  stopPolling()
  realtimeMode.value = 'disconnected'
}

export function useStatsStore(): StatsStore {
  return {
    overview,
    sessions,
    toolCalls,
    models,
    realtimeMode,
    lastEventId,
    lastUpdatedAt,
    loading,
    error,
    start,
    stop,
    refreshData,
  }
}
