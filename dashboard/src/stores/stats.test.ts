import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { useStatsStore } from './stats'

const MOCK_OVERVIEW = {
  total_sessions: 10,
  deleted_sessions: 1,
  total_tokens: 50000,
  total_cost_usd: 0.25,
  total_messages: 50,
  total_days: 7,
  avg_tokens_per_session: 5000,
  input_tokens: 35000,
  output_tokens: 15000,
  cache_read: 25000,
  cache_write: 5000,
}

const MOCK_SESSIONS = {
  sessions: [
    {
      session_id: 'ses_001',
      project_path: '/tmp',
      model: 'claude-sonnet',
      total_tokens: 1000,
      total_cost_usd: 0.005,
      deleted: false,
      deleted_at: null,
      first_event_at: '2025-06-01T00:00:00Z',
      last_event_at: '2025-06-01T12:00:00Z',
      tool_call_count: 5,
    },
  ],
  count: 1,
}

const MOCK_TOOL_CALLS = {
  tool_calls: [
    {
      id: 1,
      tool_name: 'bash',
      session_id: 'ses_001',
      status: 'completed',
      model: 'claude-sonnet',
      tokens: 100,
      cost_usd: 0.001,
      started_at: '2025-06-01T00:00:00Z',
      completed_at: '2025-06-01T00:01:00Z',
      summary: 'run tests',
    },
  ],
  count: 1,
}

function mockFetchSequence(responses: unknown[]) {
  let callIndex = 0
  const fn = mock(() => {
    const result = responses[Math.min(callIndex, responses.length - 1)]
    callIndex++
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(result),
      text: () => Promise.resolve(JSON.stringify(result)),
    } as Response)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

class MockEventSource {
  url: string
  onerror: ((event: Event) => void) | null = null
  listeners: Record<string, ((event: unknown) => void)[]> = {}
  closed = false

  constructor(url: string) {
    this.url = url
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  close() {
    this.closed = true
  }

  emit(type: string, data: unknown) {
    if (this.listeners[type]) {
      for (const listener of this.listeners[type]) {
        listener({ data: JSON.stringify(data) } as MessageEvent)
      }
    }
  }

  triggerError() {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }
}

let lastEventSource: MockEventSource | null = null

function installMockEventSource() {
  lastEventSource = null
  globalThis.EventSource = class extends MockEventSource {
    constructor(url: string) {
      super(url)
      lastEventSource = this
    }
  } as unknown as typeof EventSource
}

describe('useStatsStore', () => {
  const originalFetch = globalThis.fetch
  const originalEventSource = globalThis.EventSource
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const store = useStatsStore()

  beforeEach(() => {
    store.stop()
    store.overview.value = null
    store.sessions.value = []
    store.toolCalls.value = []
    store.lastEventId.value = null
    globalThis.setInterval = mock((_fn: TimerHandler) => {
      return 123 as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval
    globalThis.clearInterval = mock(() => {}) as unknown as typeof clearInterval
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.EventSource = originalEventSource
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    lastEventSource = null
  })

  describe('initialization', () => {
    it('returns same refs across multiple calls', () => {
      const a = useStatsStore()
      const b = useStatsStore()
      expect(a.overview).toBe(b.overview)
      expect(a.sessions).toBe(b.sessions)
      expect(a.toolCalls).toBe(b.toolCalls)
      expect(a.realtimeMode).toBe(b.realtimeMode)
    })

    it('starts with empty state and disconnected mode after stop', () => {
      expect(store.overview.value).toBeNull()
      expect(store.sessions.value).toEqual([])
      expect(store.toolCalls.value).toEqual([])
      expect(store.realtimeMode.value).toBe('disconnected')
      expect(store.lastEventId.value).toBeNull()
    })
  })

  describe('refreshData', () => {
    it('fetches and populates all data', async () => {
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.refreshData()

      expect(store.overview.value).toEqual(MOCK_OVERVIEW)
      expect(store.sessions.value).toEqual(MOCK_SESSIONS.sessions)
      expect(store.toolCalls.value).toEqual(MOCK_TOOL_CALLS.tool_calls)
    })
  })

  describe('start', () => {
    it('fetches initial data and connects SSE', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()

      expect(store.overview.value).toEqual(MOCK_OVERVIEW)
      expect(store.realtimeMode.value).toBe('sse')
      expect(lastEventSource).not.toBeNull()
      expect(lastEventSource!.url).toContain('/api/v1/events/stream')
    })

    it('is idempotent — second call is a no-op', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()
      expect(store.realtimeMode.value).toBe('sse')

      const fetchCallsBefore = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length
      await store.start()
      const fetchCallsAfter = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length
      expect(fetchCallsAfter).toBe(fetchCallsBefore)
    })

    it('falls back to polling when SSE errors', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()

      expect(store.realtimeMode.value).toBe('sse')
      lastEventSource!.triggerError()
      expect(store.realtimeMode.value).toBe('polling')
    })

    it('falls back to polling when EventSource constructor throws', async () => {
      globalThis.EventSource = class {
        constructor() {
          throw new Error('EventSource not supported')
        }
      } as unknown as typeof EventSource

      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()

      expect(store.realtimeMode.value).toBe('polling')
    })
  })

  describe('SSE message handling', () => {
    it('updates lastEventId and refreshes data on stats-update event', async () => {
      installMockEventSource()
      mockFetchSequence([
        MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS,
        MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS,
      ])
      await store.start()

      expect(store.lastEventId.value).toBeNull()

      lastEventSource!.emit('stats-update', {
        last_event_id: 'evt_002',
        updated_at: '2025-06-03T13:00:00Z',
      })

      await new Promise((r) => setTimeout(r, 10))
      expect(store.lastEventId.value).toBe('evt_002')
    })
  })

  describe('stop', () => {
    it('closes SSE and resets mode to disconnected', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()

      expect(store.realtimeMode.value).toBe('sse')
      store.stop()

      expect(store.realtimeMode.value).toBe('disconnected')
      expect(lastEventSource!.closed).toBe(true)
    })
  })

  describe('realtimeMode transitions', () => {
    it('goes disconnected → sse when SSE works', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      expect(store.realtimeMode.value).toBe('disconnected')

      await store.start()
      expect(store.realtimeMode.value).toBe('sse')
    })

    it('goes disconnected → polling when SSE fails', async () => {
      globalThis.EventSource = class {
        constructor() {
          throw new Error('no SSE')
        }
      } as unknown as typeof EventSource

      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()

      expect(store.realtimeMode.value).toBe('polling')
    })

    it('goes sse → polling on SSE error', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS])
      await store.start()
      expect(store.realtimeMode.value).toBe('sse')

      lastEventSource!.triggerError()
      expect(store.realtimeMode.value).toBe('polling')
    })
  })
})
