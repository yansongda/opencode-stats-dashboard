/**
 * HTTP API server — replaces the Rust sidecar's API layer.
 *
 * Uses `Bun.serve()` (built-in, no npm install needed).
 * All endpoints are under `/api/v1/` to match the dashboard client expectations.
 *
 * Endpoints:
 *   GET  /api/v1/overview              — aggregate statistics
 *   GET  /api/v1/sessions              — list sessions
 *   GET  /api/v1/tool-calls            — list tool calls
 *   GET  /api/v1/events/stream         — SSE stream for real-time updates
 *   GET  /api/v1/events/latest         — latest event metadata
 *   GET  /api/v1/export/sessions.csv   — CSV export of sessions
 *   GET  /api/v1/export/tool-calls.json — JSON export of tool calls
 *   POST /api/v1/ingest/event          — ingest a new event
 */

import { Database } from "bun:sqlite"
import { runMigrations } from "../db/schema"
import { insertEvent } from "../db/event"
import { processSessionEvent, processToolEvent } from "../db/reducer"
import { FORBIDDEN_METADATA_KEYS, type IngestEventEnvelope } from "../types"
import { SSEBroadcaster, type StatsUpdate } from "./sse"

// ── Response types ─────────────────────────────────────────────────────

interface OverviewResponse {
  total_sessions: number
  deleted_sessions: number
  total_tokens: number
  total_cost_usd: number
}

interface SessionRow {
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

interface SessionsResponse {
  sessions: SessionRow[]
  count: number
}

interface ToolCallRow {
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

interface ToolCallsResponse {
  tool_calls: ToolCallRow[]
  count: number
}

interface ExportToolCallRow {
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

interface ExportToolCallsResponse {
  tool_calls: ExportToolCallRow[]
  count: number
}

interface LatestResponse {
  last_event_id: string | null
  updated_at: string | null
  message?: string
}

interface IngestAcceptedResponse {
  accepted: true
  duplicate: boolean
}

interface IngestRejectedResponse {
  accepted: false
  error: string
  detail?: string
}

// ── Shared headers ─────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

const JSON_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  "Content-Type": "application/json; charset=utf-8",
}

// ── CSV helper ─────────────────────────────────────────────────────────

/** Escape a CSV field — wraps in quotes if it contains comma, quote, or newline. */
function csvEscape(value: string | null): string {
  if (value === null) return ""
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

// ── Server factory ─────────────────────────────────────────────────────

/**
 * Create and start the HTTP API server.
 *
 * @param db    A bun:sqlite Database instance (already opened).
 * @param port  Port to listen on (127.0.0.1:{port}).
 * @returns     The server URL and a stop function.
 */
export function createServer(
  db: Database,
  port: number,
): { url: string; stop: () => void } {
  // Run migrations on startup
  runMigrations(db)

  const broadcaster = new SSEBroadcaster()

  const server = Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url)
      const path = url.pathname

      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: CORS_HEADERS })
      }

      try {
        // ── GET /api/v1/overview ──────────────────────────────────────
        if (path === "/api/v1/overview" && req.method === "GET") {
          return handleOverview(db)
        }

        // ── GET /api/v1/sessions ─────────────────────────────────────
        if (path === "/api/v1/sessions" && req.method === "GET") {
          return handleSessions(db, url)
        }

        // ── GET /api/v1/tool-calls ───────────────────────────────────
        if (path === "/api/v1/tool-calls" && req.method === "GET") {
          return handleToolCalls(db, url)
        }

        // ── GET /api/v1/events/stream ────────────────────────────────
        if (path === "/api/v1/events/stream" && req.method === "GET") {
          return handleSSEStream(broadcaster)
        }

        // ── GET /api/v1/events/latest ────────────────────────────────
        if (path === "/api/v1/events/latest" && req.method === "GET") {
          return handleLatestEvent(db)
        }

        // ── GET /api/v1/export/sessions.csv ──────────────────────────
        if (path === "/api/v1/export/sessions.csv" && req.method === "GET") {
          return handleExportSessionsCSV(db)
        }

        // ── GET /api/v1/export/tool-calls.json ───────────────────────
        if (
          path === "/api/v1/export/tool-calls.json" &&
          req.method === "GET"
        ) {
          return handleExportToolCallsJSON(db)
        }

        // ── POST /api/v1/ingest/event ────────────────────────────────
        if (path === "/api/v1/ingest/event" && req.method === "POST") {
          return await handleIngestEvent(db, broadcaster, req)
        }

        // ── 404 ──────────────────────────────────────────────────────
        return jsonResponse({ error: "not_found" }, 404)
      } catch (err) {
        const detail =
          err instanceof Error ? err.message : String(err)
        return jsonResponse(
          { error: "internal_error", detail },
          500,
        )
      }
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(),
  }
}

// ── Route handlers ─────────────────────────────────────────────────────

/** `GET /api/v1/overview` — aggregate statistics across all sessions. */
function handleOverview(db: Database): Response {
  const totalSessions = (
    db.query("SELECT COUNT(*) as cnt FROM sessions").get() as {
      cnt: number
    }
  ).cnt

  const deletedSessions = (
    db
      .query(
        "SELECT COUNT(*) as cnt FROM sessions WHERE deleted = TRUE",
      )
      .get() as { cnt: number }
  ).cnt

  const totalTokens = (
    db
      .query(
        "SELECT COALESCE(SUM(total_tokens), 0) as total FROM sessions",
      )
      .get() as { total: number }
  ).total

  const totalCostUsd = (
    db
      .query(
        "SELECT COALESCE(SUM(total_cost_usd), 0.0) as total FROM sessions",
      )
      .get() as { total: number }
  ).total

  const body: OverviewResponse = {
    total_sessions: totalSessions,
    deleted_sessions: deletedSessions,
    total_tokens: totalTokens,
    total_cost_usd: totalCostUsd,
  }

  return jsonResponse(body)
}

/**
 * `GET /api/v1/sessions?include_deleted=true/false`
 *
 * By default, deleted sessions are excluded. Pass `include_deleted=true`
 * to include all sessions.
 */
function handleSessions(db: Database, url: URL): Response {
  const includeDeleted =
    url.searchParams.get("include_deleted") === "true"

  const sql = includeDeleted
    ? `SELECT session_id, project_path, model, total_tokens, total_cost_usd,
              deleted, deleted_at, first_event_at, last_event_at, tool_call_count
       FROM sessions ORDER BY last_event_at DESC`
    : `SELECT session_id, project_path, model, total_tokens, total_cost_usd,
              deleted, deleted_at, first_event_at, last_event_at, tool_call_count
       FROM sessions WHERE deleted = FALSE ORDER BY last_event_at DESC`

  const sessions = db.query(sql).all() as SessionRow[]

  const body: SessionsResponse = {
    sessions,
    count: sessions.length,
  }

  return jsonResponse(body)
}

/**
 * `GET /api/v1/tool-calls?session_id=xxx`
 *
 * Returns tool calls, optionally filtered by session_id.
 */
function handleToolCalls(db: Database, url: URL): Response {
  const sessionId = url.searchParams.get("session_id")

  const sql = sessionId
    ? `SELECT id, tool_name, session_id, status, model, tokens, cost_usd,
              started_at, completed_at, summary
       FROM tool_calls WHERE session_id = ? ORDER BY started_at`
    : `SELECT id, tool_name, session_id, status, model, tokens, cost_usd,
              started_at, completed_at, summary
       FROM tool_calls ORDER BY session_id, started_at`

  const toolCalls = (
    sessionId ? db.query(sql).all(sessionId) : db.query(sql).all()
  ) as ToolCallRow[]

  const body: ToolCallsResponse = {
    tool_calls: toolCalls,
    count: toolCalls.length,
  }

  return jsonResponse(body)
}

/**
 * `GET /api/v1/events/stream`
 *
 * SSE stream that pushes StatsUpdate messages to connected clients.
 */
function handleSSEStream(broadcaster: SSEBroadcaster): Response {
  const stream = broadcaster.subscribe()

  return new Response(stream, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

/**
 * `GET /api/v1/events/latest`
 *
 * Returns the most recent event's id and timestamp.
 */
function handleLatestEvent(db: Database): Response {
  const row = db
    .query(
      "SELECT event_id, created_at FROM events ORDER BY timestamp_ms DESC LIMIT 1",
    )
    .get() as { event_id: string; created_at: string | null } | null

  if (!row) {
    const body: LatestResponse = {
      last_event_id: null,
      updated_at: null,
      message: "no_events_ingested",
    }
    return jsonResponse(body)
  }

  const body: LatestResponse = {
    last_event_id: row.event_id,
    updated_at: row.created_at ?? new Date().toISOString(),
  }

  return jsonResponse(body)
}

/**
 * `GET /api/v1/export/sessions.csv`
 *
 * Exports all sessions (including deleted) as CSV.
 * Columns: session_id, project_path, model, total_tokens, total_cost_usd, deleted
 */
function handleExportSessionsCSV(db: Database): Response {
  const rows = db
    .query(
      `SELECT session_id, project_path, model, total_tokens, total_cost_usd, deleted
       FROM sessions ORDER BY session_id`,
    )
    .all() as Array<{
    session_id: string
    project_path: string | null
    model: string | null
    total_tokens: number
    total_cost_usd: number
    deleted: boolean | number
  }>

  const header =
    "session_id,project_path,model,total_tokens,total_cost_usd,deleted"
  const csvLines = rows.map(
    (row) =>
      [
        csvEscape(row.session_id),
        csvEscape(row.project_path),
        csvEscape(row.model),
        row.total_tokens,
        row.total_cost_usd,
        row.deleted ? "true" : "false",
      ].join(","),
  )

  const csv = [header, ...csvLines].join("\n")

  return new Response(csv, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
    },
  })
}

/**
 * `GET /api/v1/export/tool-calls.json`
 *
 * Exports tool call rows without tool_input, tool_output, or message_body.
 */
function handleExportToolCallsJSON(db: Database): Response {
  const toolCalls = db
    .query(
      `SELECT tool_name, session_id, status, model, tokens, cost_usd,
              started_at, completed_at, summary
       FROM tool_calls ORDER BY session_id, started_at`,
    )
    .all() as ExportToolCallRow[]

  const body: ExportToolCallsResponse = {
    tool_calls: toolCalls,
    count: toolCalls.length,
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

/**
 * `POST /api/v1/ingest/event`
 *
 * Accepts an IngestEventEnvelope JSON body, inserts into the events table,
 * runs session/tool reducers, and broadcasts an SSE update for new events.
 */
async function handleIngestEvent(
  db: Database,
  broadcaster: SSEBroadcaster,
  req: Request,
): Promise<Response> {
  // Parse JSON body
  let event: IngestEventEnvelope
  try {
    event = (await req.json()) as IngestEventEnvelope
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return jsonResponse(
      {
        accepted: false,
        error: "invalid_json",
        detail,
      } satisfies IngestRejectedResponse,
      400,
    )
  }

  // Validate privacy — metadata must not contain forbidden keys
  if (event.metadata) {
    for (const key of FORBIDDEN_METADATA_KEYS) {
      if (key in event.metadata) {
        return jsonResponse(
          {
            accepted: false,
            error: "full_payload_not_allowed",
            detail: `metadata contains forbidden key '${key}'`,
          } satisfies IngestRejectedResponse,
          400,
        )
      }
    }
  }

  // Insert event (idempotent)
  const result = insertEvent(db, event)

  if (result === "duplicate") {
    // Do NOT broadcast for duplicates
    return jsonResponse({
      accepted: true,
      duplicate: true,
    } satisfies IngestAcceptedResponse)
  }

  // Run reducers for accepted events
  try {
    processSessionEvent(db, event)
  } catch {
    // Session reducer errors are non-fatal — log and continue
  }

  try {
    processToolEvent(db, event)
  } catch {
    // Tool reducer errors are non-fatal (e.g. missing started record)
  }

  // Broadcast SSE update for new (non-duplicate) events
  const update: StatsUpdate = {
    last_event_id: event.event_id,
    updated_at: new Date().toISOString(),
  }
  broadcaster.broadcast(update)

  return jsonResponse({
    accepted: true,
    duplicate: false,
  } satisfies IngestAcceptedResponse)
}

// ── Utility ────────────────────────────────────────────────────────────

/** Build a JSON Response with CORS headers. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}
