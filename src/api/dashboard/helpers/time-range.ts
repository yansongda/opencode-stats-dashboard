/**
 * Time Range Parsing & Validation
 */

/**
 * Result of parsing a time range from query parameters.
 *
 * Discriminated union: check `ok` to determine success/failure.
 */
export type TimeRangeResult =
  | { ok: true; start: number; end: number }
  | { ok: false; error: string; field?: "start" | "end" };

/**
 * Parse and validate optional `start` and `end` millisecond timestamp
 * query parameters.
 *
 * Rules:
 *  - Both are optional; if both absent, returns `{ ok: true, start: 0, end: Date.now() }`.
 *  - Must be valid finite numbers when present (after parseInt).
 *  - Must be non-negative.
 *  - `start` must be ≤ `end` when both are present.
 *
 * @param rawStart - Raw `start` query string (may be undefined).
 * @param rawEnd   - Raw `end` query string (may be undefined).
 * @returns TimeRangeResult discriminated union.
 */
export function parseTimeRange(
  rawStart: string | undefined,
  rawEnd: string | undefined,
): TimeRangeResult {
  const now = Date.now();

  if (rawStart === undefined && rawEnd === undefined) {
    return { ok: true, start: 0, end: now };
  }

  let start: number | undefined;
  let end: number | undefined;

  if (rawStart !== undefined) {
    const parsed = Number(rawStart);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        error: "start must be a non-negative integer (ms)",
        field: "start",
      };
    }
    start = Math.floor(parsed);
  }

  if (rawEnd !== undefined) {
    const parsed = Number(rawEnd);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return {
        ok: false,
        error: "end must be a non-negative integer (ms)",
        field: "end",
      };
    }
    end = Math.floor(parsed);
  }

  const resolvedStart = start ?? 0;
  const resolvedEnd = end ?? now;

  if (resolvedStart > resolvedEnd) {
    return {
      ok: false,
      error: `start (${resolvedStart}) must be ≤ end (${resolvedEnd})`,
      field: "start",
    };
  }

  return { ok: true, start: resolvedStart, end: resolvedEnd };
}
