/**
 * Dashboard tools handler — GET /api/v1/dashboard/tools
 *
 * Returns { data: DashboardToolsData } with:
 *   - summary: total_tool_calls, failed_tool_calls, tool_error_rate
 *   - tools: per-tool breakdown with call/failed/error_rate/duration stats
 *   - timeline: daily aggregated call_count and failed_count
 *   - recent_errors: latest error rows with metadata only (no input/output)
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
} from "@opencode-stats/shared";
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
  error_count: number;
  avg_duration_ms: number | null;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
}

interface TimelineRow {
  date: string;
  call_count: number;
  failed_count: number;
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

export function createDashboardToolsHandler(
  db: Database,
): (c: Context) => Response {
  return (c: Context) => {
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

    const rawLimit = c.req.query("limit");
    const recentErrorLimit = rawLimit
      ? Math.min(Math.max(1, Math.floor(Number(rawLimit) || 20)), 100)
      : 20;

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
           SUM(CASE WHEN status = 'error'     THEN 1 ELSE 0 END) AS error_count,
           AVG(duration_ms)                                  AS avg_duration_ms,
           MIN(duration_ms)                                  AS min_duration_ms,
           MAX(duration_ms)                                  AS max_duration_ms
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
        failed_count: failedCount,
        error_rate: safeRate(failedCount, callCount),
        avg_duration_ms:
          row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
        min_duration_ms:
          row.min_duration_ms != null ? Number(row.min_duration_ms) : null,
        max_duration_ms:
          row.max_duration_ms != null ? Number(row.max_duration_ms) : null,
      };
    });

    // ── 2. Summary ───────────────────────────────────────────────────
    const totalToolCalls = tools.reduce((s, t) => s + t.call_count, 0);
    const failedToolCalls = tools.reduce((s, t) => s + t.failed_count, 0);

    const summary: DashboardToolsSummary = {
      total_tool_calls: totalToolCalls,
      failed_tool_calls: failedToolCalls,
      tool_error_rate: safeRate(failedToolCalls, totalToolCalls),
    };

    // ── 3. Timeline (daily aggregated) ───────────────────────────────
    const dateExpr = sqlDailyBucketExprWithOffset("started_at_ms", offsetMin);

    const timelineRows = db
      .query(
        `SELECT
           ${dateExpr}                                        AS date,
           COUNT(*)                                           AS call_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS failed_count
         FROM tool_calls
         WHERE started_at_ms >= ? AND started_at_ms <= ?
         GROUP BY date
         ORDER BY date`,
      )
      .all(start, end) as unknown as TimelineRow[];

    const timeline: DashboardToolTimelinePoint[] = timelineRows.map((row) => ({
      date: row.date,
      call_count: toNum(row.call_count),
      failed_count: toNum(row.failed_count),
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
