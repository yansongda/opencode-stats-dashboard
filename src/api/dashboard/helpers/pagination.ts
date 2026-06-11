/**
 * Pagination
 */

/** Clamped pagination result. */
export interface Pagination {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 500;

/**
 * Parse and clamp `limit` and `offset` query parameters.
 *
 * - `limit`: clamped to [1, 500], defaults to 20.
 * - `offset`: clamped to ≥ 0, defaults to 0.
 * - Non-finite or negative values are replaced with defaults.
 *
 * @param rawLimit  - Raw `limit` query string.
 * @param rawOffset - Raw `offset` query string.
 */
export function parsePagination(
  rawLimit: string | undefined,
  rawOffset: string | undefined,
): Pagination {
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed) && parsed >= 1) {
      limit = Math.min(Math.floor(parsed), MAX_LIMIT);
    }
  }

  let offset = 0;
  if (rawOffset !== undefined) {
    const parsed = Number(rawOffset);
    if (Number.isFinite(parsed) && parsed >= 0) {
      offset = Math.floor(parsed);
    }
  }

  return { limit, offset };
}
