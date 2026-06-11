/**
 * Dashboard Projects page — query surface for GET /api/v1/dashboard/projects
 *
 * Exports a focused handler that returns per-project aggregated stats,
 * activity trends, and project-model usage from real rows only.
 *
 * Data sources:
 *  - Session metrics (session_count, duration, etc.) from `sessions`
 *  - Message metrics (tokens, cost, files, tool calls) from `messages`
 *  - Activity trend from `messages` (per project + date)
 *  - Project-model usage from `messages` (per project + model, NULL model excluded)
 *
 * Route registration happens later (Task 13).
 *
 * Design doc: §4 (DashboardProjectsData contract).
 */

import type { Database } from "bun:sqlite";
import {
  buildWhereConditions,
  getTzOffsetMinutes,
  parsePagination,
  parseSortOrder,
  parseTimeRange,
  parseTimezone,
  safeDivide,
  sqlDailyBucketExprWithOffset,
  toNum,
} from "@api/dashboard/helpers";
import type {
  DashboardProjectActivityTrendPoint,
  DashboardProjectItem,
  DashboardProjectModelUsageItem,
  DashboardProjectsData,
  DashboardProjectsSummary,
} from "@defs/api";
import type { Context } from "hono";

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Deterministic placeholder for NULL or empty project_path.
 *
 * `sessions.project_path` is nullable; `messages.project_path` is NOT NULL
 * but may be empty string. Both map to this placeholder so grouping is
 * consistent across sessions and messages tables.
 */
const NO_PROJECT = "(no project)";

function normalizeProject(raw: string | null | undefined): string {
  if (raw == null || raw === "") return NO_PROJECT;
  return raw;
}

function topByField(
  projects: DashboardProjectItem[],
  field: keyof DashboardProjectItem,
): string | null {
  let best: string | null = null;
  let bestVal = -Infinity;
  for (const p of projects) {
    const v = Number(p[field]) || 0;
    if (v > bestVal) {
      bestVal = v;
      best = p.project_path;
    }
  }
  // Don't report the placeholder as "top project"
  if (best === NO_PROJECT) return null;
  return best;
}

// ============================================================================
// Handler Factory
// ============================================================================

/**
 * Create the projects dashboard handler.
 *
 * Returns a Hono context handler that queries session + message tables,
 * aggregates per-project stats, and returns DashboardProjectsData.
 *
 * @param db - SQLite database instance.
 */
export function createProjectsDashboardHandler(db: Database) {
  return (c: Context) => {
    // ── Parse query parameters ──────────────────────────────────────

    const timeResult = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!timeResult.ok) {
      return c.json({ error: timeResult.error }, 400);
    }
    const { start, end } = timeResult;

    const pagination = parsePagination(
      c.req.query("limit"),
      c.req.query("offset"),
    );

    const sort = parseSortOrder(
      "projects",
      c.req.query("sort"),
      c.req.query("order"),
    );

    const tzResult = parseTimezone(c.req.query("tz"));
    if (!tzResult.ok) {
      return c.json({ error: tzResult.error }, 400);
    }
    const { tz } = tzResult;

    const now = Date.now();
    const offsetMin = getTzOffsetMinutes(tz, now);

    // ── Time range WHERE fragments ──────────────────────────────────

    const { clause: msgWhere, params: msgWhereParams } = buildWhereConditions([
      ["m.created_at_ms >= ?", start > 0 ? start : undefined],
      ["m.created_at_ms <= ?", end < Date.now() ? end : undefined],
    ]);

    const { clause: sessWhere, params: sessWhereParams } = buildWhereConditions(
      [
        ["s.last_event_at_ms >= ?", start > 0 ? start : undefined],
        ["s.last_event_at_ms <= ?", end < Date.now() ? end : undefined],
      ],
    );

    // ── 1. Session metrics per project (from sessions table) ────────

    const sessionRows = db
      .query(
        `SELECT
           COALESCE(s.project_path, '') AS project_path,
           COUNT(*)                     AS session_count,
           MIN(s.first_event_at_ms)     AS first_event_at_ms,
           MAX(s.last_event_at_ms)      AS last_event_at_ms
         FROM sessions s
         WHERE 1=1${sessWhere}
         GROUP BY COALESCE(s.project_path, '')`,
      )
      .all(...sessWhereParams) as Array<Record<string, unknown>>;

    const sessionMap = new Map<
      string,
      {
        session_count: number;
        first_event_at_ms: number | null;
        last_event_at_ms: number | null;
      }
    >();
    for (const row of sessionRows) {
      const pp = normalizeProject(row.project_path as string | null);
      sessionMap.set(pp, {
        session_count: toNum(row.session_count),
        first_event_at_ms:
          row.first_event_at_ms != null ? toNum(row.first_event_at_ms) : null,
        last_event_at_ms:
          row.last_event_at_ms != null ? toNum(row.last_event_at_ms) : null,
      });
    }

    // ── 2. Message + token + cost + file metrics (from messages) ────

    const messageRows = db
      .query(
        `SELECT
           m.project_path,
           COUNT(*)                        AS message_count,
           SUM(m.input_tokens)             AS input_tokens,
           SUM(m.output_tokens)            AS output_tokens,
           SUM(m.reasoning_tokens)         AS reasoning_tokens,
           SUM(m.cache_read)               AS cache_read,
           SUM(m.cache_write)              AS cache_write,
           SUM(m.total_tokens)             AS total_tokens,
           SUM(m.cost_usd)                 AS cost_usd,
           SUM(m.files_changed)            AS files_changed,
           SUM(m.lines_added)              AS lines_added,
           SUM(m.lines_deleted)            AS lines_deleted,
           SUM(m.has_error)                AS error_count,
           MIN(m.created_at_ms)            AS first_msg_at_ms,
           MAX(m.created_at_ms)            AS last_msg_at_ms
         FROM messages m
         WHERE 1=1${msgWhere}
         GROUP BY m.project_path`,
      )
      .all(...msgWhereParams) as Array<Record<string, unknown>>;

    const messageMap = new Map<string, Record<string, unknown>>();
    for (const row of messageRows) {
      messageMap.set(normalizeProject(row.project_path as string | null), row);
    }

    // ── 3. Primary model + model count per project ──────────────────

    const primaryModelRows = db
      .query(
        `SELECT
           m.project_path,
           m.model,
           COUNT(*) AS msg_count
         FROM messages m
         WHERE m.model IS NOT NULL AND m.model != ''${msgWhere}
         GROUP BY m.project_path, m.model`,
      )
      .all(...msgWhereParams) as Array<Record<string, unknown>>;

    interface ModelAccum {
      primary: string | null;
      primaryCount: number;
      modelSet: Set<string>;
    }
    const modelAccumMap = new Map<string, ModelAccum>();
    for (const row of primaryModelRows) {
      const pp = normalizeProject(row.project_path as string | null);
      const model = row.model as string;
      const count = toNum(row.msg_count);
      let acc = modelAccumMap.get(pp);
      if (!acc) {
        acc = { primary: null, primaryCount: 0, modelSet: new Set() };
        modelAccumMap.set(pp, acc);
      }
      acc.modelSet.add(model);
      if (count > acc.primaryCount) {
        acc.primary = model;
        acc.primaryCount = count;
      }
    }

    // ── 4. Tool call counts per project (via session join) ──────────

    const toolRows = db
      .query(
        `SELECT
           COALESCE(s.project_path, '') AS project_path,
           COUNT(*)                     AS tool_call_count,
           SUM(CASE WHEN tc.status = 'error' THEN 1 ELSE 0 END)
                                        AS tool_error_count
         FROM tool_calls tc
         JOIN sessions s ON s.session_id = tc.session_id
         WHERE 1=1${sessWhere}
         GROUP BY COALESCE(s.project_path, '')`,
      )
      .all(...sessWhereParams) as Array<Record<string, unknown>>;

    const toolMap = new Map<
      string,
      { tool_call_count: number; tool_error_count: number }
    >();
    for (const row of toolRows) {
      const pp = normalizeProject(row.project_path as string | null);
      toolMap.set(pp, {
        tool_call_count: toNum(row.tool_call_count),
        tool_error_count: toNum(row.tool_error_count),
      });
    }

    // ── 5. Merge into project items ─────────────────────────────────

    const allProjectPaths = new Set<string>([
      ...sessionMap.keys(),
      ...messageMap.keys(),
    ]);

    const projectItems: DashboardProjectItem[] = [];
    for (const pp of allProjectPaths) {
      const sess = sessionMap.get(pp);
      const msg = messageMap.get(pp);
      const modelAcc = modelAccumMap.get(pp);
      const tool = toolMap.get(pp);

      const sessionCount = sess?.session_count ?? 0;
      const messageCount = msg ? toNum(msg.message_count) : 0;

      if (sessionCount === 0 && messageCount === 0) continue;

      const totalTokens = msg ? toNum(msg.total_tokens) : 0;
      const costUsd = msg ? toNum(msg.cost_usd) : 0;

      projectItems.push({
        project_path: pp,
        session_count: sessionCount,
        message_count: messageCount,
        input_tokens: msg ? toNum(msg.input_tokens) : 0,
        output_tokens: msg ? toNum(msg.output_tokens) : 0,
        reasoning_tokens: msg ? toNum(msg.reasoning_tokens) : 0,
        cache_read: msg ? toNum(msg.cache_read) : 0,
        cache_write: msg ? toNum(msg.cache_write) : 0,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        files_changed: msg ? toNum(msg.files_changed) : 0,
        lines_added: msg ? toNum(msg.lines_added) : 0,
        lines_deleted: msg ? toNum(msg.lines_deleted) : 0,
        tool_call_count: tool?.tool_call_count ?? 0,
        tool_error_count: tool?.tool_error_count ?? 0,
        error_count: msg ? toNum(msg.error_count) : 0,
        primary_model: modelAcc?.primary ?? null,
        model_count: modelAcc?.modelSet.size ?? 0,
        avg_tokens_per_session: safeDivide(totalTokens, sessionCount),
        avg_cost_per_session: safeDivide(costUsd, sessionCount),
        avg_messages_per_session: safeDivide(messageCount, sessionCount),
        first_event_at_ms:
          sess?.first_event_at_ms ??
          (msg?.first_msg_at_ms != null ? toNum(msg.first_msg_at_ms) : null),
        last_event_at_ms:
          sess?.last_event_at_ms ??
          (msg?.last_msg_at_ms != null ? toNum(msg.last_msg_at_ms) : null),
      });
    }

    // Sort
    const sortField = sort.field as keyof DashboardProjectItem;
    const sortMul = sort.order === "desc" ? -1 : 1;
    projectItems.sort((a, b) => {
      const aRaw = a[sortField];
      const bRaw = b[sortField];
      if (typeof aRaw === "string" && typeof bRaw === "string") {
        return aRaw.localeCompare(bRaw) * sortMul;
      }
      const aVal = Number(aRaw) || 0;
      const bVal = Number(bRaw) || 0;
      return (aVal - bVal) * sortMul;
    });

    // Paginate
    const paginatedProjects = projectItems.slice(
      pagination.offset,
      pagination.offset + pagination.limit,
    );

    // ── 6. Summary ──────────────────────────────────────────────────

    const summary: DashboardProjectsSummary = {
      total_projects: projectItems.length,
      active_projects: projectItems.filter((p) => p.last_event_at_ms != null)
        .length,
      total_sessions: projectItems.reduce((s, p) => s + p.session_count, 0),
      total_messages: projectItems.reduce((s, p) => s + p.message_count, 0),
      total_tokens: projectItems.reduce((s, p) => s + p.total_tokens, 0),
      total_cost_usd: projectItems.reduce((s, p) => s + p.cost_usd, 0),
      total_files_changed: projectItems.reduce(
        (s, p) => s + p.files_changed,
        0,
      ),
      total_lines_added: projectItems.reduce((s, p) => s + p.lines_added, 0),
      total_lines_deleted: projectItems.reduce(
        (s, p) => s + p.lines_deleted,
        0,
      ),
      top_project_by_tokens: topByField(projectItems, "total_tokens"),
      top_project_by_cost: topByField(projectItems, "cost_usd"),
      top_project_by_activity: topByField(projectItems, "session_count"),
    };

    // ── 7. Activity trend (per project + date) ──────────────────────

    const dailyBucket = sqlDailyBucketExprWithOffset(
      "m.created_at_ms",
      offsetMin,
    );

    const trendRows = db
      .query(
        `SELECT
           ${dailyBucket} AS bucket,
           m.project_path,
           COUNT(*)           AS messages,
           SUM(m.total_tokens) AS tokens,
           SUM(m.cost_usd)    AS cost_usd,
           SUM(m.files_changed) AS files_changed,
           SUM(m.lines_added) AS lines_added,
           SUM(m.lines_deleted) AS lines_deleted
         FROM messages m
         WHERE 1=1${msgWhere}
         GROUP BY bucket, m.project_path
         ORDER BY bucket ASC`,
      )
      .all(...msgWhereParams) as Array<Record<string, unknown>>;

    const activityTrend: DashboardProjectActivityTrendPoint[] = trendRows.map(
      (row) => ({
        date: String(row.bucket),
        project_path: normalizeProject(row.project_path as string | null),
        sessions: 0, // sessions not tracked per-day in messages
        messages: toNum(row.messages),
        tokens: toNum(row.tokens),
        cost_usd: toNum(row.cost_usd),
        files_changed: toNum(row.files_changed),
        lines_added: toNum(row.lines_added),
        lines_deleted: toNum(row.lines_deleted),
      }),
    );

    // Fill session counts per project+date from sessions table
    const sessTrendRows = db
      .query(
        `SELECT
           ${sqlDailyBucketExprWithOffset("s.first_event_at_ms", offsetMin)} AS bucket,
           COALESCE(s.project_path, '') AS project_path,
           COUNT(*) AS sessions
         FROM sessions s
         WHERE s.first_event_at_ms IS NOT NULL${sessWhere}
         GROUP BY bucket, COALESCE(s.project_path, '')`,
      )
      .all(...sessWhereParams) as Array<Record<string, unknown>>;

    const sessTrendMap = new Map<string, number>();
    for (const row of sessTrendRows) {
      const key = `${row.bucket}|${normalizeProject(row.project_path as string | null)}`;
      sessTrendMap.set(key, toNum(row.sessions));
    }

    for (const point of activityTrend) {
      const key = `${point.date}|${point.project_path}`;
      point.sessions = sessTrendMap.get(key) ?? 0;
    }

    // ── 8. Project-model usage (from messages, NULL model excluded) ─

    const modelUsageRows = db
      .query(
        `SELECT
           m.project_path,
           m.model,
           COUNT(*)                     AS messages,
           COUNT(DISTINCT m.session_id) AS sessions,
           SUM(m.total_tokens)          AS tokens,
           SUM(m.cost_usd)              AS cost_usd
         FROM messages m
         WHERE m.model IS NOT NULL AND m.model != ''${msgWhere}
         GROUP BY m.project_path, m.model`,
      )
      .all(...msgWhereParams) as Array<Record<string, unknown>>;

    const projectModelUsage: DashboardProjectModelUsageItem[] =
      modelUsageRows.map((row) => ({
        project_path: normalizeProject(row.project_path as string | null),
        model: row.model as string,
        sessions: toNum(row.sessions),
        messages: toNum(row.messages),
        tokens: toNum(row.tokens),
        cost_usd: toNum(row.cost_usd),
      }));

    // ── 9. Assemble response ────────────────────────────────────────

    const data: DashboardProjectsData = {
      summary,
      projects: paginatedProjects,
      activity_trend: activityTrend,
      project_model_usage: projectModelUsage,
    };

    return c.json({ data });
  };
}
