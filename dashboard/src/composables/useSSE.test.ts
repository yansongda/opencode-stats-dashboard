/**
 * TDD tests for useSSE composable.
 *
 * Tests cover:
 * - SSE connection establishment
 * - Auto-reconnect on error (5s interval)
 * - SSE message parsing (StatsUpdate)
 * - Incremental update dispatch by type
 * - Status indicator (green/yellow/red)
 * - Last sync time tracking
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { nextTick } from 'vue'
import { useSSE } from './useSSE'
import type { StatsUpdate, SSEEventType, SSEAction } from '../../../src/types/sse'

// ── Mock EventSource ──────────────────────────────────────────────────

class MockEventSource {
  url: string
  readyState = 0
  onerror: ((event: Event) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  listeners: Record<string, ((event: unknown) => void)[]> = {}
  closed = false

  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static failNext = false

  constructor(url: string) {
    this.url = url
    if (MockEventSource.failNext) {
      setTimeout(() => {
        if (!this.closed && this.onerror) {
          this.onerror(new Event('error'))
        }
      }, 0)
    } else {
      setTimeout(() => {
        if (!this.closed) {
          this.readyState = 1
          const openEvent = new Event('open')
          if (this.onopen) {
            this.onopen(openEvent)
          }
          if (this.listeners['open']) {
            for (const listener of this.listeners['open']) {
              listener(openEvent)
            }
          }
        }
      }, 0)
    }
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners[type]) {
      this.listeners[type] = []
    }
    this.listeners[type].push(listener)
  }

  close() {
    this.closed = true
    this.readyState = 2 // CLOSED
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
  MockEventSource.failNext = false
  globalThis.EventSource = class extends MockEventSource {
    constructor(url: string) {
      super(url)
      mockEventSources.push(this)
    }
  } as unknown as typeof EventSource
}

// ── Test Helpers ──────────────────────────────────────────────────────

function makeStatsUpdate(overrides: Partial<StatsUpdate> = {}): StatsUpdate {
  return {
    event_id: 'evt_test_001',
    timestamp: new Date().toISOString(),
    type: 'session' as SSEEventType,
    action: 'created' as SSEAction,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('useSSE', () => {
  const originalEventSource = globalThis.EventSource
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout

  beforeEach(() => {
    installMockEventSource()
  })

  afterEach(() => {
    globalThis.EventSource = originalEventSource
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
    mockEventSources = []
  })

  // ── Connection Management ────────────────────────────────────────

  describe('connection management', () => {
    it('establishes SSE connection on connect()', async () => {
      const sse = useSSE()
      sse.connect()
      await nextTick()

      expect(mockEventSources.length).toBe(1)
      expect(mockEventSources[0].url).toContain('/api/v1/events/stream')
      sse.disconnect()
    })

    it('sets connectionState to connected on successful open', async () => {
      const sse = useSSE()
      sse.connect()

      // Wait for the mock to fire onopen
      await new Promise((r) => setTimeout(r, 10))
      await nextTick()

      expect(sse.connectionState.value).toBe('connected')
      sse.disconnect()
    })

    it('starts in disconnected state', () => {
      const sse = useSSE()
      expect(sse.connectionState.value).toBe('disconnected')
    })

    it('sets connectionState to connecting when connect() is called', () => {
      const sse = useSSE()
      sse.connect()
      // Before the async open fires
      expect(sse.connectionState.value).toBe('connecting')
      sse.disconnect()
    })

    it('closes EventSource on disconnect()', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      sse.disconnect()

      expect(sse.connectionState.value).toBe('disconnected')
      expect(mockEventSources[0].closed).toBe(true)
    })

    it('does not create duplicate connections on double connect()', async () => {
      const sse = useSSE()
      sse.connect()
      sse.connect()
      await nextTick()

      expect(mockEventSources.length).toBe(1)
      sse.disconnect()
    })
  })

  // ── Auto-Reconnect ───────────────────────────────────────────────

  describe('auto-reconnect', () => {
    it('sets connectionState to reconnecting on error', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()
      await nextTick()

      expect(sse.connectionState.value).toBe('reconnecting')
      sse.disconnect()
    })

    it('reconnects after 5 second interval on error', async () => {
      const sse = useSSE({ reconnectInterval: 100 }) // Use short interval for testing
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()

      // Wait for reconnect
      await new Promise((r) => setTimeout(r, 150))
      await nextTick()

      // Should have created a new EventSource
      expect(mockEventSources.length).toBe(2)
      sse.disconnect()
    })

    it('uses default 5000ms reconnect interval', () => {
      const sse = useSSE()
      expect(sse.reconnectInterval.value).toBe(5000)
      sse.disconnect()
    })

    it('stops reconnecting after disconnect()', async () => {
      const sse = useSSE({ reconnectInterval: 100 })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()
      sse.disconnect()

      // Wait past reconnect interval
      await new Promise((r) => setTimeout(r, 150))
      await nextTick()

      // Should not have created a new EventSource
      expect(mockEventSources.length).toBe(1)
    })
  })

  // ── Message Parsing ──────────────────────────────────────────────

  describe('message parsing', () => {
    it('parses valid StatsUpdate messages', async () => {
      const onMessage = mock(() => {})
      const sse = useSSE({ onMessage })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      const update = makeStatsUpdate()
      mockEventSources[0].emit('stats-update', update)
      await nextTick()

      expect(onMessage).toHaveBeenCalledTimes(1)
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
        event_id: 'evt_test_001',
        type: 'session',
        action: 'created',
      }))
      sse.disconnect()
    })

    it('ignores invalid JSON data', async () => {
      const onMessage = mock(() => {})
      const sse = useSSE({ onMessage })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      // Emit invalid JSON
      if (mockEventSources[0].listeners['stats-update']) {
        for (const listener of mockEventSources[0].listeners['stats-update']) {
          listener({ data: 'not-json' } as MessageEvent)
        }
      }
      await nextTick()

      expect(onMessage).not.toHaveBeenCalled()
      sse.disconnect()
    })

    it('ignores messages without required fields', async () => {
      const onMessage = mock(() => {})
      const sse = useSSE({ onMessage })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      // Emit incomplete data
      mockEventSources[0].emit('stats-update', { event_id: 'evt_001' })
      await nextTick()

      expect(onMessage).not.toHaveBeenCalled()
      sse.disconnect()
    })
  })

  // ── Incremental Update Dispatch ──────────────────────────────────

  describe('incremental update dispatch', () => {
    it('dispatches to onSession for session type events', async () => {
      const onSession = mock(() => {})
      const sse = useSSE({ onSession })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'session' }))
      await nextTick()

      expect(onSession).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })

    it('dispatches to onTool for tool type events', async () => {
      const onTool = mock(() => {})
      const sse = useSSE({ onTool })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'tool' }))
      await nextTick()

      expect(onTool).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })

    it('dispatches to onMessageUpdate for message type events', async () => {
      const onMessageUpdate = mock(() => {})
      const sse = useSSE({ onMessageUpdate })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'message' }))
      await nextTick()

      expect(onMessageUpdate).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })

    it('dispatches to onErrorEvent for error type events', async () => {
      const onErrorEvent = mock(() => {})
      const sse = useSSE({ onErrorEvent })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'error' }))
      await nextTick()

      expect(onErrorEvent).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })

    it('dispatches to onFile for file type events', async () => {
      const onFile = mock(() => {})
      const sse = useSSE({ onFile })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'file' }))
      await nextTick()

      expect(onFile).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })

    it('calls both onMessage and type-specific callback', async () => {
      const onMessage = mock(() => {})
      const onSession = mock(() => {})
      const sse = useSSE({ onMessage, onSession })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate({ type: 'session' }))
      await nextTick()

      expect(onMessage).toHaveBeenCalledTimes(1)
      expect(onSession).toHaveBeenCalledTimes(1)
      sse.disconnect()
    })
  })

  // ── Status Indicator ─────────────────────────────────────────────

  describe('status indicator', () => {
    it('shows green dot when connected and no new data', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      expect(sse.statusDot.value).toBe('green')
      expect(sse.statusLabel.value).toBe('数据已同步')
      sse.disconnect()
    })

    it('shows yellow dot when has new data', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate())
      await nextTick()

      expect(sse.statusDot.value).toBe('yellow')
      expect(sse.statusLabel.value).toBe('有新数据')
      sse.disconnect()
    })

    it('shows red dot when disconnected', () => {
      const sse = useSSE()
      expect(sse.statusDot.value).toBe('red')
      expect(sse.statusLabel.value).toBe('连接断开')
    })

    it('shows red dot when reconnecting', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()
      await nextTick()

      expect(sse.statusDot.value).toBe('red')
      expect(sse.statusLabel.value).toBe('正在重连')
      sse.disconnect()
    })

    it('resets to green after refreshData()', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].emit('stats-update', makeStatsUpdate())
      await nextTick()
      expect(sse.statusDot.value).toBe('yellow')

      sse.markSynced()
      await nextTick()
      expect(sse.statusDot.value).toBe('green')
      sse.disconnect()
    })
  })

  // ── Last Sync Time ───────────────────────────────────────────────

  describe('last sync time', () => {
    it('starts with null lastSyncTime', () => {
      const sse = useSSE()
      expect(sse.lastSyncTime.value).toBeNull()
    })

    it('updates lastSyncTime on message received', async () => {
      const sse = useSSE()
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      const before = new Date()
      mockEventSources[0].emit('stats-update', makeStatsUpdate())
      await nextTick()

      expect(sse.lastSyncTime.value).not.toBeNull()
      expect(sse.lastSyncTime.value!.getTime()).toBeGreaterThanOrEqual(before.getTime())
      sse.disconnect()
    })

    it('updates lastSyncTime on markSynced()', async () => {
      const sse = useSSE()
      sse.markSynced()
      await nextTick()

      expect(sse.lastSyncTime.value).not.toBeNull()
    })
  })

  // ── Integration: Type-specific callbacks receive correct data ────

  describe('type-specific callback data', () => {
    it('passes delta data to onMessageUpdate', async () => {
      const onMessageUpdate = mock(() => {})
      const sse = useSSE({ onMessageUpdate })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      const update = makeStatsUpdate({
        type: 'message',
        delta: { tokens: 1500, cost_usd: 0.015 },
      })
      mockEventSources[0].emit('stats-update', update)
      await nextTick()

      expect(onMessageUpdate).toHaveBeenCalledWith(expect.objectContaining({
        type: 'message',
        delta: { tokens: 1500, cost_usd: 0.015 },
      }))
      sse.disconnect()
    })

    it('passes session_id to onSession', async () => {
      const onSession = mock(() => {})
      const sse = useSSE({ onSession })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      const update = makeStatsUpdate({
        type: 'session',
        session_id: 'ses_xyz789',
      })
      mockEventSources[0].emit('stats-update', update)
      await nextTick()

      expect(onSession).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'ses_xyz789',
      }))
      sse.disconnect()
    })
  })

  // ── Exponential Backoff Reconnect ─────────────────────────────────

  describe('exponential backoff reconnect', () => {
    it('doubles reconnect interval on consecutive failures', async () => {
      MockEventSource.failNext = true
      const sse = useSSE({
        reconnectBaseInterval: 50,
        reconnectMaxInterval: 1000,
      })
      sse.connect()

      // mock[0] auto-fails → scheduleReconnect: attempts=1, interval stays 50
      await new Promise((r) => setTimeout(r, 20))
      expect(sse.reconnectAttempts.value).toBe(1)
      expect(sse.reconnectInterval.value).toBe(50)

      // Wait for reconnect timer → mock[1] auto-fails → scheduleReconnect: attempts=2, interval=100
      await new Promise((r) => setTimeout(r, 80))
      expect(sse.reconnectAttempts.value).toBe(2)
      expect(sse.reconnectInterval.value).toBe(100)

      // Wait for next reconnect → mock[2] auto-fails → scheduleReconnect: attempts=3, interval=200
      await new Promise((r) => setTimeout(r, 150))
      expect(sse.reconnectAttempts.value).toBe(3)
      expect(sse.reconnectInterval.value).toBe(200)

      sse.disconnect()
    })

    it('caps interval at reconnectMaxInterval', async () => {
      MockEventSource.failNext = true
      const sse = useSSE({
        reconnectBaseInterval: 100,
        reconnectMaxInterval: 150,
      })
      sse.connect()

      // mock[0] fails → attempts=1, interval stays 100
      await new Promise((r) => setTimeout(r, 20))
      expect(sse.reconnectInterval.value).toBe(100)

      // mock[1] fails → attempts=2, interval would be 200 but capped at 150
      await new Promise((r) => setTimeout(r, 150))
      expect(sse.reconnectInterval.value).toBe(150)

      sse.disconnect()
    })

    it('resets backoff on successful reconnection', async () => {
      const sse = useSSE({
        reconnectBaseInterval: 50,
        reconnectMaxInterval: 1000,
      })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()
      await nextTick()
      expect(sse.reconnectInterval.value).toBe(50)

      await new Promise((r) => setTimeout(r, 80))
      await nextTick()

      expect(sse.connectionState.value).toBe('connected')
      expect(sse.reconnectInterval.value).toBe(50)

      sse.disconnect()
    })
  })

  // ── Max Reconnect Limit ──────────────────────────────────────────

  describe('max reconnect limit', () => {
    it('stops reconnecting after maxReconnectAttempts', async () => {
      MockEventSource.failNext = true
      const sse = useSSE({
        reconnectBaseInterval: 30,
        reconnectMaxInterval: 100,
        maxReconnectAttempts: 3,
      })
      sse.connect()

      // Wait for all 3 auto-failures to complete
      await new Promise((r) => setTimeout(r, 500))

      expect(sse.connectionState.value).toBe('disconnected')
      expect(sse.reconnectAttempts.value).toBe(3)

      const countBefore = mockEventSources.length
      await new Promise((r) => setTimeout(r, 200))
      expect(mockEventSources.length).toBe(countBefore)

      sse.disconnect()
    })

    it('reconnectAttempts tracks current attempt count', async () => {
      MockEventSource.failNext = true
      const sse = useSSE({
        reconnectBaseInterval: 30,
        maxReconnectAttempts: 5,
      })
      expect(sse.reconnectAttempts.value).toBe(0)

      sse.connect()

      await new Promise((r) => setTimeout(r, 20))
      expect(sse.reconnectAttempts.value).toBe(1)

      await new Promise((r) => setTimeout(r, 50))
      expect(sse.reconnectAttempts.value).toBe(2)

      sse.disconnect()
    })

    it('resets attempt count on successful reconnect', async () => {
      const sse = useSSE({
        reconnectBaseInterval: 30,
        maxReconnectAttempts: 5,
      })
      sse.connect()
      await new Promise((r) => setTimeout(r, 10))

      mockEventSources[0].triggerError()
      await nextTick()
      expect(sse.reconnectAttempts.value).toBe(1)

      await new Promise((r) => setTimeout(r, 50))
      await nextTick()

      expect(sse.connectionState.value).toBe('connected')
      expect(sse.reconnectAttempts.value).toBe(0)

      sse.disconnect()
    })
  })

  // ── Fallback to Polling ──────────────────────────────────────────

  describe('fallback to polling', () => {
    it('calls fallbackToPolling when max attempts reached', async () => {
      MockEventSource.failNext = true
      const fallback = mock(() => Promise.resolve())
      const sse = useSSE({
        reconnectBaseInterval: 30,
        reconnectMaxInterval: 100,
        maxReconnectAttempts: 2,
        fallbackToPolling: fallback,
        pollingInterval: 50,
      })
      sse.connect()

      await new Promise((r) => setTimeout(r, 500))

      expect(sse.isFallbackPolling.value).toBe(true)
      expect(fallback).toHaveBeenCalled()

      sse.disconnect()
    })

    it('periodically calls polling function while in fallback mode', async () => {
      MockEventSource.failNext = true
      const fallback = mock(() => Promise.resolve())
      const sse = useSSE({
        reconnectBaseInterval: 30,
        reconnectMaxInterval: 100,
        maxReconnectAttempts: 2,
        fallbackToPolling: fallback,
        pollingInterval: 50,
      })
      sse.connect()

      await new Promise((r) => setTimeout(r, 500))

      expect(sse.isFallbackPolling.value).toBe(true)
      const callsAfterLimit = fallback.mock.calls.length

      await new Promise((r) => setTimeout(r, 80))
      expect(fallback.mock.calls.length).toBeGreaterThan(callsAfterLimit)

      sse.disconnect()
    })

    it('does not enter fallback when fallbackToPolling is not set', async () => {
      MockEventSource.failNext = true
      const sse = useSSE({
        reconnectBaseInterval: 30,
        maxReconnectAttempts: 2,
      })
      sse.connect()

      await new Promise((r) => setTimeout(r, 500))

      expect(sse.isFallbackPolling.value).toBe(false)
      expect(sse.connectionState.value).toBe('disconnected')

      sse.disconnect()
    })

    it('stops polling on disconnect()', async () => {
      MockEventSource.failNext = true
      const fallback = mock(() => Promise.resolve())
      const sse = useSSE({
        reconnectBaseInterval: 30,
        maxReconnectAttempts: 2,
        fallbackToPolling: fallback,
        pollingInterval: 50,
      })
      sse.connect()

      await new Promise((r) => setTimeout(r, 500))

      expect(sse.isFallbackPolling.value).toBe(true)
      sse.disconnect()

      expect(sse.isFallbackPolling.value).toBe(false)
      expect(sse.connectionState.value).toBe('disconnected')

      const callsAfterDisconnect = fallback.mock.calls.length
      await new Promise((r) => setTimeout(r, 100))
      expect(fallback.mock.calls.length).toBe(callsAfterDisconnect)
    })
  })
})
