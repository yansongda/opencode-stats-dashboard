/**
 * Dashboard tools handler — GET /api/v1/dashboard/tools
 *
 * Returns { data: DashboardToolsData } with:
 *   - summary: aggregate counts, error rate, avg duration, superlative tools
 *   - tools: per-tool breakdown with completed/failed/running counts
 *   - timeline: daily × tool_name call/failed/avg_duration buckets
 *   - recent_errors: latest error rows with metadata only (no input/output)
 *
 * Duration semantics: SQLite AVG/MIN/MAX ignore NULLs, so running calls
 * (duration_ms = NULL) do not pollute duration metrics.  The summary's
 * avg_duration_ms is computed as a single DB-level aggregate for accuracy.
 *
 * Design doc: §5 (tools page API).
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardDataResponse,
  DashboardToolItem,
  DashboardToolRecentError,
  DashboardToolsData,
  DashboardToolsSummary,
  DashboardToolTimelinePoint,
} from "@defs/api";
import type { Context } from "hono";
import {
  getTzOffsetMinutes,
  parseSortOrder,
  parseTimeRange,
  parseTimezone,
  safeRate,
  sqlDailyBucketExprWithOffset,
  toNum,
} from "./helpers";

// ============================================================================
// Internal Row Shapes (raw DB results)
// ============================================================================

interface ToolAggRow {
  tool_name: string;
  call_count: number;
  completed_count: number;
  error_count: number;
  running_count: number;
  avg_duration_ms: number | null;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  first_used_at_ms: number | null;
  last_used_at_ms: number | null;
}

interface TimelineRow {
  date: string;
  tool_name: string;
  call_count: number;
  failed_count: number;
  avg_duration_ms: number | null;
}

interface ErrorRow {
  call_id: string;
  session_id: string;
  tool_name: string;
  error_message: string | null;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  duration_ms: number | null;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create the handler for GET /api/v1/dashboard/tools.
 *
 * Query parameters:
 *   - start   (optional) — millisecond timestamp lower bound
 *   - end     (optional) — millisecond timestamp upper bound
 *   - sort    (optional) — sort field: call_count | error_count | avg_duration_ms | tool_name
 *   - order   (optional) — asc | desc (default: desc)
 *   - limit   (optional) — max recent error rows to return (default: 20, max: 100)
 *
 * Route registration is handled externally (Task 13).
 */
export function createDashboardToolsHandler(
  db: Database,
): (c: Context) => Response {
  return (c: Context) => {
    // ── Parse & validate query params ────────────────────────────────
    const rangeResult = parseTimeRange(
      c.req.query("start"),
      c.req.query("end"),
    );
    if (!rangeResult.ok) {
      return c.json({ error: rangeResult.error }, 400);
    }
    const { start, end } = rangeResult;

    const { field: sortField, order: sortOrder } = parseSortOrder(
      "tools",
      c.req.query("sort"),
      c.req.query("order"),
    );

    // Clamp recent-errors limit
    const rawLimit = c.req.query("limit");
    const recentErrorLimit = rawLimit
      ? Math.min(Math.max(1, Math.floor(Number(rawLimit) || 20)), 100)
      : 20;

    // ── Parse timezone ─────────────────────────────────────────────
    const tzResult = parseTimezone(c.req.query("tz"));
    if (!tzResult.ok) {
      return c.json({ error: tzResult.error }, 400);
    }
    const offsetMin = getTzOffsetMinutes(tzResult.tz);

    // ── 1. Per-tool aggregation ──────────────────────────────────────
    const toolRows = db
      .query(
        `SELECT
           tool_name,
           COUNT(*)                                          AS call_count,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE WHEN status = 'error'     THEN 1 ELSE 0 END) AS error_count,
           SUM(CASE WHEN status = 'running'   THEN 1 ELSE 0 END) AS running_count,
           AVG(duration_ms)                                  AS avg_duration_ms,
           MIN(duration_ms)                                  AS min_duration_ms,
           MAX(duration_ms)                                  AS max_duration_ms,
           MIN(started_at_ms)                                AS first_used_at_ms,
           MAX(started_at_ms)                                AS last_used_at_ms
         FROM tool_calls
         WHERE started_at_ms >= ? AND started_at_ms <= ?
         GROUP BY tool_name
         ORDER BY ${sortField} ${sortOrder}`,
      )
      .all(start, end) as unknown as ToolAggRow[];

    const tools: DashboardToolItem[] = toolRows.map((row) => {
      const callCount = toNum(row.call_count);
      const failedCount = toNum(row.error_count);
      return {
        tool_name: row.tool_name,
        call_count: callCount,
        completed_count: toNum(row.completed_count),
        failed_count: failedCount,
        running_count: toNum(row.running_count),
        error_rate: safeRate(failedCount, callCount),
        avg_duration_ms:
          row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
        min_duration_ms:
          row.min_duration_ms != null ? Number(row.min_duration_ms) : null,
        max_duration_ms:
          row.max_duration_ms != null ? Number(row.max_duration_ms) : null,
        first_used_at_ms:
          row.first_used_at_ms != null ? Number(row.first_used_at_ms) : null,
        last_used_at_ms:
          row.last_used_at_ms != null ? Number(row.last_used_at_ms) : null,
      };
    });

    // ── 2. Summary ───────────────────────────────────────────────────
    const totalToolCalls = tools.reduce((s, t) => s + t.call_count, 0);
    const completedToolCalls = tools.reduce((s, t) => s + t.completed_count, 0);
    const failedToolCalls = tools.reduce((s, t) => s + t.failed_count, 0);
    const runningToolCalls = tools.reduce((s, t) => s + t.running_count, 0);

    // Overall avg duration from DB (single aggregate, not average-of-averages)
    const durationAgg = db
      .query(
        `SELECT AVG(duration_ms) AS avg_ms
         FROM tool_calls
         WHERE started_at_ms >= ? AND started_at_ms <= ?`,
      )
      .get(start, end) as Record<string, unknown> | null;

    const mostUsedTool =
      tools.length > 0
        ? tools.reduce((a, b) => (a.call_count >= b.call_count ? a : b))
            .tool_name
        : null;

    const slowestTool =
      tools
        .filter((t) => t.avg_duration_ms != null)
        .sort((a, b) => (b.avg_duration_ms ?? 0) - (a.avg_duration_ms ?? 0))[0]
        ?.tool_name ?? null;

    const mostErrorProneTool =
      tools
        .filter((t) => t.failed_count > 0)
        .sort((a, b) => b.failed_count - a.failed_count)[0]?.tool_name ?? null;

    const summary: DashboardToolsSummary = {
      total_tool_calls: totalToolCalls,
      completed_tool_calls: completedToolCalls,
      failed_tool_calls: failedToolCalls,
      running_tool_calls: runningToolCalls,
      tool_error_rate: safeRate(failedToolCalls, totalToolCalls),
      avg_duration_ms:
        durationAgg?.avg_ms != null ? Number(durationAgg.avg_ms) : null,
      total_tools: tools.length,
      most_used_tool: mostUsedTool,
      slowest_tool: slowestTool,
      most_error_prone_tool: mostErrorProneTool,
    };

    // ── 3. Timeline (daily × tool_name) ──────────────────────────────
    const dateExpr = sqlDailyBucketExprWithOffset("started_at_ms", offsetMin);

    const timelineRows = db
      .query(
        `SELECT
           ${dateExpr}                                        AS date,
           tool_name,
           COUNT(*)                                           AS call_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed_count,
           AVG(duration_ms)                                   AS avg_duration_ms
         FROM tool_calls
         WHERE started_at_ms >= ? AND started_at_ms <= ?
         GROUP BY date, tool_name
         ORDER BY date, tool_name`,
      )
      .all(start, end) as unknown as TimelineRow[];

    const timeline: DashboardToolTimelinePoint[] = timelineRows.map((row) => ({
      date: row.date,
      tool_name: row.tool_name,
      call_count: toNum(row.call_count),
      failed_count: toNum(row.failed_count),
      avg_duration_ms:
        row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
    }));

    // ── 4. Recent errors (metadata only, no input/output) ────────────
    const errorRows = db
      .query(
        `SELECT
           call_id,
           session_id,
           tool_name,
           error_message,
           started_at_ms,
           completed_at_ms,
           duration_ms
         FROM tool_calls
         WHERE status = 'error'
           AND started_at_ms >= ? AND started_at_ms <= ?
         ORDER BY completed_at_ms DESC
         LIMIT ?`,
      )
      .all(start, end, recentErrorLimit) as unknown as ErrorRow[];

    const recent_errors: DashboardToolRecentError[] = errorRows.map((row) => ({
      call_id: row.call_id,
      session_id: row.session_id,
      tool_name: row.tool_name,
      error_message: row.error_message ?? "",
      started_at_ms:
        row.started_at_ms != null ? Number(row.started_at_ms) : null,
      completed_at_ms:
        row.completed_at_ms != null ? Number(row.completed_at_ms) : null,
      duration_ms: row.duration_ms != null ? Number(row.duration_ms) : null,
    }));

    // ── 5. Assemble response ─────────────────────────────────────────
    const data: DashboardToolsData = {
      summary,
      tools,
      timeline,
      recent_errors,
    };

    const body: DashboardDataResponse<DashboardToolsData> = { data };
    return c.json(body);
  };
}
