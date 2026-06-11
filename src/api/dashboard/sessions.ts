/**
 * Dashboard sessions list handler — GET /api/v1/dashboard/sessions
 *
 * Aggregates session-level stats from sessions, messages tables.
 * Returns { data: DashboardSessionListItem[] } — no meta/pagination wrapper.
 *
 * Query parameters:
 *   start, end         — time range (ms timestamps, optional)
 *   status             — filter by session status (active|deleted)
 *   project_path       — filter by project path
 *   limit, offset      — pagination (clamped by helpers)
 *   sort, order        — sort field & direction (validated against allow-list)
 *
 * Design doc: §6 (sessions list contract).
 */

import type { Database } from "bun:sqlite";
import {
  buildWhereConditions,
  parseOptionalString,
  parsePagination,
  parseSortOrder,
  parseTimeRange,
  parseTimezone,
  toNum,
} from "@api/dashboard/helpers";
import type {
  DashboardDataResponse,
  DashboardSessionListItem,
} from "@defs/api";
import type { Context } from "hono";

// ============================================================================
// Sort field mapping
// ============================================================================

const AGGREGATE_SORT_FIELDS = new Set([
  "total_tokens",
  "total_cost_usd",
  "message_count",
]);

// ============================================================================
// Aggregation (private)
// ============================================================================

interface MessageAggRow {
  session_id: string;
  message_count: number;
  total_tokens: number;
  total_cost_usd: number;
  primary_model: string | null;
}

function queryMessageAggregates(
  db: Database,
  sessionIds: string[],
): Map<string, MessageAggRow> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         session_id,
         COUNT(*) as message_count,
         SUM(total_tokens) as total_tokens,
         SUM(cost_usd) as total_cost_usd
       FROM messages
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const map = new Map<string, MessageAggRow>();
  for (const row of rows) {
    map.set(String(row.session_id), {
      session_id: String(row.session_id),
      message_count: toNum(row.message_count),
      total_tokens: toNum(row.total_tokens),
      total_cost_usd: toNum(row.total_cost_usd),
      primary_model: null,
    });
  }
  return map;
}

function queryPrimaryModels(
  db: Database,
  sessionIds: string[],
): Map<string, string | null> {
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => "?").join(",");
  const rows = db
    .query(
      `SELECT
         session_id,
         model,
         SUM(total_tokens) as model_tokens
       FROM messages
       WHERE session_id IN (${placeholders}) AND model IS NOT NULL AND model != ''
       GROUP BY session_id, model
       ORDER BY session_id, model_tokens DESC`,
    )
    .all(...sessionIds) as Array<Record<string, unknown>>;

  const primaryMap = new Map<string, string>();
  for (const row of rows) {
    const sid = String(row.session_id);
    if (!primaryMap.has(sid)) {
      primaryMap.set(sid, String(row.model));
    }
  }
  return primaryMap;
}

// ============================================================================
// Response builder (private)
// ============================================================================

function buildSessionListItem(
  session: Record<string, unknown>,
  msgAgg: Map<string, MessageAggRow>,
  primaryModels: Map<string, string | null>,
): DashboardSessionListItem {
  const sid = String(session.session_id);
  const msg = msgAgg.get(sid);

  return {
    session_id: sid,
    project_path: (session.project_path as string | null) ?? null,
    title: (session.title as string | null) ?? null,
    status: (session.status as "active" | "deleted") ?? "active",
    message_count: msg?.message_count ?? 0,
    total_tokens: msg?.total_tokens ?? 0,
    total_cost_usd: msg?.total_cost_usd ?? 0,
    primary_model: primaryModels.get(sid) ?? null,
    last_event_at_ms:
      session.last_event_at_ms != null
        ? Number(session.last_event_at_ms)
        : null,
  };
}

// ============================================================================
// Exported handler factory
// ============================================================================

export function createDashboardSessionsHandler(
  db: Database,
): (c: Context) => Response {
  return (c: Context) => {
    const timeRange = parseTimeRange(c.req.query("start"), c.req.query("end"));
    if (!timeRange.ok) {
      return c.json({ error: timeRange.error }, 400);
    }

    const timezone = parseTimezone(c.req.query("tz"));
    if (!timezone.ok) {
      return c.json({ error: timezone.error }, 400);
    }

    const pagination = parsePagination(
      c.req.query("limit"),
      c.req.query("offset"),
    );

    const sort = parseSortOrder(
      "sessions",
      c.req.query("sort"),
      c.req.query("order"),
    );

    const status = parseOptionalString(c.req.query("status"));
    const projectPath = parseOptionalString(c.req.query("project_path"));

    const { clause: whereClause, params: whereParams } = buildWhereConditions([
      ["last_event_at_ms >= ?", timeRange.start],
      ["last_event_at_ms <= ?", timeRange.end],
      ["status = ?", status],
      ["project_path = ?", projectPath],
    ]);

    const baseWhere = `WHERE 1=1${whereClause}`;

    const isDirectSort = !AGGREGATE_SORT_FIELDS.has(sort.field);
    const orderClause = isDirectSort
      ? `ORDER BY ${sort.field} ${sort.order}`
      : "ORDER BY last_event_at_ms DESC";

    const rows = db
      .query(
        `SELECT session_id, project_path, title, status, last_event_at_ms
         FROM sessions
         ${baseWhere}
         ${orderClause}
         LIMIT ? OFFSET ?`,
      )
      .all(...whereParams, pagination.limit, pagination.offset) as Array<
      Record<string, unknown>
    >;

    const sessionIds = rows.map((r) => String(r.session_id));

    const msgAgg = queryMessageAggregates(db, sessionIds);
    const primaryModels = queryPrimaryModels(db, sessionIds);

    let items: DashboardSessionListItem[] = rows.map((row) =>
      buildSessionListItem(row, msgAgg, primaryModels),
    );

    if (AGGREGATE_SORT_FIELDS.has(sort.field)) {
      items = items.toSorted((a, b) => {
        const aVal = a[sort.field as keyof DashboardSessionListItem];
        const bVal = b[sort.field as keyof DashboardSessionListItem];
        const aNum = typeof aVal === "number" ? aVal : 0;
        const bNum = typeof bVal === "number" ? bVal : 0;
        return sort.order === "asc" ? aNum - bNum : bNum - aNum;
      });
    }

    return c.json({
      data: items,
    } satisfies DashboardDataResponse<DashboardSessionListItem[]>);
  };
}
