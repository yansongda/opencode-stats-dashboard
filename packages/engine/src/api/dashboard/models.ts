/**
 * Dashboard models endpoint — GET /api/v1/dashboard/models
 *
 * Returns model comparison data with per-model stats and cost trend.
 * No summary object — contract is models[] + cost_trend[] only.
 *
 * Design doc: §5.3 (models page contract).
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardModelCostTrendPoint,
  DashboardModelItem,
  DashboardModelsData,
} from "@opencode-stats/shared";
import type { Context } from "hono";
import {
  getTzOffsetMinutes,
  parsePagination,
  parseSortOrder,
  parseTimeRange,
  parseTimezone,
  safeDivide,
  safeRate,
  sqlDailyBucketExprWithOffset,
  toNum,
} from "./helpers";

// ============================================================================
// Internal Query Types
// ============================================================================

interface ModelStatsRow {
  model: string;
  message_count: number;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  cost_usd: number;
  error_count: number;
}

// ============================================================================
// SQL Queries
// ============================================================================

function queryModelStats(
  db: Database,
  start: number,
  end: number,
): ModelStatsRow[] {
  const rows = db
    .query(
      `SELECT
        m.model,
        COUNT(*) as message_count,
        COUNT(DISTINCT m.session_id) as session_count,
        COALESCE(SUM(m.input_tokens), 0) as input_tokens,
        COALESCE(SUM(m.output_tokens), 0) as output_tokens,
        COALESCE(SUM(m.reasoning_tokens), 0) as reasoning_tokens,
        COALESCE(SUM(m.total_tokens), 0) as total_tokens,
        COALESCE(SUM(m.cost_usd), 0) as cost_usd,
        COALESCE(SUM(CASE WHEN m.has_error = 1 THEN 1 ELSE 0 END), 0) as error_count
      FROM messages m
      WHERE m.model IS NOT NULL
        AND m.role = 'assistant'
        AND m.created_at_ms >= ?
        AND m.created_at_ms <= ?
      GROUP BY m.model`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    model: String(row.model),
    message_count: toNum(row.message_count),
    session_count: toNum(row.session_count),
    input_tokens: toNum(row.input_tokens),
    output_tokens: toNum(row.output_tokens),
    reasoning_tokens: toNum(row.reasoning_tokens),
    total_tokens: toNum(row.total_tokens),
    cost_usd: toNum(row.cost_usd),
    error_count: toNum(row.error_count),
  }));
}

function queryCostTrend(
  db: Database,
  start: number,
  end: number,
  models: string[],
  offsetMin: number,
): DashboardModelCostTrendPoint[] {
  if (models.length === 0) return [];

  const placeholders = models.map(() => "?").join(", ");
  const rows = db
    .query(
      `SELECT
        ${sqlDailyBucketExprWithOffset("m.created_at_ms", offsetMin)} as date,
        m.model,
        COALESCE(SUM(m.cost_usd), 0) as cost_usd
      FROM messages m
      WHERE m.model IS NOT NULL
        AND m.role = 'assistant'
        AND m.created_at_ms >= ?
        AND m.created_at_ms <= ?
        AND m.model IN (${placeholders})
      GROUP BY date, m.model
      ORDER BY date, m.model`,
    )
    .all(start, end, ...models) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    date: String(row.date),
    model: String(row.model),
    cost_usd: toNum(row.cost_usd),
  }));
}

// ============================================================================
// Model Item Builder
// ============================================================================

function buildModelItem(row: ModelStatsRow): DashboardModelItem {
  return {
    model: row.model,
    message_count: row.message_count,
    session_count: row.session_count,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    reasoning_tokens: row.reasoning_tokens,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    avg_cost_per_message: safeDivide(row.cost_usd, row.message_count, 6),
    error_count: row.error_count,
    error_rate: safeRate(row.error_count, row.message_count),
  };
}

// ============================================================================
// Handler Factory
// ============================================================================

export function createModelsDashboardHandler(db: Database) {
  return (c: Context) => {
    const timeRange = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!timeRange.ok) {
      return c.json({ error: timeRange.error }, 400);
    }

    const tzResult = parseTimezone(c.req.query("tz"));
    if (!tzResult.ok) {
      return c.json({ error: tzResult.error }, 400);
    }

    const offsetMin = getTzOffsetMinutes(tzResult.tz, Date.now());

    const { field, order } = parseSortOrder(
      "models",
      c.req.query("sort"),
      c.req.query("order"),
    );

    const { limit } = parsePagination(c.req.query("limit"), undefined);

    const allModelStats = queryModelStats(db, timeRange.start, timeRange.end);

    // Sort
    const sorted = [...allModelStats].sort((a, b) => {
      const aVal = a[field as keyof ModelStatsRow];
      const bVal = b[field as keyof ModelStatsRow];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return order === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal ?? 0);
      const bNum = Number(bVal ?? 0);
      return order === "asc" ? aNum - bNum : bNum - aNum;
    });

    const limitedRows = sorted.slice(0, limit);
    const displayedModels = limitedRows.map((r) => r.model);

    // Build model items
    const models: DashboardModelItem[] = limitedRows.map((row) =>
      buildModelItem(row),
    );

    // Cost trend
    const costTrend = queryCostTrend(
      db,
      timeRange.start,
      timeRange.end,
      displayedModels,
      offsetMin,
    );

    const data: DashboardModelsData = {
      models,
      cost_trend: costTrend,
    };

    return c.json({ data });
  };
}
