/**
 * Fixed-Offset SQL Bucket Expressions
 */

/**
 * SQL expression for daily bucketing with a fixed timezone offset.
 *
 * Shifts `column` by `offsetMin * 60000` ms before extracting the date.
 * Example with offset 480 (UTC+8):
 *   `date((created_at_ms + 28800000) / 1000, 'unixepoch')`
 *
 * @param column    - The millisecond timestamp column name.
 * @param offsetMin - Offset in minutes (positive = east of UTC).
 */
export function sqlDailyBucketExprWithOffset(
  column: string,
  offsetMin: number,
): string {
  const offsetMs = offsetMin * 60_000;
  return `date((${column} + ${offsetMs}) / 1000, 'unixepoch')`;
}

/**
 * SQL expression for hourly bucketing with a fixed timezone offset.
 *
 * Shifts `column` by `offsetMin * 60000` ms before formatting.
 * Example with offset -300 (UTC-5):
 *   `strftime('%Y-%m-%d %H:00', (started_at_ms + -18000000) / 1000, 'unixepoch')`
 *
 * @param column    - The millisecond timestamp column name.
 * @param offsetMin - Offset in minutes (positive = east of UTC).
 */
export function sqlHourlyBucketExprWithOffset(
  column: string,
  offsetMin: number,
): string {
  const offsetMs = offsetMin * 60_000;
  return `strftime('%Y-%m-%d %H:00', (${column} + ${offsetMs}) / 1000, 'unixepoch')`;
}

/**
 * SQL expression for extracting weekday (0=Sunday, 6=Saturday) with a
 * fixed timezone offset.
 *
 * Shifts `column` by `offsetMin * 60000` ms, then uses `strftime('%w', ...)`.
 *
 * @param column    - The millisecond timestamp column name.
 * @param offsetMin - Offset in minutes (positive = east of UTC).
 */
export function sqlWeekdayWithOffset(
  column: string,
  offsetMin: number,
): string {
  const offsetMs = offsetMin * 60_000;
  return `CAST(strftime('%w', (${column} + ${offsetMs}) / 1000, 'unixepoch') AS INTEGER)`;
}

/**
 * SQL expression for extracting hour (0-23) with a fixed timezone offset.
 *
 * Shifts `column` by `offsetMin * 60000` ms, then uses `strftime('%H', ...)`.
 *
 * @param column    - The millisecond timestamp column name.
 * @param offsetMin - Offset in minutes (positive = east of UTC).
 */
export function sqlHourWithOffset(column: string, offsetMin: number): string {
  const offsetMs = offsetMin * 60_000;
  return `CAST(strftime('%H', (${column} + ${offsetMs}) / 1000, 'unixepoch') AS INTEGER)`;
}
