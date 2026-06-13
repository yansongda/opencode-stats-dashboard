export type TimeRange = "1d" | "7d" | "30d" | "all";

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function formatRelativeTimeFromDate(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "刚刚";
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: getBrowserTimezone(),
  }).format(date);
}

function getOffsetMs(tz: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  const localMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const utcSec = Math.trunc(utcMs / 1000) * 1000;
  return localMs - utcSec;
}

function todayLocalRangeMs(tz: string): { start: number; end: number } {
  const now = Date.now();
  const offset = getOffsetMs(tz, now);
  const localMs = now + offset;
  const dayMs = 86_400_000;
  const localDayStart = Math.floor(localMs / dayMs) * dayMs;
  return {
    start: localDayStart - offset,
    end: localDayStart + dayMs - offset - 1,
  };
}

export function formatTimestamp(
  ms: number | null | undefined,
  opts?: { withSeconds?: boolean },
): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  const fmtOpts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: getBrowserTimezone(),
  };
  if (opts?.withSeconds) fmtOpts.second = "2-digit";
  return new Intl.DateTimeFormat("zh-CN", fmtOpts).format(ms);
}

export function formatTimestampShort(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: getBrowserTimezone(),
  }).format(ms);
}

export function getTodayRange(): { start: number; end: number } {
  return todayLocalRangeMs(getBrowserTimezone());
}

export function getRangeMs(
  range: "1d" | "7d" | "30d" | "all",
): Record<string, number> {
  const now = Date.now();
  if (range === "1d") {
    const r = getTodayRange();
    return { start: r.start, end: r.end };
  }
  if (range === "7d") return { start: now - 7 * 86_400_000, end: now };
  if (range === "30d") return { start: now - 30 * 86_400_000, end: now };
  return {};
}

export function parseLocalDateInput(
  yyyyMmDd: string,
  edge: "start" | "end",
): number {
  const tz = getBrowserTimezone();
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const offset = getOffsetMs(tz, utcNoon);
  const localMidnight = Date.UTC(y, m - 1, d, 0, 0, 0) - offset;
  return edge === "start" ? localMidnight : localMidnight + 86_400_000 - 1;
}

/**
 * Convert a backend bucket string to a compact display label.
 *
 * Pure string formatting — the bucket strings are already in the timezone
 * the backend chose; this function only trims the year when it matches
 * the current year.
 *
 * Handles two formats:
 * - Daily:  "YYYY-MM-DD"        → "MM/DD" (or "YYYY MM/DD" if year differs)
 * - Hourly: "YYYY-MM-DD HH:00"  → "MM/DD HH:00" (or "YYYY MM/DD HH:00" if year differs)
 */
export function formatBucketLocal(bucket: string): string {
  const hourly = bucket.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/);
  if (hourly) {
    const [, y, m, d, h] = hourly;
    const currentYear = String(new Date().getFullYear());
    if (y !== currentYear) return `${y} ${m}/${d} ${h}:00`;
    return `${m}/${d} ${h}:00`;
  }

  const daily = bucket.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (daily) {
    const [, y, m, d] = daily;
    const currentYear = String(new Date().getFullYear());
    if (y !== currentYear) return `${y} ${m}/${d}`;
    return `${m}/${d}`;
  }

  return bucket;
}
