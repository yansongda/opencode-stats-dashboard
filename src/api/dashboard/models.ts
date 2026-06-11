/**
 * Dashboard models endpoint — GET /api/v1/dashboard/models
 *
 * Returns model comparison data with summary, per-model stats, and cost trend.
 * Queries `messages` and `tool_calls` tables directly; no session aggregate
 * columns are assumed.
 *
 * Design doc: §5.3 (models page contract).
 */

import type { Database } from "bun:sqlite";
import type {
  DashboardModelCostTrendPoint,
  DashboardModelItem,
  DashboardModelsData,
  DashboardModelsSummary,
} from "@defs/api";
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
  cache_read: number;
  cache_write: number;
  total_tokens: number;
  cost_usd: number;
  error_count: number;
  first_used_at_ms: number | null;
  last_used_at_ms: number | null;
}

// ============================================================================
// SQL Queries
// ============================================================================

/**
 * Query per-model aggregate stats from the messages table.
 *
 * Filters: model IS NOT NULL, role = 'assistant', time range.
 * Groups by model. Returns raw numeric rows (nulls coalesced to 0).
 */
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
        COALESCE(SUM(m.cache_read), 0) as cache_read,
        COALESCE(SUM(m.cache_write), 0) as cache_write,
        COALESCE(SUM(m.total_tokens), 0) as total_tokens,
        COALESCE(SUM(m.cost_usd), 0) as cost_usd,
        COALESCE(SUM(CASE WHEN m.has_error = 1 THEN 1 ELSE 0 END), 0) as error_count,
        MIN(m.created_at_ms) as first_used_at_ms,
        MAX(m.created_at_ms) as last_used_at_ms
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
    cache_read: toNum(row.cache_read),
    cache_write: toNum(row.cache_write),
    total_tokens: toNum(row.total_tokens),
    cost_usd: toNum(row.cost_usd),
    error_count: toNum(row.error_count),
    first_used_at_ms:
      row.first_used_at_ms != null ? Number(row.first_used_at_ms) : null,
    last_used_at_ms:
      row.last_used_at_ms != null ? Number(row.last_used_at_ms) : null,
  }));
}

/**
 * Query associated tool call counts for a set of models.
 *
 * "Associated" means: count tool calls in sessions where the model has
 * at least one assistant message. This is session-level association, NOT
 * direct model→tool_call attribution (tool_calls has no model column).
 *
 * Approach: DISTINCT (model, session_id) pairs from messages JOIN
 * tool_calls on session_id → COUNT per model. The DISTINCT prevents
 * double-counting when a session has multiple messages from the same model.
 */
function queryAssociatedToolCounts(
  db: Database,
  start: number,
  end: number,
  models: string[],
): Map<string, number> {
  if (models.length === 0) return new Map();

  const placeholders = models.map(() => "?").join(", ");
  const rows = db
    .query(
      `SELECT sub.model, COUNT(tc.call_id) as associated_tool_call_count
      FROM (
        SELECT DISTINCT model, session_id
        FROM messages
        WHERE model IS NOT NULL
          AND role = 'assistant'
          AND created_at_ms >= ?
          AND created_at_ms <= ?
          AND model IN (${placeholders})
      ) sub
      JOIN tool_calls tc ON tc.session_id = sub.session_id
      GROUP BY sub.model`,
    )
    .all(start, end, ...models) as Array<Record<string, unknown>>;

  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(String(row.model), toNum(row.associated_tool_call_count));
  }
  return map;
}

/**
 * Query daily cost trend for a set of models.
 *
 * Groups by date (offset-adjusted day bucket from created_at_ms) and model.
 * Returns tokens, cost_usd, and message count per bucket.
 */
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
        COALESCE(SUM(m.total_tokens), 0) as tokens,
        COALESCE(SUM(m.cost_usd), 0) as cost_usd,
        COUNT(*) as messages
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
    tokens: toNum(row.tokens),
    cost_usd: toNum(row.cost_usd),
    messages: toNum(row.messages),
  }));
}

// ============================================================================
// Summary Computation
// ============================================================================

/**
 * Compute the summary object from the full (unlimited) set of model rows.
 *
 * Determines top model by tokens, top model by cost, and cheapest model
 * per 1k tokens. All totals are derived from the model rows themselves.
 */
function computeSummary(rows: ModelStatsRow[]): DashboardModelsSummary {
  let totalMessages = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;
  let topByTokens: { model: string; tokens: number } | null = null;
  let topByCost: { model: string; cost: number } | null = null;
  let cheapest: { model: string; costPer1k: number } | null = null;

  for (const row of rows) {
    totalMessages += row.message_count;
    totalTokens += row.total_tokens;
    totalCostUsd += row.cost_usd;

    if (!topByTokens || row.total_tokens > topByTokens.tokens) {
      topByTokens = { model: row.model, tokens: row.total_tokens };
    }

    if (!topByCost || row.cost_usd > topByCost.cost) {
      topByCost = { model: row.model, cost: row.cost_usd };
    }

    // cost_per_1k_tokens = cost_usd / (total_tokens / 1000) = cost_usd * 1000 / total_tokens
    const costPer1k = safeDivide(row.cost_usd * 1000, row.total_tokens);
    if (costPer1k !== null && (!cheapest || costPer1k < cheapest.costPer1k)) {
      cheapest = { model: row.model, costPer1k };
    }
  }

  return {
    total_models: rows.length,
    total_messages: totalMessages,
    total_tokens: totalTokens,
    total_cost_usd: totalCostUsd,
    top_model_by_tokens: topByTokens?.model ?? null,
    top_model_by_cost: topByCost?.model ?? null,
    cheapest_model_per_1k_tokens: cheapest?.model ?? null,
  };
}

// ============================================================================
// Model Item Builder
// ============================================================================

/**
 * Map a raw ModelStatsRow + tool count into a DashboardModelItem.
 *
 * Derived fields use safe division helpers to return null when the
 * denominator is zero (e.g., cost_per_1k_tokens when total_tokens = 0).
 */
function buildModelItem(
  row: ModelStatsRow,
  toolCount: number,
): DashboardModelItem {
  return {
    model: row.model,
    message_count: row.message_count,
    session_count: row.session_count,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    reasoning_tokens: row.reasoning_tokens,
    cache_read: row.cache_read,
    cache_write: row.cache_write,
    total_tokens: row.total_tokens,
    cost_usd: row.cost_usd,
    avg_tokens_per_message: safeDivide(row.total_tokens, row.message_count),
    avg_cost_per_message: safeDivide(row.cost_usd, row.message_count, 6),
    cost_per_1k_tokens: safeDivide(row.cost_usd * 1000, row.total_tokens, 6),
    associated_tool_call_count: toolCount,
    error_count: row.error_count,
    error_rate: safeRate(row.error_count, row.message_count),
    first_used_at_ms: row.first_used_at_ms,
    last_used_at_ms: row.last_used_at_ms,
  };
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create the Hono handler for GET /api/v1/dashboard/models.
 *
 * Query parameters:
 *   - start (ms timestamp, optional)
 *   - end   (ms timestamp, optional)
 *   - sort  (field name, optional — defaults to cost_usd)
 *   - order (asc | desc, optional — defaults to desc)
 *   - limit (1–100, optional — defaults to 20)
 *
 * Response: `{ data: DashboardModelsData }` containing summary, models[],
 * and cost_trend[].
 *
 * Route registration is NOT performed here; the caller mounts this handler.
 */
export function createModelsDashboardHandler(db: Database) {
  return (c: Context) => {
    // 1. Parse & validate parameters
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

    // 2. Query ALL model stats (no limit) — needed for accurate summary
    const allModelStats = queryModelStats(db, timeRange.start, timeRange.end);

    // 3. Compute summary from full dataset
    const summary = computeSummary(allModelStats);

    // 4. Sort and limit for the displayed model rows
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

    // 5. Query associated tool counts only for displayed models
    const toolCounts = queryAssociatedToolCounts(
      db,
      timeRange.start,
      timeRange.end,
      displayedModels,
    );

    // 6. Build DashboardModelItem[]
    const models: DashboardModelItem[] = limitedRows.map((row) =>
      buildModelItem(row, toolCounts.get(row.model) ?? 0),
    );

    // 7. Query cost trend for displayed models
    const costTrend = queryCostTrend(
      db,
      timeRange.start,
      timeRange.end,
      displayedModels,
      offsetMin,
    );

    // 8. Assemble and return
    const data: DashboardModelsData = {
      summary,
      models,
      cost_trend: costTrend,
    };

    return c.json({ data });
  };
}
