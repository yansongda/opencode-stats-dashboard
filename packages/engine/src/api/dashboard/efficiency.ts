/**
 * 效率分析仪表盘查询层 — GET /api/v1/dashboard/efficiency?start=&end=&bucket=day
 *
 * 提供效率相关的聚合查询：摘要、时间线、活跃热力图。
 * 仅导出查询/处理器，不注册路由。
 *
 * 数据来源：messages、sessions、tool_calls、events 四张表的真实时间戳。
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardDataResponse,
  DashboardEfficiencyData,
  DashboardEfficiencySummary,
  DashboardEfficiencyTimelinePoint,
} from "@opencode-stats/shared";
import type { Context } from "hono";
import { queryHeatmap } from "./components/heatmap";
import {
  getTzOffsetMinutes,
  parseTimeRange,
  parseTimezone,
  safeDivide,
  sqlDailyBucketExprWithOffset,
  sqlHourlyBucketExprWithOffset,
  toNum,
} from "./helpers";

// ============================================================================
// Local Helpers
// ============================================================================

type BucketGranularity = "day" | "hour";

function parseBucket(raw: string | undefined): BucketGranularity {
  if (raw === "hour") return "hour";
  return "day";
}

function bucketExpr(
  granularity: BucketGranularity,
  column = "created_at_ms",
  offsetMin = 0,
): string {
  return granularity === "hour"
    ? sqlHourlyBucketExprWithOffset(column, offsetMin)
    : sqlDailyBucketExprWithOffset(column, offsetMin);
}

// ============================================================================
// Summary Query
// ============================================================================

function querySummary(
  db: Database,
  start: number,
  end: number,
): DashboardEfficiencySummary {
  // Session average duration
  const sessRow = db
    .query(
      `SELECT
        COUNT(*) as total_sessions,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration_ms
      FROM sessions
      WHERE first_event_at_ms >= ? AND first_event_at_ms <= ?`,
    )
    .get(start, end) as Record<string, number | null> | null;

  // Message aggregates (cost, files)
  const msgRow = db
    .query(
      `SELECT
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        COALESCE(SUM(files_changed), 0) as total_files_changed
      FROM messages
      WHERE created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, number | null> | null;

  // Active hour count (union of messages + tool_calls + events)
  const activeHoursRow = db
    .query(
      `SELECT COUNT(*) as cnt FROM (
        SELECT strftime('%Y-%m-%d %H:00', created_at_ms / 1000, 'unixepoch') as h
          FROM messages WHERE created_at_ms >= ? AND created_at_ms <= ?
        UNION
        SELECT strftime('%Y-%m-%d %H:00', COALESCE(started_at_ms, completed_at_ms) / 1000, 'unixepoch') as h
          FROM tool_calls
          WHERE COALESCE(started_at_ms, completed_at_ms) IS NOT NULL
            AND COALESCE(started_at_ms, completed_at_ms) >= ?
            AND COALESCE(started_at_ms, completed_at_ms) <= ?
        UNION
        SELECT strftime('%Y-%m-%d %H:00', created_at_ms / 1000, 'unixepoch') as h
          FROM events WHERE event_type = 'session.error'
            AND created_at_ms >= ? AND created_at_ms <= ?
      )`,
    )
    .get(start, end, start, end, start, end) as Record<
    string,
    number | null
  > | null;

  // Message count for per-active-hour calculation
  const msgCountRow = db
    .query(
      `SELECT COUNT(*) as total_messages
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, number | null> | null;

  const totalSessions = toNum(sessRow?.total_sessions);
  const totalCostUsd = toNum(msgRow?.total_cost_usd);
  const totalFilesChanged = toNum(msgRow?.total_files_changed);
  const activeHours = toNum(activeHoursRow?.cnt);
  const totalMessages = toNum(msgCountRow?.total_messages);

  return {
    avg_session_duration_ms:
      sessRow?.avg_duration_ms != null ? Number(sessRow.avg_duration_ms) : null,
    avg_cost_per_session: safeDivide(totalCostUsd, totalSessions),
    total_files_changed: totalFilesChanged,
    messages_per_active_hour: safeDivide(totalMessages, activeHours),
  };
}

// ============================================================================
// Timeline Query
// ============================================================================

interface MessageBucketRow {
  bucket: string;
  tokens: number;
  cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
}

function queryTimeline(
  db: Database,
  start: number,
  end: number,
  granularity: BucketGranularity,
  offsetMin = 0,
): DashboardEfficiencyTimelinePoint[] {
  const msgBucket = bucketExpr(granularity, "created_at_ms", offsetMin);

  const msgRows = db
    .query(
      `SELECT
        ${msgBucket} as bucket,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd,
        COALESCE(SUM(lines_added), 0) as lines_added,
        COALESCE(SUM(lines_deleted), 0) as lines_deleted,
        COALESCE(SUM(files_changed), 0) as files_changed
      FROM messages
      WHERE created_at_ms >= ? AND created_at_ms <= ?
      GROUP BY ${msgBucket}
      ORDER BY bucket`,
    )
    .all(start, end) as MessageBucketRow[];

  return msgRows.map((row) => ({
    bucket: row.bucket,
    tokens: toNum(row.tokens),
    cost_usd: toNum(row.cost_usd),
    lines_added: toNum(row.lines_added),
    lines_deleted: toNum(row.lines_deleted),
    files_changed: toNum(row.files_changed),
  }));
}

// ============================================================================
// Exported Handler Factory
// ============================================================================

export function createEfficiencyHandler(db: Database) {
  return (c: Context) => {
    const range = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!range.ok) {
      return c.json({ error: range.error }, 400);
    }

    const tzResult = parseTimezone(c.req.query("tz"));
    if (!tzResult.ok) {
      return c.json({ error: tzResult.error }, 400);
    }

    const offsetMin = getTzOffsetMinutes(tzResult.tz);
    const granularity = parseBucket(c.req.query("bucket"));

    const data: DashboardEfficiencyData = {
      summary: querySummary(db, range.start, range.end),
      timeline: queryTimeline(
        db,
        range.start,
        range.end,
        granularity,
        offsetMin,
      ),
      heatmap: queryHeatmap(db, range.start, range.end, offsetMin),
    };

    return c.json({
      data,
    } satisfies DashboardDataResponse<DashboardEfficiencyData>);
  };
}
