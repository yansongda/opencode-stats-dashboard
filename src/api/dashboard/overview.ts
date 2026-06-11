/**
 * Dashboard overview endpoint — GET /api/v1/dashboard/overview
 *
 * Returns aggregated overview data with summary, daily trend, heatmap,
 * top models, model message distribution, and project distribution.
 *
 * Design doc: §5.1 (overview page contract).
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardOverviewData,
  DashboardOverviewProjectDistributionItem,
  DashboardOverviewSummary,
  DashboardOverviewTopModel,
  DashboardOverviewTrendPoint,
} from "@defs/api";
import type { Context } from "hono";
import { queryHeatmap } from "./components/heatmap";
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
}

interface MessageAggRow {
  total_messages: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  files_changed: number;
  lines_added: number;
  lines_deleted: number;
  total_projects: number;
}

interface ToolAggRow {
  total_tool_calls: number;
  total_tool_errors: number;
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
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) as deleted_sessions
       FROM sessions
       WHERE last_event_at_ms >= ? AND last_event_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_sessions: toNum(row?.total_sessions),
    active_sessions: toNum(row?.active_sessions),
    deleted_sessions: toNum(row?.deleted_sessions),
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
         COALESCE(SUM(total_tokens), 0) as total_tokens,
         COALESCE(SUM(input_tokens), 0) as input_tokens,
         COALESCE(SUM(output_tokens), 0) as output_tokens,
         COALESCE(SUM(cost_usd), 0) as total_cost_usd,
         COALESCE(SUM(files_changed), 0) as files_changed,
         COALESCE(SUM(lines_added), 0) as lines_added,
         COALESCE(SUM(lines_deleted), 0) as lines_deleted,
         COUNT(DISTINCT project_path) as total_projects
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?`,
    )
    .get(start, end) as Record<string, unknown> | null;

  return {
    total_messages: toNum(row?.total_messages),
    total_tokens: toNum(row?.total_tokens),
    input_tokens: toNum(row?.input_tokens),
    output_tokens: toNum(row?.output_tokens),
    total_cost_usd: toNum(row?.total_cost_usd),
    files_changed: toNum(row?.files_changed),
    lines_added: toNum(row?.lines_added),
    lines_deleted: toNum(row?.lines_deleted),
    total_projects: toNum(row?.total_projects),
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

// ============================================================================
// Trend query (private)
// ============================================================================

function queryTrend(
  db: Database,
  start: number,
  end: number,
  offsetMin: number,
): DashboardOverviewTrendPoint[] {
  const rows = db
    .query(
      `SELECT
         ${sqlDailyBucketExprWithOffset("created_at_ms", offsetMin)} as date,
         COUNT(*) as messages,
         COALESCE(SUM(total_tokens), 0) as tokens
       FROM messages
       WHERE created_at_ms >= ? AND created_at_ms <= ?
       GROUP BY date
       ORDER BY date`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    date: String(row.date),
    messages: toNum(row.messages),
    tokens: toNum(row.tokens),
  }));
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
         COALESCE(SUM(cost_usd), 0) as cost_usd
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
    cost_usd: toNum(row.cost_usd),
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
       WHERE model IS NOT NULL
         AND role = 'assistant'
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
// Summary builder (private)
// ============================================================================

function buildSummary(
  sessionAgg: SessionAggRow,
  msgAgg: MessageAggRow,
  toolAgg: ToolAggRow,
): DashboardOverviewSummary {
  return {
    total_sessions: sessionAgg.total_sessions,
    active_sessions: sessionAgg.active_sessions,
    deleted_sessions: sessionAgg.deleted_sessions,
    total_messages: msgAgg.total_messages,
    total_tokens: msgAgg.total_tokens,
    input_tokens: msgAgg.input_tokens,
    output_tokens: msgAgg.output_tokens,
    total_cost_usd: msgAgg.total_cost_usd,
    total_tool_calls: toolAgg.total_tool_calls,
    total_tool_errors: toolAgg.total_tool_errors,
    files_changed: msgAgg.files_changed,
    lines_added: msgAgg.lines_added,
    lines_deleted: msgAgg.lines_deleted,
    total_projects: msgAgg.total_projects,
    avg_project_tokens: safeDivide(msgAgg.total_tokens, msgAgg.total_projects),
    avg_project_cost: safeDivide(msgAgg.total_cost_usd, msgAgg.total_projects),
    avg_project_messages: safeDivide(
      msgAgg.total_messages,
      msgAgg.total_projects,
    ),
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

export function createOverviewDashboardHandler(db: Database) {
  return (c: Context) => {
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

    const sessionAgg = querySessionAgg(db, start, end);
    const msgAgg = queryMessageAgg(db, start, end);
    const toolAgg = queryToolAgg(db, start, end);

    const summary = buildSummary(sessionAgg, msgAgg, toolAgg);
    const trend = queryTrend(db, start, end, offsetMin);
    const heatmap = queryHeatmap(db, start, end, offsetMin);
    const topModels = queryTopModels(db, start, end);
    const modelMessageDistribution = queryModelMessageDistribution(
      db,
      start,
      end,
    );
    const projectDistribution = queryProjectDistribution(db, start, end);

    const data: DashboardOverviewData = {
      summary,
      trend,
      heatmap,
      top_models: topModels,
      model_message_distribution: modelMessageDistribution,
      project_distribution: projectDistribution,
    };

    return c.json({ data });
  };
}
