/**
 * Dashboard sessions list handler — GET /api/v1/dashboard/sessions
 *
 * Aggregates session-level stats from sessions, messages, tool_calls,
 * and events tables. Never selects aggregate columns from sessions directly.
 *
 * Query parameters:
 *   start, end         — time range (ms timestamps, optional)
 *   status             — filter by session status (active|deleted)
 *   project_path       — filter by project path
 *   limit, offset      — pagination (clamped by helpers)
 *   sort, order        — sort field & direction (validated against allow-list)
 *
 * Response: DashboardListResponse<DashboardSessionListItem>
 *
 * Design doc: §3 (helpers), §6 (sessions list contract).
 */

import type { Database } from "bun:sqlite";
import {
  buildWhereConditions,
  parseOptionalString,
  parsePagination,
  parseSortOrder,
  parseTimeRange,
  parseTimezone,
  toNum,
} from "@api/dashboard/helpers";
import type {
  DashboardListResponse,
  DashboardSessionListItem,
} from "@defs/api";
import type { Context } from "hono";

// ============================================================================
// Sort field mapping
// ============================================================================

/**
 * Map sort field names that reference aggregated values (not in sessions
 * table) to their SQL equivalents in the message aggregation subquery,
 * or mark them as client-side only.
 *
 * Direct session columns (session_id, project_path, title,
 * first_event_at_ms, last_event_at_ms, duration_ms) pass through unchanged.
 */
const AGGREGATE_SORT_FIELDS = new Set([
  "total_tokens",
  "total_cost_usd",
  "message_count",
  "tool_call_count",
  "error_count",
]);

// ============================================================================
// Aggregation row types (private)
// ============================================================================

interface MessageAggRow {
  session_id: string;
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
  primary_model: string | null;
  model_count: number;
}

interface ToolAggRow {
  session_id: string;
  tool_call_count: number;
  tool_error_count: number;
}

interface ErrorAggRow {
  session_id: string;
  error_count: number;
}

// ============================================================================
// Aggregation queries (private)
// ============================================================================

function queryMessageAggregates(
  db: Database,
  sessionIds: string[],
): Map<string, MessageAggRow> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         session_id,
         COUNT(*) as message_count,
         SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_message_count,
         SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistant_message_count,
         SUM(total_tokens) as total_tokens,
         SUM(cost_usd) as total_cost_usd,
         SUM(lines_added) as lines_added,
         SUM(lines_deleted) as lines_deleted,
         SUM(files_changed) as files_changed
       FROM messages
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const map = new Map<string, MessageAggRow>();
  for (const row of rows) {
    map.set(String(row.session_id), {
      session_id: String(row.session_id),
      message_count: toNum(row.message_count),
      user_message_count: toNum(row.user_message_count),
      assistant_message_count: toNum(row.assistant_message_count),
      total_tokens: toNum(row.total_tokens),
      total_cost_usd: toNum(row.total_cost_usd),
      lines_added: toNum(row.lines_added),
      lines_deleted: toNum(row.lines_deleted),
      files_changed: toNum(row.files_changed),
      primary_model: null,
      model_count: 0,
    });
  }
  return map;
}

function queryPrimaryModels(
  db: Database,
  sessionIds: string[],
): Map<string, { primary_model: string | null; model_count: number }> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         t.session_id,
         t.model,
         t.model_tokens,
         c.model_count
       FROM (
         SELECT session_id, model, SUM(total_tokens) as model_tokens
         FROM messages
         WHERE session_id IN (${placeholders}) AND model IS NOT NULL AND model != ''
         GROUP BY session_id, model
       ) t
       JOIN (
         SELECT session_id, COUNT(DISTINCT model) as model_count
         FROM messages
         WHERE session_id IN (${placeholders}) AND model IS NOT NULL AND model != ''
         GROUP BY session_id
       ) c ON t.session_id = c.session_id
       ORDER BY t.session_id, t.model_tokens DESC`,
    )
    .all(...sessionIds, ...sessionIds) as Array<Record<string, unknown>>;

  const primaryMap = new Map<string, string>();
  const countMap = new Map<string, number>();
  for (const row of rows) {
    const sid = String(row.session_id);
    if (!primaryMap.has(sid)) {
      primaryMap.set(sid, String(row.model));
    }
    countMap.set(sid, toNum(row.model_count));
  }

  const result = new Map<
    string,
    { primary_model: string | null; model_count: number }
  >();
  for (const sid of sessionIds) {
    result.set(sid, {
      primary_model: primaryMap.get(sid) ?? null,
      model_count: countMap.get(sid) ?? 0,
    });
  }
  return result;
}

function queryToolAggregates(
  db: Database,
  sessionIds: string[],
): Map<string, ToolAggRow> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         session_id,
         COUNT(*) as tool_call_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as tool_error_count
       FROM tool_calls
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const map = new Map<string, ToolAggRow>();
  for (const row of rows) {
    map.set(String(row.session_id), {
      session_id: String(row.session_id),
      tool_call_count: toNum(row.tool_call_count),
      tool_error_count: toNum(row.tool_error_count),
    });
  }
  return map;
}

function queryErrorAggregates(
  db: Database,
  sessionIds: string[],
): Map<string, ErrorAggRow> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         session_id,
         COUNT(*) as error_count
       FROM events
       WHERE session_id IN (${placeholders}) AND event_type = 'session.error'
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const map = new Map<string, ErrorAggRow>();
  for (const row of rows) {
    map.set(String(row.session_id), {
      session_id: String(row.session_id),
      error_count: toNum(row.error_count),
    });
  }
  return map;
}

// ============================================================================
// Response builder (private)
// ============================================================================

function buildSessionListItem(
  session: Record<string, unknown>,
  msgAgg: Map<string, MessageAggRow>,
  modelInfo: Map<string, { primary_model: string | null; model_count: number }>,
  toolAgg: Map<string, ToolAggRow>,
  errAgg: Map<string, ErrorAggRow>,
): DashboardSessionListItem {
  const sid = String(session.session_id);
  const msg = msgAgg.get(sid);
  const model = modelInfo.get(sid);
  const tools = toolAgg.get(sid);
  const errors = errAgg.get(sid);

  return {
    session_id: sid,
    project_path: (session.project_path as string | null) ?? null,
    title: (session.title as string | null) ?? null,
    status: (session.status as "active" | "deleted") ?? "active",
    message_count: msg?.message_count ?? 0,
    user_message_count: msg?.user_message_count ?? 0,
    assistant_message_count: msg?.assistant_message_count ?? 0,
    total_tokens: msg?.total_tokens ?? 0,
    total_cost_usd: msg?.total_cost_usd ?? 0,
    tool_call_count: tools?.tool_call_count ?? 0,
    tool_error_count: tools?.tool_error_count ?? 0,
    error_count: errors?.error_count ?? 0,
    files_changed: msg?.files_changed ?? 0,
    lines_added: msg?.lines_added ?? 0,
    lines_deleted: msg?.lines_deleted ?? 0,
    primary_model: model?.primary_model ?? null,
    model_count: model?.model_count ?? 0,
    first_event_at_ms:
      session.first_event_at_ms != null
        ? Number(session.first_event_at_ms)
        : null,
    last_event_at_ms:
      session.last_event_at_ms != null
        ? Number(session.last_event_at_ms)
        : null,
    duration_ms:
      session.duration_ms != null ? Number(session.duration_ms) : null,
  };
}

// ============================================================================
// Exported handler factory
// ============================================================================

/**
 * Create a Hono handler for GET /api/v1/dashboard/sessions.
 *
 * Returns a function that accepts a Hono Context and returns a JSON response
 * matching `DashboardListResponse<DashboardSessionListItem>`.
 *
 * The handler:
 *  - Parses & validates all query parameters via helpers.
 *  - Builds a parameterized WHERE clause (no SQL injection).
 *  - Counts total matching sessions separately from paginated data.
 *  - Aggregates stats from messages, tool_calls, and events tables.
 *  - Derives primary_model from messages, never from sessions.
 *  - Validates sort field against allow-list; unknown fields fall back to
 *    page default.
 *
 * @param db - Bun SQLite database instance.
 */
export function createDashboardSessionsHandler(
  db: Database,
): (c: Context) => Response {
  return (c: Context) => {
    // -- Parse query parameters -----------------------------------------------
    const timeRange = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!timeRange.ok) {
      return c.json({ error: timeRange.error }, 400);
    }

    // Validate tz for API consistency — sessions endpoint does not bucket by
    // date/time, but the frontend sends tz uniformly to all dashboard routes.
    const timezone = parseTimezone(c.req.query("tz"));
    if (!timezone.ok) {
      return c.json({ error: timezone.error }, 400);
    }

    const pagination = parsePagination(
      c.req.query("limit"),
      c.req.query("offset"),
    );

    const sort = parseSortOrder(
      "sessions",
      c.req.query("sort"),
      c.req.query("order"),
    );

    const status = parseOptionalString(c.req.query("status"));
    const projectPath = parseOptionalString(c.req.query("project_path"));

    // -- Build WHERE clause ---------------------------------------------------
    const { clause: whereClause, params: whereParams } = buildWhereConditions([
      ["last_event_at_ms >= ?", timeRange.start],
      ["last_event_at_ms <= ?", timeRange.end],
      ["status = ?", status],
      ["project_path = ?", projectPath],
    ]);

    const baseWhere = `WHERE 1=1${whereClause}`;

    // -- Count total matching sessions ----------------------------------------
    const countRow = db
      .query(`SELECT COUNT(*) as total FROM sessions ${baseWhere}`)
      .get(...whereParams) as { total: number } | null;
    const total = countRow?.total ?? 0;

    // -- Fetch paginated session rows -----------------------------------------
    const isDirectSort = !AGGREGATE_SORT_FIELDS.has(sort.field);
    const orderClause = isDirectSort
      ? `ORDER BY ${sort.field} ${sort.order}`
      : "ORDER BY last_event_at_ms DESC";

    const rows = db
      .query(
        `SELECT session_id, project_path, title, status,
                first_event_at_ms, last_event_at_ms, duration_ms
         FROM sessions
         ${baseWhere}
         ${orderClause}
         LIMIT ? OFFSET ?`,
      )
      .all(...whereParams, pagination.limit, pagination.offset) as Array<
      Record<string, unknown>
    >;

    // -- Aggregate from related tables ----------------------------------------
    const sessionIds = rows.map((r) => String(r.session_id));

    const msgAgg = queryMessageAggregates(db, sessionIds);
    const modelInfo = queryPrimaryModels(db, sessionIds);
    const toolAgg = queryToolAggregates(db, sessionIds);
    const errAgg = queryErrorAggregates(db, sessionIds);

    // -- Build response items -------------------------------------------------
    let items: DashboardSessionListItem[] = rows.map((row) =>
      buildSessionListItem(row, msgAgg, modelInfo, toolAgg, errAgg),
    );

    // -- Client-side sort for aggregate fields --------------------------------
    if (AGGREGATE_SORT_FIELDS.has(sort.field)) {
      items = items.toSorted((a, b) => {
        const aVal = a[sort.field as keyof DashboardSessionListItem];
        const bVal = b[sort.field as keyof DashboardSessionListItem];
        const aNum = typeof aVal === "number" ? aVal : 0;
        const bNum = typeof bVal === "number" ? bVal : 0;
        return sort.order === "asc" ? aNum - bNum : bNum - aNum;
      });
    }

    // -- Return response ------------------------------------------------------
    const response: DashboardListResponse<DashboardSessionListItem> = {
      data: items,
      meta: {
        total,
        limit: pagination.limit,
        offset: pagination.offset,
      },
    };

    return c.json(response);
  };
}
