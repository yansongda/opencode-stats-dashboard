import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { nextTick } from 'vue'
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

const MOCK_MODELS_RESPONSE = {
  data: {
    models: [
      {
        model: 'claude-sonnet',
        session_count: 1,
        message_count: 10,
        total_tokens: 5000,
        input_tokens: 3000,
        output_tokens: 2000,
        reasoning_tokens: 0,
        cache_read: 1000,
        cache_write: 500,
        total_cost_usd: 0.05,
        avg_cost_per_session: 0.05,
        tool_call_count: 5,
        error_count: 0,
      },
    ],
    total_cost_usd: 0.05,
  },
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
  readyState = 0
  onerror: ((event: Event) => void) | null = null
  listeners: Record<string, ((event: unknown) => void)[]> = {}
  closed = false

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2

  constructor(url: string) {
    this.url = url
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = 1
        const openEvent = new Event('open')
        if (this.listeners['open']) {
          for (const listener of this.listeners['open']) {
            listener(openEvent)
          }
        }
      }
    }, 0)
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  close() {
    this.closed = true
    this.readyState = 2
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

let mockEventSources: MockEventSource[] = []

function installMockEventSource() {
  mockEventSources = []
  globalThis.EventSource = class extends MockEventSource {
    constructor(url: string) {
      super(url)
      mockEventSources.push(this)
    }
  } as unknown as typeof EventSource
}

describe('useStatsStore', () => {
  const originalFetch = globalThis.fetch
  const originalEventSource = globalThis.EventSource
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
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
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    mockEventSources = []
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
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.refreshData()

      expect(store.overview.value).toEqual(MOCK_OVERVIEW)
      expect(store.sessions.value).toEqual(MOCK_SESSIONS.sessions)
      expect(store.toolCalls.value).toEqual(MOCK_TOOL_CALLS.tool_calls)
    })
  })

  describe('start', () => {
    it('fetches initial data and connects SSE', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))

      expect(store.overview.value).toEqual(MOCK_OVERVIEW)
      expect(store.realtimeMode.value).toBe('sse')
      expect(mockEventSources.length).toBeGreaterThan(0)
      expect(mockEventSources[0].url).toContain('/api/v1/events/stream')
    })

    it('is idempotent — second call is a no-op', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))
      expect(store.realtimeMode.value).toBe('sse')

      const fetchCallsBefore = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length
      await store.start()
      const fetchCallsAfter = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length
      expect(fetchCallsAfter).toBe(fetchCallsBefore)
    })

    it('enters reconnecting state on SSE error (auto-reconnect)', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))

      expect(store.realtimeMode.value).toBe('sse')
      mockEventSources[0].triggerError()
      await nextTick()

      // With auto-reconnect, mode stays 'sse' (reconnecting)
      expect(store.realtimeMode.value).toBe('sse')
    })

    it('falls back to polling when EventSource constructor throws', async () => {
      globalThis.EventSource = class {
        constructor() {
          throw new Error('EventSource not supported')
        }
      } as unknown as typeof EventSource

      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()

      expect(store.realtimeMode.value).toBe('polling')
    })
  })

  describe('SSE message handling', () => {
    it('updates lastEventId and refreshes data on stats-update event', async () => {
      installMockEventSource()
      mockFetchSequence([
        MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE,
        MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE,
      ])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))

      expect(store.lastEventId.value).toBeNull()

      mockEventSources[0].emit('stats-update', {
        event_id: 'evt_002',
        timestamp: '2025-06-03T13:00:00Z',
        type: 'session',
        action: 'created',
      })

      await new Promise((r) => setTimeout(r, 10))
      expect(store.lastEventId.value).toBe('evt_002')
    })
  })

  describe('stop', () => {
    it('closes SSE and resets mode to disconnected', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))

      expect(store.realtimeMode.value).toBe('sse')
      store.stop()

      expect(store.realtimeMode.value).toBe('disconnected')
      expect(mockEventSources[0].closed).toBe(true)
    })
  })

  describe('realtimeMode transitions', () => {
    it('goes disconnected → sse when SSE works', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      expect(store.realtimeMode.value).toBe('disconnected')

      await store.start()
      await new Promise((r) => setTimeout(r, 10))
      expect(store.realtimeMode.value).toBe('sse')
    })

    it('goes disconnected → polling when SSE constructor fails', async () => {
      globalThis.EventSource = class {
        constructor() {
          throw new Error('no SSE')
        }
      } as unknown as typeof EventSource

      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()

      expect(store.realtimeMode.value).toBe('polling')
    })

    it('goes sse → sse (reconnecting) on SSE error', async () => {
      installMockEventSource()
      mockFetchSequence([MOCK_OVERVIEW, MOCK_SESSIONS, MOCK_TOOL_CALLS, MOCK_MODELS_RESPONSE])
      await store.start()
      await new Promise((r) => setTimeout(r, 10))
      expect(store.realtimeMode.value).toBe('sse')

      mockEventSources[0].triggerError()
      await nextTick()

      // Auto-reconnect keeps mode as 'sse'
      expect(store.realtimeMode.value).toBe('sse')
    })
  })
})
