import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import {
  fetchOverview,
  fetchSessions,
  fetchToolCalls,
  fetchExportSessions,
  fetchExportToolCalls,
  fetchLatest,
  connectSSE,
  setBaseUrl,
} from './client'

// ── Helpers ────────────────────────────────────────────────────────────

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = mock((url: string, init?: RequestInit) => {
    const result = handler(url, init)
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.resolve(result),
      text: () => Promise.resolve(typeof result === 'string' ? result : JSON.stringify(result)),
    } as Response)
  })
  globalThis.fetch = fn as unknown as typeof fetch
  return fn
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('API client', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setBaseUrl('')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('fetchOverview', () => {
    it('sends GET /api/overview and returns typed data', async () => {
      const mockData = {
        total_sessions: 42,
        deleted_sessions: 3,
        total_tokens: 100000,
        total_cost_usd: 0.55,
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchOverview()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/overview')
      expect(result).toEqual(mockData)
    })
  })

  describe('fetchSessions', () => {
    it('sends GET /api/sessions without params by default', async () => {
      const mockData = { sessions: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchSessions()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/sessions')
      expect(result).toEqual(mockData)
    })

    it('passes include_deleted query param when set', async () => {
      const fetchMock = mockFetch(() => ({ sessions: [], count: 0 }))

      await fetchSessions({ include_deleted: true })

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('include_deleted=true')
    })

    it('omits include_deleted when false', async () => {
      const fetchMock = mockFetch(() => ({ sessions: [], count: 0 }))

      await fetchSessions({ include_deleted: false })

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('include_deleted=false')
    })
  })

  describe('fetchToolCalls', () => {
    it('sends GET /api/tool-calls without filter by default', async () => {
      const mockData = { tool_calls: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchToolCalls()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/tool-calls')
      expect(result).toEqual(mockData)
    })

    it('passes session_id query param when provided', async () => {
      const fetchMock = mockFetch(() => ({ tool_calls: [], count: 0 }))

      await fetchToolCalls({ session_id: 'ses_abc123' })

      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('session_id=ses_abc123')
    })
  })

  describe('fetchExportSessions', () => {
    it('sends GET /api/export/sessions.csv and returns text', async () => {
      const csvText = 'session_id,model,total_tokens\nses_001,claude,1000'
      const fetchMock = mockFetch(() => csvText)

      const result = await fetchExportSessions()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/export/sessions.csv')
      expect(result).toBe(csvText)
    })
  })

  describe('fetchExportToolCalls', () => {
    it('sends GET /api/export/tool-calls.json', async () => {
      const mockData = { tool_calls: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchExportToolCalls()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/export/tool-calls.json')
      expect(result).toEqual(mockData)
    })
  })

  describe('fetchLatest', () => {
    it('sends GET /api/events/latest', async () => {
      const mockData = { last_event_id: 'evt_001', updated_at: '2025-06-03T12:00:00Z' }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchLatest()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/events/latest')
      expect(result).toEqual(mockData)
    })
  })

  describe('connectSSE', () => {
    it('creates an EventSource pointing to /api/events/stream', () => {
      const mockClose = mock(() => {})
      let capturedUrl = ''
      class MockEventSource {
        url: string
        onerror: (() => void) | null = null
        constructor(url: string) {
          capturedUrl = url
          this.url = url
        }
        close = mockClose
        addEventListener = mock(() => {})
      }
      globalThis.EventSource = MockEventSource as unknown as typeof EventSource

      const es = connectSSE()

      expect(capturedUrl).toContain('/api/events/stream')
      expect(es).toBeDefined()

      globalThis.EventSource = undefined as unknown as typeof EventSource
    })
  })

  describe('error handling', () => {
    it('throws on non-ok response', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        } as Response),
      ) as unknown as typeof fetch

      await expect(fetchOverview()).rejects.toThrow('API error: 500')
    })
  })
})
