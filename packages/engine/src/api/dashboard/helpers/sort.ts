/**
 * Sort / Order Mapping
 */

import type { SortOrder } from "@opencode-stats/shared";

/**
 * Allowed sort fields per dashboard page.
 *
 * Keys are page identifiers (e.g., "sessions", "models", "tools").
 * Values are the allowed column names for ORDER BY clauses.
 *
 * NOTE: These map to actual SQL column names from the source tables
 * (events, sessions, messages, tool_calls), not projected columns.
 */
export const ALLOWED_SORT_FIELDS: Record<string, readonly string[]> = {
  sessions: ["last_event_at_ms", "session_id", "project_path", "title"],
  models: ["cost_usd", "total_tokens", "message_count", "model"],
  projects: [
    "cost_usd",
    "total_tokens",
    "session_count",
    "message_count",
    "last_event_at_ms",
    "project_path",
  ],
  tools: ["call_count", "error_count", "avg_duration_ms", "tool_name"],
} as const;

/**
 * Default sort field per page.
 */
export const DEFAULT_SORT_FIELD: Record<string, string> = {
  sessions: "last_event_at_ms",
  models: "cost_usd",
  projects: "cost_usd",
  tools: "call_count",
};

/**
 * Parse sort/order query parameters with allow-list validation.
 *
 * Returns a validated { field, order } pair. If the requested field is not
 * in the allowed list for the given page, falls back to the page default.
 *
 * @param page       - Page identifier (key in ALLOWED_SORT_FIELDS).
 * @param rawSortBy  - Raw `sort_by` query string.
 * @param rawOrder   - Raw `order` query string.
 */
export function parseSortOrder(
  page: string,
  rawSortBy: string | undefined,
  rawOrder: string | undefined,
): { field: string; order: SortOrder } {
  const allowed = ALLOWED_SORT_FIELDS[page] ?? [];
  const defaultField = DEFAULT_SORT_FIELD[page] ?? allowed[0] ?? "rowid";

  const field =
    rawSortBy !== undefined &&
    (allowed as readonly string[]).includes(rawSortBy)
      ? rawSortBy
      : defaultField;

  const order: SortOrder =
    rawOrder === "asc" || rawOrder === "desc" ? rawOrder : "desc";

  return { field, order };
}
