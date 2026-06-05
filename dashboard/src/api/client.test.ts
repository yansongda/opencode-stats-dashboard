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
  fetchStatsOverview,
  fetchStatsTrend,
  fetchStatsTools,
  fetchStatsModels,
  fetchStatsProjects,
  fetchStatsSessions,
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
    it('sends GET /api/v1/overview and returns typed data', async () => {
      const mockData = {
        total_sessions: 42,
        deleted_sessions: 3,
        total_tokens: 100000,
        total_cost_usd: 0.55,
        total_messages: 200,
        total_days: 15,
        avg_tokens_per_session: 2380,
        input_tokens: 70000,
        output_tokens: 30000,
        cache_read: 50000,
        cache_write: 10000,
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchOverview()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/overview')
      expect(result).toEqual(mockData)
    })
  })

  describe('fetchSessions', () => {
    it('sends GET /api/v1/sessions without params by default', async () => {
      const mockData = { sessions: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchSessions()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/sessions')
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
    it('sends GET /api/v1/tool-calls without filter by default', async () => {
      const mockData = { tool_calls: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchToolCalls()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/tool-calls')
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
    it('sends GET /api/v1/export/sessions.csv and returns text', async () => {
      const csvText = 'session_id,model,total_tokens\nses_001,claude,1000'
      const fetchMock = mockFetch(() => csvText)

      const result = await fetchExportSessions()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/export/sessions.csv')
      expect(result).toBe(csvText)
    })
  })

  describe('fetchExportToolCalls', () => {
    it('sends GET /api/v1/export/tool-calls.json', async () => {
      const mockData = { tool_calls: [], count: 0 }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchExportToolCalls()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/export/tool-calls.json')
      expect(result).toEqual(mockData)
    })
  })

  describe('fetchLatest', () => {
    it('sends GET /api/v1/events/latest', async () => {
      const mockData = { last_event_id: 'evt_001', updated_at: '2025-06-03T12:00:00Z' }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchLatest()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/events/latest')
      expect(result).toEqual(mockData)
    })
  })

  describe('connectSSE', () => {
    it('creates an EventSource pointing to /api/v1/events/stream', () => {
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

      expect(capturedUrl).toContain('/api/v1/events/stream')
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

  describe('fetchStatsOverview', () => {
    it('sends GET /api/v1/stats/overview and unwraps data', async () => {
      const mockData = {
        data: {
          total_sessions: 10,
          active_sessions: 8,
          deleted_sessions: 2,
          total_tokens: 50000,
          input_tokens: 30000,
          output_tokens: 20000,
          reasoning_tokens: 5000,
          cache_read: 10000,
          cache_write: 2000,
          total_cost_usd: 1.23,
          tool_call_count: 100,
          tool_error_count: 5,
          files_edited: 20,
          lines_added: 500,
          lines_deleted: 100,
          error_count: 3,
          first_event_at: 1717400000000,
          last_event_at: 1717500000000,
        },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsOverview()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/overview')
      expect(result.total_sessions).toBe(10)
      expect(result.total_cost_usd).toBe(1.23)
    })
  })

  describe('fetchStatsTrend', () => {
    it('sends GET /api/v1/stats/trend with date range', async () => {
      const mockData = {
        data: {
          granularity: 'day',
          data: [
            { date: '2026-06-01', tokens: 1000, cost_usd: 0.01, messages: 10, sessions: 2, tool_calls: 5, errors: 0 },
            { date: '2026-06-02', tokens: 2000, cost_usd: 0.02, messages: 20, sessions: 3, tool_calls: 8, errors: 1 },
          ],
        },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsTrend({ start: '2026-06-01', end: '2026-06-02' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/trend')
      expect(calledUrl).toContain('start=2026-06-01')
      expect(calledUrl).toContain('end=2026-06-02')
      expect(result.data).toHaveLength(2)
      expect(result.granularity).toBe('day')
    })
  })

  describe('fetchStatsTools', () => {
    it('sends GET /api/v1/stats/tools and unwraps data', async () => {
      const mockData = {
        data: {
          tools: [
            { tool_name: 'bash', call_count: 50, error_count: 2, success_rate: 0.96, avg_duration_ms: 150, total_tokens: 10000, total_cost_usd: 0.1 },
          ],
          total_calls: 50,
          total_errors: 2,
          success_rate: 0.96,
        },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsTools()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/tools')
      expect(result.tools).toHaveLength(1)
      expect(result.tools[0].tool_name).toBe('bash')
    })
  })

  describe('fetchStatsModels', () => {
    it('sends GET /api/v1/stats/models with date range', async () => {
      const mockData = {
        data: {
          models: [
            { model: 'claude-sonnet', session_count: 5, message_count: 20, total_tokens: 10000, input_tokens: 6000, output_tokens: 4000, reasoning_tokens: 0, total_cost_usd: 0.5, avg_cost_per_session: 0.1, tool_call_count: 10, error_count: 0 },
          ],
          total_cost_usd: 0.5,
        },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsModels({ start: '2026-06-01', end: '2026-06-30' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/models')
      expect(result.models).toHaveLength(1)
      expect(result.total_cost_usd).toBe(0.5)
    })
  })

  describe('fetchStatsProjects', () => {
    it('sends GET /api/v1/stats/projects and unwraps data', async () => {
      const mockData = {
        data: {
          projects: [
            { project_path: '/Users/test/project-a', session_count: 10, total_tokens: 50000, total_cost_usd: 1.0, last_event_at: null, primary_model: 'claude-sonnet' },
          ],
          total_cost_usd: 1.0,
        },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsProjects()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/projects')
      expect(result.projects).toHaveLength(1)
    })
  })

  describe('fetchStatsSessions', () => {
    it('sends GET /api/v1/stats/sessions with pagination', async () => {
      const mockData = {
        data: {
          sessions: [
            { session_id: 'ses_001', project_path: '/test', title: 'Test', status: 'active', primary_model: 'claude-sonnet', total_tokens: 1000, total_cost_usd: 0.01, duration_ms: 60000, last_event_at: 1717500000000, event_count: 5 },
          ],
          total: 1,
        },
        meta: { total: 1, limit: 10, offset: 0 },
      }
      const fetchMock = mockFetch(() => mockData)

      const result = await fetchStatsSessions({ limit: 10, offset: 0 })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const calledUrl = fetchMock.mock.calls[0][0] as string
      expect(calledUrl).toContain('/api/v1/stats/sessions')
      expect(calledUrl).toContain('limit=10')
      expect(calledUrl).toContain('offset=0')
      expect(result.sessions).toHaveLength(1)
    })
  })
})
