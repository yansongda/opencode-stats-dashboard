/**
 * Dashboard session detail handler — GET /api/v1/dashboard/sessions/:id
 *
 * Returns the full detail view for a single session, including:
 *   - session summary (aggregated from messages/tool_calls/events)
 *   - messages metadata timeline (no bodies or sensitive payloads)
 *   - model_usage (aggregated from messages, grouped by model)
 *   - tool_calls (from tool_calls table)
 *   - errors (from events, tool_calls, and messages)
 *
 * Design doc: §7 (session detail contract).
 */

import type { Database } from "bun:sqlite";
import { parseTimezone, toNum } from "@api/dashboard/helpers";
import type {
  DashboardDataResponse,
  DashboardSessionDetailData,
  DashboardSessionDetailSummary,
  DashboardSessionError,
  DashboardSessionMessageMetadata,
  DashboardSessionModelUsage,
  DashboardSessionToolCall,
} from "@defs/api";
import type { Context } from "hono";
import { queryPrimaryModelForSession } from "./components/primary-model";

// ============================================================================
// Internal query result types (private)
// ============================================================================

interface MessageRow {
  message_id: string;
  role: string;
  model: string | null;
  total_tokens: number;
  cost_usd: number;
  files_changed: number;
  duration_ms: number | null;
  has_error: number;
  error_type: string | null;
}

interface ToolCallRow {
  call_id: string;
  tool_name: string;
  status: string | null;
  title: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

interface ModelUsageRow {
  model: string;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

// ============================================================================
// Query helpers (private)
// ============================================================================

function querySession(
  db: Database,
  sessionId: string,
): Record<string, unknown> | null {
  return db
    .query(
      `SELECT session_id, project_path, title, status,
              first_event_at_ms, last_event_at_ms, duration_ms
       FROM sessions
       WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | null;
}

function queryMessageAggregates(
  db: Database,
  sessionId: string,
): {
  message_count: number;
  user_message_count: number;
  assistant_message_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_read: number;
  cache_write: number;
  total_cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
} {
  const row = db
    .query(
      `SELECT
         COUNT(*) as message_count,
         SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as user_message_count,
         SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) as assistant_message_count,
         SUM(total_tokens) as total_tokens,
         SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens,
         SUM(reasoning_tokens) as reasoning_tokens,
         SUM(cache_read) as cache_read,
         SUM(cache_write) as cache_write,
         SUM(cost_usd) as total_cost_usd,
         SUM(lines_added) as lines_added,
         SUM(lines_deleted) as lines_deleted,
         SUM(files_changed) as files_changed
       FROM messages
       WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | null;

  return {
    message_count: toNum(row?.message_count),
    user_message_count: toNum(row?.user_message_count),
    assistant_message_count: toNum(row?.assistant_message_count),
    total_tokens: toNum(row?.total_tokens),
    input_tokens: toNum(row?.input_tokens),
    output_tokens: toNum(row?.output_tokens),
    reasoning_tokens: toNum(row?.reasoning_tokens),
    cache_read: toNum(row?.cache_read),
    cache_write: toNum(row?.cache_write),
    total_cost_usd: toNum(row?.total_cost_usd),
    lines_added: toNum(row?.lines_added),
    lines_deleted: toNum(row?.lines_deleted),
    files_changed: toNum(row?.files_changed),
  };
}

function queryToolAggregates(
  db: Database,
  sessionId: string,
): { tool_call_count: number; tool_error_count: number } {
  const row = db
    .query(
      `SELECT
         COUNT(*) as tool_call_count,
         SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as tool_error_count
       FROM tool_calls
       WHERE session_id = ?`,
    )
    .get(sessionId) as Record<string, unknown> | null;

  return {
    tool_call_count: toNum(row?.tool_call_count),
    tool_error_count: toNum(row?.tool_error_count),
  };
}

function queryErrorCount(db: Database, sessionId: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) as error_count
       FROM events
       WHERE session_id = ? AND event_type = 'session.error'`,
    )
    .get(sessionId) as Record<string, unknown> | null;

  return toNum(row?.error_count);
}

function queryMessages(
  db: Database,
  sessionId: string,
): DashboardSessionMessageMetadata[] {
  const rows = db
    .query(
      `SELECT
         message_id, role, model,
         total_tokens, cost_usd,
         files_changed, duration_ms,
         has_error, error_type
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at_ms ASC`,
    )
    .all(sessionId) as MessageRow[];

  return rows.map(
    (r): DashboardSessionMessageMetadata => ({
      message_id: r.message_id,
      role: r.role as "user" | "assistant",
      model: r.model ?? null,
      total_tokens: toNum(r.total_tokens),
      cost_usd: toNum(r.cost_usd),
      files_changed: toNum(r.files_changed),
      duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
      has_error: toNum(r.has_error),
      error_type: r.error_type ?? null,
    }),
  );
}

function queryModelUsage(
  db: Database,
  sessionId: string,
): DashboardSessionModelUsage[] {
  const rows = db
    .query(
      `SELECT
         model,
         COUNT(*) as message_count,
         SUM(input_tokens) as input_tokens,
         SUM(output_tokens) as output_tokens,
         SUM(reasoning_tokens) as reasoning_tokens,
         SUM(total_tokens) as total_tokens,
         SUM(cost_usd) as cost_usd
       FROM messages
       WHERE session_id = ? AND model IS NOT NULL AND model != ''
       GROUP BY model
       ORDER BY cost_usd DESC`,
    )
    .all(sessionId) as ModelUsageRow[];

  return rows.map(
    (r): DashboardSessionModelUsage => ({
      model: r.model,
      message_count: toNum(r.message_count),
      input_tokens: toNum(r.input_tokens),
      output_tokens: toNum(r.output_tokens),
      reasoning_tokens: toNum(r.reasoning_tokens),
      total_tokens: toNum(r.total_tokens),
      cost_usd: toNum(r.cost_usd),
    }),
  );
}

function queryToolCalls(
  db: Database,
  sessionId: string,
): DashboardSessionToolCall[] {
  const rows = db
    .query(
      `SELECT
         call_id, tool_name, status, title, error_message,
         duration_ms
       FROM tool_calls
       WHERE session_id = ?
       ORDER BY started_at_ms ASC`,
    )
    .all(sessionId) as ToolCallRow[];

  return rows.map(
    (r): DashboardSessionToolCall => ({
      call_id: r.call_id,
      tool_name: r.tool_name,
      status: r.status ?? null,
      title: r.title ?? null,
      error_message: r.error_message ?? null,
      duration_ms: r.duration_ms != null ? Number(r.duration_ms) : null,
    }),
  );
}

function queryErrors(db: Database, sessionId: string): DashboardSessionError[] {
  const errors: DashboardSessionError[] = [];

  // 1. Error events from events table (session.error events)
  const sessionErrors = db
    .query(
      `SELECT event_id, event_type, created_at_ms, event_contents
       FROM events
       WHERE session_id = ? AND event_type = 'session.error'`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  const fallbackMessage = "Session error";

  for (const row of sessionErrors) {
    let message = fallbackMessage;

    try {
      const parsed = JSON.parse(String(row.event_contents || "{}")) as {
        error_type?: string;
        error_message?: string;
      };
      const trimmed = parsed.error_message?.trim();
      message = trimmed || parsed.error_type || fallbackMessage;
    } catch {
      // event_contents is invalid JSON — keep fallback
    }

    errors.push({
      event_id: String(row.event_id),
      event_type: String(row.event_type),
      created_at_ms: toNum(row.created_at_ms),
      message,
    });
  }

  // 2. Tool call errors from tool_calls table
  const toolErrors = db
    .query(
      `SELECT call_id, tool_name, error_message, completed_at_ms, started_at_ms
       FROM tool_calls
       WHERE session_id = ? AND status = 'error'`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  for (const row of toolErrors) {
    errors.push({
      event_id: String(row.call_id),
      event_type: `tool.error:${String(row.tool_name)}`,
      created_at_ms: toNum(row.completed_at_ms ?? row.started_at_ms),
      message:
        row.error_message != null ? String(row.error_message) : "Tool error",
    });
  }

  // 3. Message errors from messages table
  const messageErrors = db
    .query(
      `SELECT message_id, event_id, error_type, created_at_ms
       FROM messages
       WHERE session_id = ? AND has_error = 1`,
    )
    .all(sessionId) as Array<Record<string, unknown>>;

  for (const row of messageErrors) {
    errors.push({
      event_id: String(row.event_id),
      event_type: `message.error:${row.error_type != null ? String(row.error_type) : "unknown"}`,
      created_at_ms: toNum(row.created_at_ms),
      message: `Message error: ${row.error_type != null ? String(row.error_type) : "unknown"}`,
    });
  }

  errors.sort((a, b) => a.created_at_ms - b.created_at_ms);

  return errors;
}

// ============================================================================
// Summary builder (private)
// ============================================================================

function buildSummary(
  session: Record<string, unknown>,
  msgAgg: ReturnType<typeof queryMessageAggregates>,
  primaryModel: string | null,
  toolAgg: ReturnType<typeof queryToolAggregates>,
  errCount: number,
): DashboardSessionDetailSummary {
  return {
    session_id: String(session.session_id),
    project_path: (session.project_path as string | null) ?? null,
    title: (session.title as string | null) ?? null,
    status: (session.status as "active" | "deleted") ?? "active",
    message_count: msgAgg.message_count,
    user_message_count: msgAgg.user_message_count,
    assistant_message_count: msgAgg.assistant_message_count,
    total_tokens: msgAgg.total_tokens,
    input_tokens: msgAgg.input_tokens,
    output_tokens: msgAgg.output_tokens,
    reasoning_tokens: msgAgg.reasoning_tokens,
    cache_read: msgAgg.cache_read,
    cache_write: msgAgg.cache_write,
    total_cost_usd: msgAgg.total_cost_usd,
    tool_call_count: toolAgg.tool_call_count,
    tool_error_count: toolAgg.tool_error_count,
    error_count: errCount,
    files_changed: msgAgg.files_changed,
    lines_added: msgAgg.lines_added,
    lines_deleted: msgAgg.lines_deleted,
    primary_model: primaryModel,
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

export function createDashboardSessionDetailHandler(
  db: Database,
): (c: Context) => Response {
  return (c: Context) => {
    const id = c.req.param("id");
    if (id === undefined || id === "") {
      return c.json({ error: "Missing session id" }, 400);
    }

    const timezone = parseTimezone(c.req.query("tz"));
    if (!timezone.ok) {
      return c.json({ error: timezone.error }, 400);
    }

    const session = querySession(db, id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    const msgAgg = queryMessageAggregates(db, id);
    const primaryModel = queryPrimaryModelForSession(db, id);
    const toolAgg = queryToolAggregates(db, id);
    const errCount = queryErrorCount(db, id);

    const data: DashboardSessionDetailData = {
      session: buildSummary(session, msgAgg, primaryModel, toolAgg, errCount),
      messages: queryMessages(db, id),
      model_usage: queryModelUsage(db, id),
      tool_calls: queryToolCalls(db, id),
      errors: queryErrors(db, id),
    };

    const response: DashboardDataResponse<DashboardSessionDetailData> = {
      data,
    };

    return c.json(response);
  };
}
