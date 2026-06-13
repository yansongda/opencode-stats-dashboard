/**
 * Timezone Parsing & Offset
 */

const MAX_TZ_LENGTH = 50;

/**
 * Parse and validate an IANA timezone identifier from a query parameter.
 *
 * Follows the same discriminated-union pattern as `parseTimeRange`.
 *
 * Rules:
 *  - `undefined`, empty string, or whitespace-only → defaults to `"UTC"`.
 *  - Leading/trailing whitespace is trimmed.
 *  - Rejects strings longer than 50 characters.
 *  - Rejects strings that are not valid IANA timezone identifiers
 *    (validated via `Intl.DateTimeFormat`).
 *
 * @param rawTz - Raw `tz` query string (may be undefined).
 */
export function parseTimezone(
  rawTz: string | undefined,
): { ok: true; tz: string } | { ok: false; error: string } {
  if (rawTz === undefined || rawTz.trim() === "") {
    return { ok: true, tz: "UTC" };
  }

  const tz = rawTz.trim();

  if (tz.length > MAX_TZ_LENGTH) {
    return {
      ok: false,
      error: "tz too long",
    };
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    return { ok: false, error: `invalid timezone: ${tz}` };
  }

  return { ok: true, tz };
}

/**
 * Return the fixed UTC offset for a timezone at a given instant, in minutes.
 *
 * Positive values are east of UTC (e.g., Asia/Shanghai → +480),
 * negative values are west (e.g., America/New_York → -300 during EST, -240 during EDT).
 *
 * Implementation uses `Intl.DateTimeFormat` with `hourCycle: 'h23'` and
 * `formatToParts` to extract civil date/time components in the target zone,
 * then compares against the UTC epoch millisecond input.
 *
 * NOTE: Returns the offset for the *specific instant* (`atMs`). DST transitions
 * mean the offset for the same zone can differ at different instants.
 *
 * @param tz  - Valid IANA timezone identifier.
 * @param atMs - UTC epoch milliseconds to evaluate at (default: `Date.now()`).
 */
export function getTzOffsetMinutes(tz: string, atMs?: number): number {
  const epochMs = atMs ?? Date.now();

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = formatter.formatToParts(new Date(epochMs));

  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (const p of parts) {
    switch (p.type) {
      case "year":
        year = Number(p.value);
        break;
      case "month":
        month = Number(p.value);
        break;
      case "day":
        day = Number(p.value);
        break;
      case "hour":
        hour = Number(p.value);
        break;
      case "minute":
        minute = Number(p.value);
        break;
      case "second":
        second = Number(p.value);
        break;
    }
  }

  // Construct the UTC equivalent of the civil time shown in the target zone
  const utcEquiv = Date.UTC(year, month - 1, day, hour, minute, second);

  return Math.round((utcEquiv - epochMs) / 60_000);
}
