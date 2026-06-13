/**
 * Shared dashboard heatmap query.
 *
 * Aggregates messages by weekday × hour for dashboard pages that show
 * 工作时段分布. Weekday/hour bucketing uses the same fixed-offset timezone
 * approximation as other dashboard APIs.
 */

import type { Database } from "bun:sqlite";
import type { DashboardEfficiencyHeatmapPoint } from "@opencode-stats/shared";
import { sqlHourWithOffset, sqlWeekdayWithOffset, toNum } from "../helpers";

export function queryHeatmap(
  db: Database,
  start: number,
  end: number,
  offsetMin = 0,
): DashboardEfficiencyHeatmapPoint[] {
  const weekdayCol = sqlWeekdayWithOffset("created_at_ms", offsetMin);
  const hourCol = sqlHourWithOffset("created_at_ms", offsetMin);

  const rows = db
    .query(
      `SELECT
        ${weekdayCol} as weekday,
        ${hourCol} as hour,
        COUNT(*) as messages
      FROM messages
      WHERE created_at_ms >= ? AND created_at_ms <= ?
      GROUP BY weekday, hour`,
    )
    .all(start, end) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    weekday: toNum(row.weekday),
    hour: toNum(row.hour),
    messages: toNum(row.messages),
  }));
}
