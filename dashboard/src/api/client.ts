// ── API Types (matching sidecar Rust structs) ──────────────────────────

export interface OverviewResponse {
  total_sessions: number
  deleted_sessions: number
  total_tokens: number
  total_cost_usd: number
}

export interface SessionRow {
  session_id: string
  project_path: string | null
  model: string | null
  total_tokens: number
  total_cost_usd: number
  deleted: boolean
  deleted_at: string | null
  first_event_at: string | null
  last_event_at: string | null
  tool_call_count: number
}

export interface SessionsResponse {
  sessions: SessionRow[]
  count: number
}

export interface ToolCallRow {
  id: number
  tool_name: string
  session_id: string
  status: string
  model: string | null
  tokens: number | null
  cost_usd: number | null
  started_at: string | null
  completed_at: string | null
  summary: string | null
}

export interface ToolCallsResponse {
  tool_calls: ToolCallRow[]
  count: number
}

export interface ExportToolCallRow {
  tool_name: string
  session_id: string
  status: string
  model: string | null
  tokens: number | null
  cost_usd: number | null
  started_at: string | null
  completed_at: string | null
  summary: string | null
}

export interface ExportToolCallsResponse {
  tool_calls: ExportToolCallRow[]
  count: number
}

export interface StatsUpdate {
  last_event_id: string
  updated_at: string
}

export interface LatestResponse {
  last_event_id: string | null
  updated_at: string | null
  message?: string
}

export interface SessionQueryParams {
  include_deleted?: boolean
}

export interface ToolCallQueryParams {
  session_id?: string
}

// ── API Client ─────────────────────────────────────────────────────────

const DEFAULT_BASE = ''

let baseUrl = DEFAULT_BASE

export function setBaseUrl(url: string): void {
  baseUrl = url.replace(/\/+$/, '')
}

function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return 'http://localhost'
}

function buildUrl(path: string, params?: Record<string, string | boolean | undefined>): string {
  const url = new URL(path, baseUrl || getOrigin())
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  // Return just pathname + search when base is default (same-origin)
  if (!baseUrl) {
    return url.pathname + url.search
  }
  return url.toString()
}

async function getJson<T>(path: string, params?: Record<string, string | boolean | undefined>): Promise<T> {
  const url = buildUrl(path, params)
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function getText(path: string): Promise<string> {
  const url = buildUrl(path)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

// ── Query endpoints ────────────────────────────────────────────────────

export function fetchOverview(): Promise<OverviewResponse> {
  return getJson<OverviewResponse>('/api/v1/overview')
}

export function fetchSessions(params?: SessionQueryParams): Promise<SessionsResponse> {
  return getJson<SessionsResponse>('/api/v1/sessions', {
    include_deleted: params?.include_deleted,
  })
}

export function fetchToolCalls(params?: ToolCallQueryParams): Promise<ToolCallsResponse> {
  return getJson<ToolCallsResponse>('/api/v1/tool-calls', {
    session_id: params?.session_id,
  })
}

export function fetchExportSessions(): Promise<string> {
  return getText('/api/v1/export/sessions.csv')
}

export function fetchExportToolCalls(): Promise<ExportToolCallsResponse> {
  return getJson<ExportToolCallsResponse>('/api/v1/export/tool-calls.json')
}

export function connectSSE(): EventSource {
  const url = buildUrl('/api/v1/events/stream')
  return new EventSource(url)
}

export function fetchLatest(): Promise<LatestResponse> {
  return getJson<LatestResponse>('/api/v1/events/latest')
}
