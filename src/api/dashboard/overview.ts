/**
 * Dashboard overview endpoint — GET /api/v1/dashboard/overview
 *
 * Returns aggregated overview data with summary, daily trend, recent sessions,
 * top models, and top tools. Queries `sessions`, `messages`, `tool_calls`, and
 * `events` tables directly; no session aggregate columns are assumed.
 *
 * Design doc: §5.1 (overview page contract).
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardOverviewData,
  DashboardOverviewProjectDistributionItem,
  DashboardOverviewRecentSession,
  DashboardOverviewSummary,
  DashboardOverviewTopModel,
  DashboardOverviewTopTool,
  DashboardOverviewTrendPoint,
} from "@defs/api";
import type { Context } from "hono";
import { queryHeatmap } from "./heatmap";
import {
  getTzOffsetMinutes,
  parseTimeRange,
  parseTimezone,
  safeDivide,
  sqlDailyBucketExprWithOffset,
  toNum,
} from "./helpers";

// ============================================================================
// Internal Aggregation Row Types (private)
// ============================================================================

interface SessionAggRow {
  total_sessions: number;
  active_sessions: number;
  deleted_sessions: number;
  first_event_at_ms: number | null;
  last_event_at_ms: number | null;
}

interface MessageAggRow {
  total_messages: number;
  total_user_messages: number;
  total_assistant_messages: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost_usd: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  total_projects: number;
  total_models: number;
}

interface ToolAggRow {
  total_tool_calls: number;
  total_tool_errors: number;
}

interface ErrorAggRow {
  total_errors: number;
}

// ============================================================================
// Aggregation queries (private)
// ============================================================================

function querySessionAgg(
  db: Database,
  start: number,
  end: number,
): SessionAggRow {
  const row = db
    .query(
      `SELECT
         COUNT(*) as total_sessions,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_sessions,
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted_sessions,
         MIN(first_event_at_ms) as first_event_at_ms,
         MAX(last_event_at_ms) as last_event_at_ms
       FROM sessions
       WHERE last_event_at_ms >= ? AND last_event_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_sessions: toNum(row?.total_sessions),
    active_sessions: toNum(row?.active_sessions),
    deleted_sessions: toNum(row?.deleted_sessions),
    first_event_at_ms:
      row?.first_event_at_ms != null ? Number(row.first_event_at_ms) : null,
    last_event_at_ms:
      row?.last_event_at_ms != null ? Number(row.last_event_at_ms) : null,
  };
}

function queryMessageAgg(
  db: Database,
  start: number,
  end: number,
): MessageAggRow {
  const row = db
    .query(
      `SELECT
         COUNT(*) as total_messages,
         SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as total_user_messages,
         SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as total_assistant_messages,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(reasoning_tokens), 0) as reasoning_tokens,
         COALESCE(SUM(cache_read), 0) as cache_read,
         COALESCE(SUM(cache_write), 0) as cache_write,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(files_changed), 0) as files_changed,
         COALESCE(SUM(lines_added), 0) as lines_added,
         COALESCE(SUM(lines_deleted), 0) as lines_deleted,
         COUNT(DISTINCT project_path) as total_projects,
         COUNT(DISTINCT CASE WHEN model IS NOT NULL THEN model END) as total_models
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_messages: toNum(row?.total_messages),
    total_user_messages: toNum(row?.total_user_messages),
    total_assistant_messages: toNum(row?.total_assistant_messages),
    total_tokens: toNum(row?.total_tokens),
    input_tokens: toNum(row?.input_tokens),
    output_tokens: toNum(row?.output_tokens),
    reasoning_tokens: toNum(row?.reasoning_tokens),
    cache_read: toNum(row?.cache_read),
    cache_write: toNum(row?.cache_write),
    total_cost_usd: toNum(row?.total_cost_usd),
    files_changed: toNum(row?.files_changed),
    lines_added: toNum(row?.lines_added),
    lines_deleted: toNum(row?.lines_deleted),
    total_projects: toNum(row?.total_projects),
    total_models: toNum(row?.total_models),
  };
}

function queryToolAgg(db: Database, start: number, end: number): ToolAggRow {
  const row = db
    .query(
      `SELECT
         COUNT(*) as total_tool_calls,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as total_tool_errors
       FROM tool_calls
       WHERE started_at_ms >= ? AND started_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_tool_calls: toNum(row?.total_tool_calls),
    total_tool_errors: toNum(row?.total_tool_errors),
  };
}

function queryErrorAgg(db: Database, start: number, end: number): ErrorAggRow {
  const row = db
    .query(
      `SELECT COUNT(*) as total_errors
       FROM events
       WHERE event_type = 'session.error'
         AND created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_errors: toNum(row?.total_errors),
  };
}

function queryActiveProjectCount(
  db: Database,
  start: number,
  end: number,
): number {
  const rows = db
    .query(
      `SELECT project_path
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY project_path
       HAVING SUM(total_tokens) > 0 OR SUM(cost_usd) > 0`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  return rows.length;
}

// ============================================================================
// Trend query (private)
// ============================================================================

function queryTrend(
  db: Database,
  start: number,
  end: number,
  offsetMin: number,
): DashboardOverviewTrendPoint[] {
  // Sessions trend — count distinct sessions per day
  const sessionRows = db
    .query(
      `SELECT
         ${sqlDailyBucketExprWithOffset("created_at_ms", offsetMin)} as date,
         COUNT(DISTINCT session_id) as sessions
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  // Messages, tokens, cost trend — from messages table
  const msgRows = db
    .query(
      `SELECT
         ${sqlDailyBucketExprWithOffset("created_at_ms", offsetMin)} as date,
         COUNT(*) as messages,
         COALESCE(SUM(total_tokens), 0) as tokens,
         COALESCE(SUM(cost_usd), 0) as cost_usd
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  // Tool calls trend — from tool_calls table
  const toolRows = db
    .query(
      `SELECT
         ${sqlDailyBucketExprWithOffset("started_at_ms", offsetMin)} as date,
         COUNT(*) as tool_calls
       FROM tool_calls
       WHERE started_at_ms >= ? AND started_at_ms <= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  // Errors trend — from events table
  const errorRows = db
    .query(
      `SELECT
         ${sqlDailyBucketExprWithOffset("created_at_ms", offsetMin)} as date,
         COUNT(*) as errors
       FROM events
       WHERE event_type = 'session.error'
         AND created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  // Build maps for each metric
  const sessionMap = new Map<string, number>();
  for (const row of sessionRows) {
    sessionMap.set(String(row.date), toNum(row.sessions));
  }

  const msgMap = new Map<
    string,
    { messages: number; tokens: number; cost_usd: number }
  >();
  for (const row of msgRows) {
    msgMap.set(String(row.date), {
      messages: toNum(row.messages),
      tokens: toNum(row.tokens),
      cost_usd: toNum(row.cost_usd),
    });
  }

  const toolMap = new Map<string, number>();
  for (const row of toolRows) {
    toolMap.set(String(row.date), toNum(row.tool_calls));
  }

  const errorMap = new Map<string, number>();
  for (const row of errorRows) {
    errorMap.set(String(row.date), toNum(row.errors));
  }

  // Merge all date keys
  const allDates = new Set([
    ...sessionMap.keys(),
    ...msgMap.keys(),
    ...toolMap.keys(),
    ...errorMap.keys(),
  ]);

  return Array.from(allDates)
    .sort()
    .map((date) => {
      const msg = msgMap.get(date);
      return {
        date,
        sessions: sessionMap.get(date) ?? 0,
        messages: msg?.messages ?? 0,
        tokens: msg?.tokens ?? 0,
        cost_usd: msg?.cost_usd ?? 0,
        tool_calls: toolMap.get(date) ?? 0,
        errors: errorMap.get(date) ?? 0,
      };
    });
}

// ============================================================================
// Recent sessions query (private)
// ============================================================================

const RECENT_SESSIONS_LIMIT = 10;

function queryRecentSessions(
  db: Database,
  start: number,
  end: number,
): DashboardOverviewRecentSession[] {
  const rows = db
    .query(
      `SELECT session_id, project_path, title, status, last_event_at_ms
       FROM sessions
       WHERE last_event_at_ms >= ? AND last_event_at_ms <= ?
       ORDER BY last_event_at_ms DESC
       LIMIT ?`,
    )
    .all(start, end, RECENT_SESSIONS_LIMIT) as Array<Record<string, unknown>>;

  if (rows.length === 0) return [];

  const sessionIds = rows.map((r) => String(r.session_id));

  // Aggregate tokens and cost from messages per session
  const placeholders = sessionIds.map(() => "?").join(",");
  const msgAggRows = db
    .query(
      `SELECT session_id, SUM(total_tokens) as total_tokens, SUM(cost_usd) as total_cost_usd
       FROM messages
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const msgMap = new Map<string, { tokens: number; cost: number }>();
  for (const row of msgAggRows) {
    msgMap.set(String(row.session_id), {
      tokens: toNum(row.total_tokens),
      cost: toNum(row.total_cost_usd),
    });
  }

  return rows.map((row) => {
    const sid = String(row.session_id);
    const msg = msgMap.get(sid);
    return {
      session_id: sid,
      project_path: (row.project_path as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      status: (row.status as "active" | "deleted") ?? "active",
      total_tokens: msg?.tokens ?? 0,
      total_cost_usd: msg?.cost ?? 0,
      last_event_at_ms:
        row.last_event_at_ms != null ? Number(row.last_event_at_ms) : null,
    };
  });
}

// ============================================================================
// Top models query (private)
// ============================================================================

const TOP_MODELS_LIMIT = 5;

function queryTopModels(
  db: Database,
  start: number,
  end: number,
): DashboardOverviewTopModel[] {
  const rows = db
    .query(
      `SELECT
         model,
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(cost_usd), 0) as cost_usd,
         COUNT(*) as message_count
       FROM messages
       WHERE model IS NOT NULL
         AND role = 'assistant'
         AND created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY model
       ORDER BY cost_usd DESC
       LIMIT ?`,
    )
    .all(start, end, TOP_MODELS_LIMIT) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    model: String(row.model),
    total_tokens: toNum(row.total_tokens),
    cost_usd: toNum(row.cost_usd),
    message_count: toNum(row.message_count),
  }));
}

// ============================================================================
// Model message distribution query (private)
// ============================================================================

function queryModelMessageDistribution(
  db: Database,
  start: number,
  end: number,
): Array<{ model: string; message_count: number; percentage: number }> {
  const rows = db
    .query(
      `SELECT
         model,
         COUNT(*) as message_count
       FROM messages
       WHERE role = 'assistant'
         AND model IS NOT NULL
         AND created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY model
       ORDER BY message_count DESC`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  const total = rows.reduce((sum, row) => sum + toNum(row.message_count), 0);

  return rows.map((row) => {
    const count = toNum(row.message_count);
    return {
      model: String(row.model),
      message_count: count,
      percentage: total > 0 ? (count / total) * 100 : 0,
    };
  });
}

// ============================================================================
// Top tools query (private)
// ============================================================================

const TOP_TOOLS_LIMIT = 5;

function queryTopTools(
  db: Database,
  start: number,
  end: number,
): DashboardOverviewTopTool[] {
  const rows = db
    .query(
      `SELECT
         tool_name,
         COUNT(*) as call_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
         AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration_ms
       FROM tool_calls
       WHERE started_at_ms >= ? AND started_at_ms <= ?
       GROUP BY tool_name
       ORDER BY call_count DESC
       LIMIT ?`,
    )
    .all(start, end, TOP_TOOLS_LIMIT) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    tool_name: String(row.tool_name),
    call_count: toNum(row.call_count),
    error_count: toNum(row.error_count),
    avg_duration_ms:
      row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
  }));
}

// ============================================================================
// Summary builder (private)
// ============================================================================

function buildSummary(
  sessionAgg: SessionAggRow,
  msgAgg: MessageAggRow,
  toolAgg: ToolAggRow,
  errorAgg: ErrorAggRow,
  activeProjectCount: number,
): DashboardOverviewSummary {
  return {
    total_sessions: sessionAgg.total_sessions,
    active_sessions: sessionAgg.active_sessions,
    deleted_sessions: sessionAgg.deleted_sessions,
    total_messages: msgAgg.total_messages,
    total_user_messages: msgAgg.total_user_messages,
    total_assistant_messages: msgAgg.total_assistant_messages,
    total_tokens: msgAgg.total_tokens,
    input_tokens: msgAgg.input_tokens,
    output_tokens: msgAgg.output_tokens,
    reasoning_tokens: msgAgg.reasoning_tokens,
    cache_read: msgAgg.cache_read,
    cache_write: msgAgg.cache_write,
    total_cost_usd: msgAgg.total_cost_usd,
    total_tool_calls: toolAgg.total_tool_calls,
    total_tool_errors: toolAgg.total_tool_errors,
    total_errors: errorAgg.total_errors,
    files_changed: msgAgg.files_changed,
    lines_added: msgAgg.lines_added,
    lines_deleted: msgAgg.lines_deleted,
    total_projects: msgAgg.total_projects,
    total_models: msgAgg.total_models,
    avg_tokens_per_session: safeDivide(
      msgAgg.total_tokens,
      sessionAgg.total_sessions,
    ),
    avg_cost_per_session: safeDivide(
      msgAgg.total_cost_usd,
      sessionAgg.total_sessions,
    ),
    avg_messages_per_session: safeDivide(
      msgAgg.total_messages,
      sessionAgg.total_sessions,
    ),
    avg_project_tokens: safeDivide(msgAgg.total_tokens, activeProjectCount),
    avg_project_cost: safeDivide(msgAgg.total_cost_usd, activeProjectCount),
    avg_project_messages: safeDivide(msgAgg.total_messages, activeProjectCount),
    first_event_at_ms: sessionAgg.first_event_at_ms,
    last_event_at_ms: sessionAgg.last_event_at_ms,
  };
}

// ============================================================================
// Project distribution query (private)
// ============================================================================

function queryProjectDistribution(
  db: Database,
  start: number,
  end: number,
): DashboardOverviewProjectDistributionItem[] {
  const rows = db
    .query(
      `SELECT
         project_path,
         COUNT(DISTINCT session_id) as session_count,
         COALESCE(SUM(cost_usd), 0) as cost_usd
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY project_path
       ORDER BY cost_usd DESC`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    project_path: (row.project_path as string | null) ?? null,
    session_count: toNum(row.session_count),
    cost_usd: toNum(row.cost_usd),
  }));
}

// ============================================================================
// Handler factory (exported)
// ============================================================================

/**
 * Create a Hono handler for GET /api/v1/dashboard/overview.
 *
 * Returns a function that accepts a Hono Context and returns a JSON response
 * matching `DashboardDataResponse<DashboardOverviewData>`.
 *
 * The handler:
 *  - Parses & validates start/end time range via parseTimeRange helper.
 *  - Aggregates summary stats from sessions, messages, tool_calls, events.
 *  - Computes daily trend points by merging per-date aggregations.
 *  - Fetches recent sessions with per-session token/cost from messages.
 *  - Determines top models from messages and top tools from tool_calls.
 *  - Returns zero values and empty arrays for an empty database.
 *  - Returns `first_event_at_ms` and `last_event_at_ms` as null when no data.
 *
 * Route registration is NOT performed here; the caller mounts this handler.
 *
 * @param db - Bun SQLite database instance.
 */
export function createOverviewDashboardHandler(db: Database) {
  return (c: Context) => {
    // 1. Parse & validate time range
    const timeRange = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!timeRange.ok) {
      return c.json({ error: timeRange.error }, 400);
    }

    const timezone = parseTimezone(c.req.query("tz"));
    if (!timezone.ok) {
      return c.json({ error: timezone.error }, 400);
    }

    const { start, end } = timeRange;
    const now = Date.now();
    const offsetMin = getTzOffsetMinutes(timezone.tz, now);

    // 2. Query aggregations from real tables
    const sessionAgg = querySessionAgg(db, start, end);
    const msgAgg = queryMessageAgg(db, start, end);
    const toolAgg = queryToolAgg(db, start, end);
    const errorAgg = queryErrorAgg(db, start, end);
    const activeProjectCount = queryActiveProjectCount(db, start, end);

    // 3. Build summary
    const summary = buildSummary(
      sessionAgg,
      msgAgg,
      toolAgg,
      errorAgg,
      activeProjectCount,
    );

    // 4. Query daily trend and heatmap
    const trend = queryTrend(db, start, end, offsetMin);
    const heatmap = queryHeatmap(db, start, end, offsetMin);

    // 5. Query recent sessions
    const recentSessions = queryRecentSessions(db, start, end);

    // 6. Query top models and tools
    const topModels = queryTopModels(db, start, end);
    const topTools = queryTopTools(db, start, end);

    // 7. Query model message distribution
    const modelMessageDistribution = queryModelMessageDistribution(
      db,
      start,
      end,
    );

    // 8. Query project distribution
    const projectDistribution = queryProjectDistribution(db, start, end);

    // 9. Assemble and return
    const data: DashboardOverviewData = {
      summary,
      trend,
      heatmap,
      recent_sessions: recentSessions,
      top_models: topModels,
      top_tools: topTools,
      model_message_distribution: modelMessageDistribution,
      project_distribution: projectDistribution,
    };

    return c.json({ data });
  };
}
