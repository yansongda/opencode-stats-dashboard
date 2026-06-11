/**
 * 效率分析仪表盘查询层 — GET /api/v1/dashboard/efficiency?start=&end=&bucket=day
 *
 * 提供效率相关的聚合查询：摘要、时间线、活跃热力图、模型效率。
 * 仅导出查询/处理器，不注册路由（由 Task 13 统一注册）。
 *
 * 数据来源：messages、sessions、tool_calls、events 四张表的真实时间戳。
 * 不使用合成数据或伪造的响应延迟。
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardDataResponse,
  DashboardEfficiencyData,
  DashboardEfficiencyModelItem,
  DashboardEfficiencySummary,
  DashboardEfficiencyTimelinePoint,
} from "@defs/api";
import type { Context } from "hono";
import { queryHeatmap } from "./heatmap";
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
  // Session aggregates (count + average duration)
  const sessRow = db
    .query(
      `SELECT
        COUNT(*) as total_sessions,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration_ms
      FROM sessions
      WHERE first_event_at_ms >= ? AND first_event_at_ms <= ?`,
    )
    .get(start, end) as Record<string, number | null> | null;

  // Message aggregates (tokens, cost, code output)
  const msgRow = db
    .query(
      `SELECT
        COUNT(*) as total_messages,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        COALESCE(SUM(lines_added), 0) as total_lines_added,
        COALESCE(SUM(lines_deleted), 0) as total_lines_deleted,
        COALESCE(SUM(files_changed), 0) as total_files_changed
      FROM messages
      WHERE created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, number | null> | null;

  // Distinct active hour buckets with at least one message/tool/error event.
  // Uses UNION (not UNION ALL) to deduplicate across the three tables.
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

  const totalSessions = toNum(sessRow?.total_sessions);
  const totalMessages = toNum(msgRow?.total_messages);
  const totalTokens = toNum(msgRow?.total_tokens);
  const totalCostUsd = toNum(msgRow?.total_cost_usd);
  const totalLinesAdded = toNum(msgRow?.total_lines_added);
  const totalLinesDeleted = toNum(msgRow?.total_lines_deleted);
  const totalFilesChanged = toNum(msgRow?.total_files_changed);
  const activeHours = toNum(activeHoursRow?.cnt);

  return {
    total_sessions: totalSessions,
    total_messages: totalMessages,
    total_tokens: totalTokens,
    total_cost_usd: totalCostUsd,
    // AVG returns NULL for empty sets — preserve as null per contract
    avg_session_duration_ms:
      sessRow?.avg_duration_ms != null ? Number(sessRow.avg_duration_ms) : null,
    avg_tokens_per_session: safeDivide(totalTokens, totalSessions),
    avg_cost_per_session: safeDivide(totalCostUsd, totalSessions),
    avg_messages_per_session: safeDivide(totalMessages, totalSessions),
    total_lines_added: totalLinesAdded,
    total_lines_deleted: totalLinesDeleted,
    total_files_changed: totalFilesChanged,
    tokens_per_usd: safeDivide(totalTokens, totalCostUsd),
    lines_changed_per_usd: safeDivide(
      totalLinesAdded + totalLinesDeleted,
      totalCostUsd,
    ),
    // safeDivide returns null when denominator is 0
    messages_per_active_hour: safeDivide(totalMessages, activeHours),
  };
}

// ============================================================================
// Timeline Query
// ============================================================================

interface MessageBucketRow {
  bucket: string;
  sessions: number;
  messages: number;
  tokens: number;
  cost_usd: number;
  lines_added: number;
  lines_deleted: number;
  files_changed: number;
}

interface SessionDurationRow {
  bucket: string;
  avg_duration_ms: number | null;
}

function queryTimeline(
  db: Database,
  start: number,
  end: number,
  granularity: BucketGranularity,
  offsetMin = 0,
): DashboardEfficiencyTimelinePoint[] {
  const msgBucket = bucketExpr(granularity, "created_at_ms", offsetMin);
  const sessBucket = bucketExpr(granularity, "first_event_at_ms", offsetMin);

  // Message aggregates per bucket
  const msgRows = db
    .query(
      `SELECT
        ${msgBucket} as bucket,
        COUNT(DISTINCT session_id) as sessions,
        COUNT(*) as messages,
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

  // Average session duration per bucket (bucketed by session start time)
  const sessRows = db
    .query(
      `SELECT
        ${sessBucket} as bucket,
        AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration_ms
      FROM sessions
      WHERE first_event_at_ms >= ? AND first_event_at_ms <= ?
      GROUP BY ${sessBucket}`,
    )
    .all(start, end) as SessionDurationRow[];

  // Merge session durations into message buckets
  const durationMap = new Map<string, number | null>();
  for (const row of sessRows) {
    durationMap.set(
      row.bucket,
      row.avg_duration_ms != null ? Number(row.avg_duration_ms) : null,
    );
  }

  return msgRows.map((row) => ({
    bucket: row.bucket,
    sessions: toNum(row.sessions),
    messages: toNum(row.messages),
    tokens: toNum(row.tokens),
    cost_usd: toNum(row.cost_usd),
    lines_added: toNum(row.lines_added),
    lines_deleted: toNum(row.lines_deleted),
    files_changed: toNum(row.files_changed),
    avg_session_duration_ms: durationMap.get(row.bucket) ?? null,
  }));
}

// ============================================================================
// Model Efficiency Query
// ============================================================================

interface ModelRow {
  model: string;
  messages: number;
  tokens: number;
  cost_usd: number;
}

function queryModelEfficiency(
  db: Database,
  start: number,
  end: number,
): DashboardEfficiencyModelItem[] {
  const rows = db
    .query(
      `SELECT
        model,
        COUNT(*) as messages,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM messages
      WHERE created_at_ms >= ? AND created_at_ms <= ?
        AND model IS NOT NULL
      GROUP BY model
      ORDER BY tokens DESC`,
    )
    .all(start, end) as ModelRow[];

  return rows.map((row) => {
    const messages = toNum(row.messages);
    const tokens = toNum(row.tokens);
    const costUsd = toNum(row.cost_usd);

    return {
      model: row.model,
      messages,
      tokens,
      cost_usd: costUsd,
      avg_tokens_per_message: safeDivide(tokens, messages),
      cost_per_1k_tokens: safeDivide(costUsd, tokens / 1000),
    };
  });
}

// ============================================================================
// Exported Handler Factory
// ============================================================================

/**
 * Create the efficiency dashboard handler.
 *
 * Returns a Hono handler that responds to
 * `GET /api/v1/dashboard/efficiency?start=&end=&bucket=day|hour`.
 *
 * The caller is responsible for mounting the route on the Hono app.
 */
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
      model_efficiency: queryModelEfficiency(db, range.start, range.end),
    };

    return c.json({
      data,
    } satisfies DashboardDataResponse<DashboardEfficiencyData>);
  };
}
