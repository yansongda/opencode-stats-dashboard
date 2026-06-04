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
  lastUpdatedAt: Ref<Date | null>
  start: () => Promise<void>
  stop: () => void
  refreshData: () => Promise<void>
}

const POLL_INTERVAL_MS = 5000

const overview = ref<OverviewResponse | null>(null) as Ref<OverviewResponse | null>
const sessions = ref<SessionRow[]>([]) as Ref<SessionRow[]>
const toolCalls = ref<ToolCallRow[]>([]) as Ref<ToolCallRow[]>
const realtimeMode = ref<RealtimeMode>('disconnected') as Ref<RealtimeMode>
const lastEventId = ref<string | null>(null) as Ref<string | null>
const lastUpdatedAt = ref<Date | null>(null) as Ref<Date | null>

let eventSource: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let started = false

async function refreshData(): Promise<void> {
  const [ov, sess, tc] = await Promise.all([
    fetchOverview(),
    fetchSessions({ include_deleted: true }),
    fetchToolCalls(),
  ])
  overview.value = ov
  sessions.value = sess.sessions
  toolCalls.value = tc.tool_calls
  lastUpdatedAt.value = new Date()
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

function connectSSEWithFallback(): void {
  try {
    console.log('[SSE] Connecting to', connectSSE())
    eventSource = connectSSE()
    realtimeMode.value = 'sse'

    eventSource.addEventListener('stats-update', ((event: MessageEvent) => {
      console.log('[SSE] Received event:', event.data)
      try {
        const update: StatsUpdate = JSON.parse(event.data)
        lastEventId.value = update.last_event_id
        console.log('[SSE] Calling refreshData...')
        refreshData().then(() => {
          console.log('[SSE] refreshData completed')
        }).catch((err) => {
          console.error('[SSE] refreshData failed:', err)
        })
      } catch (err) {
        console.error('[SSE] Parse error:', err)
      }
    }) as EventListener)

    eventSource.onerror = (err) => {
      console.error('[SSE] Connection error:', err)
      eventSource?.close()
      eventSource = null
      startPolling()
    }
  } catch (err) {
    console.error('[SSE] Constructor failed:', err)
    startPolling()
  }
}

async function start(): Promise<void> {
  if (started) return
  started = true
  await refreshData()
  connectSSEWithFallback()
}

function stop(): void {
  started = false
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
  stopPolling()
  realtimeMode.value = 'disconnected'
}

export function useStatsStore(): StatsStore {
  return {
    overview,
    sessions,
    toolCalls,
    realtimeMode,
    lastEventId,
    lastUpdatedAt,
    start,
    stop,
    refreshData,
  }
}
