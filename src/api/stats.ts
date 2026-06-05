/**
 * Stats API handler — 8 REST endpoints for querying stats.
 *
 * Endpoints:
 *  - GET /api/v1/stats/overview        — overview statistics
 *  - GET /api/v1/stats/trend           — trend data
 *  - GET /api/v1/stats/sessions        — session list
 *  - GET /api/v1/stats/sessions/:id    — session detail
 *  - GET /api/v1/stats/tools           — tool statistics
 *  - GET /api/v1/stats/models          — model comparison
 *  - GET /api/v1/stats/projects        — project comparison
 *  - GET /api/v1/stats/errors          — error statistics
 *
 * Design doc: §7.1 — API endpoint list.
 */

import type { Database } from "bun:sqlite"
import type { RouteRegistrar } from "./handlers/types"
import type { ParsedRequest, ResponseHelpers, RouteHandler } from "./router"
import type {
  OverviewStats,
  TrendResponse,
  SessionsListResponse,
  SessionDetail,
  ToolsStatsResponse,
  ModelsComparisonResponse,
  ProjectsStatsResponse,
  ErrorsStatsResponse,
} from "../types/api"

// ============================================================================
// Query Parameter Parsing
// ============================================================================

function parseTimeRange(query: URLSearchParams): { start?: string; end?: string } {
  const start = query.get("start") || undefined
  const end = query.get("end") || undefined
  return { start, end }
}

function parsePagination(query: URLSearchParams): { limit: number; offset: number } {
  const limit = Math.max(1, Math.min(100, Number(query.get("limit")) || 50))
  const offset = Math.max(0, Number(query.get("offset")) || 0)
  return { limit, offset }
}

// ============================================================================
// Endpoint Handlers
// ============================================================================

function createOverviewHandler(db: Database): RouteHandler {
  return (_req: ParsedRequest, res: ResponseHelpers) => {
    const sessionRow = db.query(`
      SELECT
        COUNT(*) as total_sessions,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_sessions,
        SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted_sessions,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(reasoning_tokens) as reasoning_tokens,
        SUM(cache_read) as cache_read,
        SUM(cache_write) as cache_write,
        SUM(total_cost_usd) as total_cost_usd,
        SUM(tool_call_count) as tool_call_count,
        SUM(tool_error_count) as tool_error_count,
        SUM(files_edited) as files_edited,
        SUM(lines_added) as lines_added,
        SUM(lines_deleted) as lines_deleted,
        SUM(error_count) as error_count,
        MIN(first_event_at) as first_event_at,
        MAX(last_event_at) as last_event_at
      FROM projection_sessions
    `).get() as Record<string, number | null> | null

    const data: OverviewStats = {
      total_sessions: sessionRow?.["total_sessions"] ?? 0,
      active_sessions: sessionRow?.["active_sessions"] ?? 0,
      deleted_sessions: sessionRow?.["deleted_sessions"] ?? 0,
      total_tokens: sessionRow?.["total_tokens"] ?? 0,
      input_tokens: sessionRow?.["input_tokens"] ?? 0,
      output_tokens: sessionRow?.["output_tokens"] ?? 0,
      reasoning_tokens: sessionRow?.["reasoning_tokens"] ?? 0,
      cache_read: sessionRow?.["cache_read"] ?? 0,
      cache_write: sessionRow?.["cache_write"] ?? 0,
      total_cost_usd: sessionRow?.["total_cost_usd"] ?? 0,
      tool_call_count: sessionRow?.["tool_call_count"] ?? 0,
      tool_error_count: sessionRow?.["tool_error_count"] ?? 0,
      files_edited: sessionRow?.["files_edited"] ?? 0,
      lines_added: sessionRow?.["lines_added"] ?? 0,
      lines_deleted: sessionRow?.["lines_deleted"] ?? 0,
      error_count: sessionRow?.["error_count"] ?? 0,
      first_event_at: sessionRow?.["first_event_at"] ?? null,
      last_event_at: sessionRow?.["last_event_at"] ?? null,
    }

    return res.json({ data })
  }
}

function createTrendHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const { start, end } = parseTimeRange(req.query)

    let sql = `
      SELECT
        date,
        SUM(total_tokens) as tokens,
        SUM(total_cost_usd) as cost_usd,
        SUM(message_count) as messages,
        SUM(session_count) as sessions,
        SUM(tool_calls) as tool_calls,
        SUM(error_count) as errors
      FROM projection_daily
    `

    const params: string[] = []
    if (start && end) {
      sql += " WHERE date BETWEEN ? AND ?"
      params.push(start, end)
    }

    sql += " GROUP BY date ORDER BY date"

    const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>

    const data: TrendResponse = {
      granularity: "day",
      data: rows.map((row) => ({
        date: String(row["date"]),
        tokens: Number(row["tokens"]) || 0,
        cost_usd: Number(row["cost_usd"]) || 0,
        messages: Number(row["messages"]) || 0,
        sessions: Number(row["sessions"]) || 0,
        tool_calls: Number(row["tool_calls"]) || 0,
        errors: Number(row["errors"]) || 0,
      })),
    }

    return res.json({ data })
  }
}

function createSessionsHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const { limit, offset } = parsePagination(req.query)
    const status = req.query.get("status") || undefined

    let whereClause = ""
    const params: (string | number)[] = []

    if (status) {
      whereClause = " WHERE status = ?"
      params.push(status)
    }

    const countRow = db.query(
      `SELECT COUNT(*) as total FROM projection_sessions${whereClause}`
    ).get(...params) as { total: number }

    const total = countRow?.total ?? 0

    const rows = db.query(
      `SELECT session_id, project_path, title, status, primary_model,
              total_tokens, total_cost_usd, duration_ms, last_event_at, event_count
       FROM projection_sessions${whereClause}
       ORDER BY last_event_at DESC
       LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Array<Record<string, unknown>>

    const data: SessionsListResponse = {
      sessions: rows.map((row) => ({
        session_id: String(row["session_id"]),
        project_path: row["project_path"] as string | null,
        title: row["title"] as string | null,
        status: (row["status"] as "active" | "deleted") ?? "active",
        primary_model: row["primary_model"] as string | null,
        total_tokens: Number(row["total_tokens"]) || 0,
        total_cost_usd: Number(row["total_cost_usd"]) || 0,
        duration_ms: row["duration_ms"] != null ? Number(row["duration_ms"]) : null,
        last_event_at: row["last_event_at"] != null ? Number(row["last_event_at"]) : null,
        event_count: Number(row["event_count"]) || 0,
      })),
      total,
    }

    return res.json({ data, meta: { total, limit, offset } })
  }
}

function createSessionDetailHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const id = req.params["id"]
    if (!id) {
      return res.error("Missing session id", 400)
    }

    const row = db.query("SELECT * FROM projection_sessions WHERE session_id = ?").get(id) as Record<string, unknown> | null

    if (!row) {
      return res.error("Session not found", 404)
    }

    const parseJsonSafe = (val: unknown): Record<string, unknown> | null => {
      if (typeof val !== "string") return null
      try {
        const parsed = JSON.parse(val)
        return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null
      } catch {
        return null
      }
    }

    const data: SessionDetail = {
      session_id: String(row["session_id"]),
      project_path: row["project_path"] as string | null,
      title: row["title"] as string | null,
      status: (row["status"] as "active" | "deleted") ?? "active",
      primary_model: row["primary_model"] as string | null,
      total_tokens: Number(row["total_tokens"]) || 0,
      total_cost_usd: Number(row["total_cost_usd"]) || 0,
      duration_ms: row["duration_ms"] != null ? Number(row["duration_ms"]) : null,
      last_event_at: row["last_event_at"] != null ? Number(row["last_event_at"]) : null,
      event_count: Number(row["event_count"]) || 0,
      model_usage: parseJsonSafe(row["model_usage"]) as any,
      first_event_at: row["first_event_at"] != null ? Number(row["first_event_at"]) : null,
      user_message_count: Number(row["user_message_count"]) || 0,
      assistant_message_count: Number(row["assistant_message_count"]) || 0,
      input_tokens: Number(row["input_tokens"]) || 0,
      output_tokens: Number(row["output_tokens"]) || 0,
      reasoning_tokens: Number(row["reasoning_tokens"]) || 0,
      cache_read: Number(row["cache_read"]) || 0,
      cache_write: Number(row["cache_write"]) || 0,
      tool_call_count: Number(row["tool_call_count"]) || 0,
      tool_error_count: Number(row["tool_error_count"]) || 0,
      files_edited: Number(row["files_edited"]) || 0,
      lines_added: Number(row["lines_added"]) || 0,
      lines_deleted: Number(row["lines_deleted"]) || 0,
      primary_agent: row["primary_agent"] as string | null,
      agent_usage: parseJsonSafe(row["agent_usage"]) as any,
      error_count: Number(row["error_count"]) || 0,
    }

    return res.json({ data })
  }
}

function createToolsHandler(db: Database): RouteHandler {
  return (_req: ParsedRequest, res: ResponseHelpers) => {
    const rows = db.query(`
      SELECT
        tool_name,
        COUNT(*) as call_count,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        AVG(duration_ms) as avg_duration_ms,
        SUM(input_tokens + output_tokens + cache_read + cache_write) as total_tokens,
        SUM(cost_usd) as total_cost_usd
      FROM projection_tool_calls
      GROUP BY tool_name
      ORDER BY call_count DESC
    `).all() as Array<Record<string, unknown>>

    const totalCalls = rows.reduce((sum, r) => sum + (Number(r["call_count"]) || 0), 0)
    const totalErrors = rows.reduce((sum, r) => sum + (Number(r["error_count"]) || 0), 0)

    const data: ToolsStatsResponse = {
      tools: rows.map((row) => {
        const callCount = Number(row["call_count"]) || 0
        const errorCount = Number(row["error_count"]) || 0
        return {
          tool_name: String(row["tool_name"]),
          call_count: callCount,
          error_count: errorCount,
          success_rate: callCount > 0 ? (callCount - errorCount) / callCount : 1,
          avg_duration_ms: Number(row["avg_duration_ms"]) || 0,
          total_tokens: Number(row["total_tokens"]) || 0,
          total_cost_usd: Number(row["total_cost_usd"]) || 0,
        }
      }),
      total_calls: totalCalls,
      total_errors: totalErrors,
      success_rate: totalCalls > 0 ? (totalCalls - totalErrors) / totalCalls : 1,
    }

    return res.json({ data })
  }
}

function createModelsHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const { start, end } = parseTimeRange(req.query)

    let sql = `
      SELECT
        model,
        SUM(session_count) as session_count,
        SUM(message_count) as message_count,
        SUM(total_tokens) as total_tokens,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(reasoning_tokens) as reasoning_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        SUM(tool_calls) as tool_call_count,
        SUM(error_count) as error_count
      FROM projection_daily
    `

    const params: string[] = []
    if (start && end) {
      sql += " WHERE date BETWEEN ? AND ?"
      params.push(start, end)
    }

    sql += " GROUP BY model ORDER BY total_cost_usd DESC"

    const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>

    const totalCost = rows.reduce((sum, r) => sum + (Number(r["total_cost_usd"]) || 0), 0)

    const data: ModelsComparisonResponse = {
      models: rows.map((row) => {
        const sessionCount = Number(row["session_count"]) || 0
        const cost = Number(row["total_cost_usd"]) || 0
        return {
          model: String(row["model"]),
          session_count: sessionCount,
          message_count: Number(row["message_count"]) || 0,
          total_tokens: Number(row["total_tokens"]) || 0,
          input_tokens: Number(row["input_tokens"]) || 0,
          output_tokens: Number(row["output_tokens"]) || 0,
          reasoning_tokens: Number(row["reasoning_tokens"]) || 0,
          total_cost_usd: cost,
          avg_cost_per_session: sessionCount > 0 ? cost / sessionCount : 0,
          tool_call_count: Number(row["tool_call_count"]) || 0,
          error_count: Number(row["error_count"]) || 0,
        }
      }),
      total_cost_usd: totalCost,
    }

    return res.json({ data })
  }
}

function createProjectsHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const { start, end } = parseTimeRange(req.query)

    let sql = `
      SELECT
        project_path,
        SUM(session_count) as session_count,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost_usd) as total_cost_usd,
        MAX(projected_at) as last_event_at
      FROM projection_daily
    `

    const params: string[] = []
    if (start && end) {
      sql += " WHERE date BETWEEN ? AND ?"
      params.push(start, end)
    }

    sql += " GROUP BY project_path ORDER BY total_cost_usd DESC"

    const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>

    const totalCost = rows.reduce((sum, r) => sum + (Number(r["total_cost_usd"]) || 0), 0)

    // Get primary model for each project (most used model)
    const primaryModelSql = `
      SELECT project_path, model, SUM(session_count) as cnt
      FROM projection_daily
      GROUP BY project_path, model
    `
    const modelRows = db.query(primaryModelSql).all() as Array<Record<string, unknown>>
    const primaryModels = new Map<string, string>()
    const modelCounts = new Map<string, { model: string; count: number }>()
    for (const row of modelRows) {
      const pp = String(row["project_path"])
      const model = String(row["model"])
      const cnt = Number(row["cnt"]) || 0
      const existing = modelCounts.get(pp)
      if (!existing || cnt > existing.count) {
        modelCounts.set(pp, { model, count: cnt })
        primaryModels.set(pp, model)
      }
    }

    const data: ProjectsStatsResponse = {
      projects: rows.map((row) => ({
        project_path: String(row["project_path"]),
        session_count: Number(row["session_count"]) || 0,
        total_tokens: Number(row["total_tokens"]) || 0,
        total_cost_usd: Number(row["total_cost_usd"]) || 0,
        last_event_at: null,
        primary_model: primaryModels.get(String(row["project_path"])) ?? null,
      })),
      total_cost_usd: totalCost,
    }

    return res.json({ data })
  }
}

function createErrorsHandler(db: Database): RouteHandler {
  return (req: ParsedRequest, res: ResponseHelpers) => {
    const { start, end } = parseTimeRange(req.query)

    let sql = `
      SELECT
        json_extract(event_contents, '$.error_type') as error_type,
        COUNT(*) as count,
        MAX(timestamp_ms) as last_occurrence,
        GROUP_CONCAT(DISTINCT session_id) as session_ids_csv
      FROM events
      WHERE event_type = 'session.error'
    `

    const params: (string | number)[] = []
    if (start && end) {
      sql += " AND timestamp_ms BETWEEN ? AND ?"
      params.push(start, end)
    }

    sql += " GROUP BY error_type ORDER BY count DESC"

    const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>

    const totalErrors = rows.reduce((sum, r) => sum + (Number(r["count"]) || 0), 0)

    const data: ErrorsStatsResponse = {
      errors: rows.map((row) => ({
        error_type: String(row["error_type"] ?? "unknown"),
        count: Number(row["count"]) || 0,
        last_occurrence: Number(row["last_occurrence"]) || 0,
        session_ids: typeof row["session_ids_csv"] === "string"
          ? [...new Set(row["session_ids_csv"].split(","))]
          : [],
      })),
      total_errors: totalErrors,
    }

    return res.json({ data })
  }
}

// ============================================================================
// Route Registrar
// ============================================================================

/**
 * Create a stats route registrar for the given database.
 *
 * Usage:
 *   const router = new APIRouter()
 *   createStatsHandler(db)(router)
 */
export function createStatsHandler(db: Database): RouteRegistrar {
  return (router) => {
    router.get("/api/v1/stats/overview", createOverviewHandler(db))
    router.get("/api/v1/stats/trend", createTrendHandler(db))
    router.get("/api/v1/stats/sessions", createSessionsHandler(db))
    router.get("/api/v1/stats/sessions/:id", createSessionDetailHandler(db))
    router.get("/api/v1/stats/tools", createToolsHandler(db))
    router.get("/api/v1/stats/models", createModelsHandler(db))
    router.get("/api/v1/stats/projects", createProjectsHandler(db))
    router.get("/api/v1/stats/errors", createErrorsHandler(db))
  }
}
