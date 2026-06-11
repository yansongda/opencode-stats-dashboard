/**
 * Dashboard Projects page — query surface for GET /api/v1/dashboard/projects
 *
 * Returns per-project aggregated stats, activity trends, and project-model
 * usage. No summary object — contract is projects[] + activity_trend[] +
 * project_model_usage[] only.
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
  sqlDailyBucketExprWithOffset,
  toNum,
} from "@api/dashboard/helpers";
import type {
  DashboardProjectActivityTrendPoint,
  DashboardProjectItem,
  DashboardProjectModelUsageItem,
  DashboardProjectsData,
} from "@defs/api";
import type { Context } from "hono";

// ============================================================================
// Internal Helpers
// ============================================================================

const NO_PROJECT = "(no project)";

function normalizeProject(raw: string | null | undefined): string {
  if (raw == null || raw === "") return NO_PROJECT;
  return raw;
}

// ============================================================================
// Handler Factory
// ============================================================================

export function createProjectsDashboardHandler(db: Database) {
  return (c: Context) => {
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
           MAX(s.last_event_at_ms)      AS last_event_at_ms
         FROM sessions s
         WHERE 1=1${sessWhere}
         GROUP BY COALESCE(s.project_path, '')`,
      )
      .all(...sessWhereParams) as Array<Record<string, unknown>>;

    const sessionMap = new Map<
      string,
      { session_count: number; last_event_at_ms: number | null }
    >();
    for (const row of sessionRows) {
      const pp = normalizeProject(row.project_path as string | null);
      sessionMap.set(pp, {
        session_count: toNum(row.session_count),
        last_event_at_ms:
          row.last_event_at_ms != null ? toNum(row.last_event_at_ms) : null,
      });
    }

    // ── 2. Message + token + cost metrics (from messages) ───────────

    const messageRows = db
      .query(
        `SELECT
           m.project_path,
           COUNT(*)                        AS message_count,
           SUM(m.total_tokens)             AS total_tokens,
           SUM(m.cost_usd)                 AS cost_usd,
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

    // ── 3. Primary model per project ────────────────────────────────

    const primaryModelRows = db
      .query(
        `SELECT
           m.project_path,
           m.model,
           SUM(m.total_tokens) AS model_tokens
         FROM messages m
         WHERE m.model IS NOT NULL AND m.model != ''${msgWhere}
         GROUP BY m.project_path, m.model`,
      )
      .all(...msgWhereParams) as Array<Record<string, unknown>>;

    const primaryModelMap = new Map<string, string | null>();
    const primaryCountMap = new Map<string, number>();
    for (const row of primaryModelRows) {
      const pp = normalizeProject(row.project_path as string | null);
      const model = row.model as string;
      const modelTokens = toNum(row.model_tokens);
      const existing = primaryCountMap.get(pp) ?? 0;
      if (modelTokens > existing) {
        primaryModelMap.set(pp, model);
        primaryCountMap.set(pp, modelTokens);
      }
    }

    // ── 4. Merge into project items ─────────────────────────────────

    const allProjectPaths = new Set<string>([
      ...sessionMap.keys(),
      ...messageMap.keys(),
    ]);

    const projectItems: DashboardProjectItem[] = [];
    for (const pp of allProjectPaths) {
      const sess = sessionMap.get(pp);
      const msg = messageMap.get(pp);

      const sessionCount = sess?.session_count ?? 0;
      const messageCount = msg ? toNum(msg.message_count) : 0;

      if (sessionCount === 0 && messageCount === 0) continue;

      const totalTokens = msg ? toNum(msg.total_tokens) : 0;
      const costUsd = msg ? toNum(msg.cost_usd) : 0;

      projectItems.push({
        project_path: pp,
        session_count: sessionCount,
        message_count: messageCount,
        total_tokens: totalTokens,
        cost_usd: costUsd,
        primary_model: primaryModelMap.get(pp) ?? null,
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

    // ── 5. Activity trend (per project + date) ──────────────────────

    const dailyBucket = sqlDailyBucketExprWithOffset(
      "m.created_at_ms",
      offsetMin,
    );

    const trendRows = db
      .query(
        `SELECT
           ${dailyBucket} AS bucket,
           m.project_path,
           COUNT(*)           AS messages
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
        messages: toNum(row.messages),
      }),
    );

    // ── 6. Project-model usage (from messages, NULL model excluded) ─

    const modelUsageRows = db
      .query(
        `SELECT
           m.project_path,
           m.model,
           COUNT(*)                     AS messages,
           COUNT(DISTINCT m.session_id) AS sessions
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
      }));

    // ── 7. Assemble response ────────────────────────────────────────

    const data: DashboardProjectsData = {
      projects: paginatedProjects,
      activity_trend: activityTrend,
      project_model_usage: projectModelUsage,
    };

    return c.json({ data });
  };
}
