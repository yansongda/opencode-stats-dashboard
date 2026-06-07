// ── API Types (matching sidecar Rust structs) ──────────────────────────

export interface OverviewResponse {
  total_sessions: number
  deleted_sessions: number
  total_tokens: number
  total_cost_usd: number
  total_messages: number
  total_days: number
  avg_tokens_per_session: number
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number
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

export interface CleanupResponse {
  deleted: number
  message?: string
}

export async function cleanupDeleted(): Promise<CleanupResponse> {
  const url = buildUrl('/api/v1/cleanup/deleted')
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<CleanupResponse>
}

export async function cleanupAll(): Promise<CleanupResponse> {
  const url = buildUrl('/api/v1/cleanup/all')
  const res = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
  return res.json() as Promise<CleanupResponse>
}

// ── New Stats API Types (matching Task 12 endpoints) ─────────────────

export interface StatsOverviewResponse {
  total_sessions: number
  active_sessions: number
  deleted_sessions: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number
  total_cost_usd: number
  tool_call_count: number
  tool_error_count: number
  files_edited: number
  lines_added: number
  lines_deleted: number
  error_count: number
  first_event_at: number | null
  last_event_at: number | null
}

export interface TrendDataPoint {
  date: string
  tokens: number
  cost_usd: number
  messages: number
  sessions: number
  tool_calls: number
  errors: number
}

export interface StatsTrendResponse {
  granularity: 'day' | 'week' | 'month'
  data: TrendDataPoint[]
}

export interface ToolStatsItem {
  tool_name: string
  call_count: number
  error_count: number
  success_rate: number
  avg_duration_ms: number
  total_tokens: number
  total_cost_usd: number
}

export interface StatsToolsResponse {
  tools: ToolStatsItem[]
  total_calls: number
  total_errors: number
  success_rate: number
}

export interface StatsModelItem {
  model: string
  session_count: number
  message_count: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  total_cost_usd: number
  avg_cost_per_session: number
  tool_call_count: number
  error_count: number
}

export interface StatsModelsResponse {
  models: StatsModelItem[]
  total_cost_usd: number
}

export interface ProjectStatsItem {
  project_path: string
  session_count: number
  total_tokens: number
  total_cost_usd: number
  last_event_at: number | null
  primary_model: string | null
}

export interface StatsProjectsResponse {
  projects: ProjectStatsItem[]
  total_cost_usd: number
}

export interface StatsSessionListItem {
  session_id: string
  project_path: string | null
  title: string | null
  status: 'active' | 'deleted'
  primary_model: string | null
  total_tokens: number
  total_cost_usd: number
  duration_ms: number | null
  last_event_at: number | null
  event_count: number
}

export interface StatsSessionsResponse {
  sessions: StatsSessionListItem[]
  total: number
}

export interface SessionDetail {
  session_id: string
  project_path: string | null
  title: string | null
  status: 'active' | 'deleted'
  primary_model: string | null
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number
  total_cost_usd: number
  duration_ms: number | null
  first_event_at: number | null
  last_event_at: number | null
  event_count: number
  user_message_count: number
  assistant_message_count: number
  tool_call_count: number
  tool_error_count: number
  files_edited: number
  lines_added: number
  lines_deleted: number
  error_count: number
  model_usage: Record<string, unknown> | null
}

// ── New Stats API Client ─────────────────────────────────────────────

export interface StatsTimeRange {
  start?: string
  end?: string
}

function unwrapData<T>(json: { data: T }): T {
  return json.data
}

export function fetchStatsOverview(): Promise<StatsOverviewResponse> {
  return getJson<{ data: StatsOverviewResponse }>('/api/v1/stats/overview').then(unwrapData)
}

export function fetchStatsTrend(range?: StatsTimeRange): Promise<StatsTrendResponse> {
  return getJson<{ data: StatsTrendResponse }>('/api/v1/stats/trend', {
    start: range?.start,
    end: range?.end,
  }).then(unwrapData)
}

export function fetchStatsTools(range?: StatsTimeRange): Promise<StatsToolsResponse> {
  return getJson<{ data: StatsToolsResponse }>('/api/v1/stats/tools', {
    start: range?.start,
    end: range?.end,
  }).then(unwrapData)
}

export function fetchStatsModels(range?: StatsTimeRange): Promise<StatsModelsResponse> {
  return getJson<{ data: StatsModelsResponse }>('/api/v1/stats/models', {
    start: range?.start,
    end: range?.end,
  }).then(unwrapData)
}

export function fetchStatsProjects(range?: StatsTimeRange): Promise<StatsProjectsResponse> {
  return getJson<{ data: StatsProjectsResponse }>('/api/v1/stats/projects', {
    start: range?.start,
    end: range?.end,
  }).then(unwrapData)
}

export function fetchStatsSessions(params?: { limit?: number; offset?: number; status?: string }): Promise<StatsSessionsResponse> {
  return getJson<{ data: StatsSessionsResponse; meta: { total: number; limit: number; offset: number } }>(
    '/api/v1/stats/sessions',
    {
      limit: params?.limit != null ? String(params.limit) : undefined,
      offset: params?.offset != null ? String(params.offset) : undefined,
      status: params?.status,
    },
  ).then((json) => json.data)
}

export function fetchStatsSessionDetail(sessionId: string): Promise<SessionDetail> {
  return getJson<{ data: SessionDetail }>(`/api/v1/stats/sessions/${sessionId}`).then(unwrapData)
}
