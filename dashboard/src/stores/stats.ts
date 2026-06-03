import { ref, type Ref } from 'vue'
import {
  fetchOverview,
  fetchSessions,
  fetchToolCalls,
  connectSSE,
  fetchLatest,
  type OverviewResponse,
  type SessionRow,
  type ToolCallRow,
  type StatsUpdate,
} from '../api/client'

export type RealtimeMode = 'sse' | 'polling' | 'disconnected'

export interface StatsStore {
  overview: Ref<OverviewResponse | null>
  sessions: Ref<SessionRow[]>
  toolCalls: Ref<ToolCallRow[]>
  realtimeMode: Ref<RealtimeMode>
  lastEventId: Ref<string | null>
  start: () => Promise<void>
  stop: () => void
  refreshData: () => Promise<void>
}

const POLL_INTERVAL_MS = 5000

export function useStatsStore(): StatsStore {
  const overview = ref<OverviewResponse | null>(null) as Ref<OverviewResponse | null>
  const sessions = ref<SessionRow[]>([]) as Ref<SessionRow[]>
  const toolCalls = ref<ToolCallRow[]>([]) as Ref<ToolCallRow[]>
  const realtimeMode = ref<RealtimeMode>('disconnected') as Ref<RealtimeMode>
  const lastEventId = ref<string | null>(null) as Ref<string | null>

  let eventSource: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null

  async function refreshData(): Promise<void> {
    const [ov, sess, tc] = await Promise.all([
      fetchOverview(),
      fetchSessions(),
      fetchToolCalls(),
    ])
    overview.value = ov
    sessions.value = sess.sessions
    toolCalls.value = tc.tool_calls
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
        if (latest.last_event_id && latest.last_event_id !== lastEventId.value) {
          lastEventId.value = latest.last_event_id
          await refreshData()
        }
      } catch {
        // Silently ignore poll errors — will retry on next interval
      }
    }, POLL_INTERVAL_MS)
  }

  function connectSSEWithFallback(): void {
    try {
      eventSource = connectSSE()
      realtimeMode.value = 'sse'

      eventSource.addEventListener('stats-update', ((event: MessageEvent) => {
        try {
          const update: StatsUpdate = JSON.parse(event.data)
          lastEventId.value = update.last_event_id
          refreshData()
        } catch {
          // Ignore parse errors in SSE data
        }
      }) as EventListener)

      eventSource.onerror = () => {
        eventSource?.close()
        eventSource = null
        startPolling()
      }
    } catch {
      // EventSource constructor failed — fall back to polling
      startPolling()
    }
  }

  async function start(): Promise<void> {
    await refreshData()
    connectSSEWithFallback()
  }

  function stop(): void {
    if (eventSource) {
      eventSource.close()
      eventSource = null
    }
    stopPolling()
    realtimeMode.value = 'disconnected'
  }

  return {
    overview,
    sessions,
    toolCalls,
    realtimeMode,
    lastEventId,
    start,
    stop,
    refreshData,
  }
}
