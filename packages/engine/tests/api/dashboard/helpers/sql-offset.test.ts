import { describe, expect, it } from "bun:test";
import { sqlDailyBucketExprWithOffset, sqlHourWithOffset, sqlHourlyBucketExprWithOffset, sqlWeekdayWithOffset } from "../../../../src/api/dashboard/helpers/sql-offset";

describe("fixed-offset SQL helpers", () => {
  it("builds daily bucket expressions", () => {
    expect(sqlDailyBucketExprWithOffset("created_at_ms", 480)).toBe(
      "date((created_at_ms + 28800000) / 1000, 'unixepoch')",
    );
  });

  it("builds hourly bucket expressions", () => {
    expect(sqlHourlyBucketExprWithOffset("started_at_ms", -300)).toBe(
      "strftime('%Y-%m-%d %H:00', (started_at_ms + -18000000) / 1000, 'unixepoch')",
    );
  });

  it("builds weekday and hour extraction expressions", () => {
    expect(sqlWeekdayWithOffset("created_at_ms", 0)).toBe(
      "CAST(strftime('%w', (created_at_ms + 0) / 1000, 'unixepoch') AS INTEGER)",
    );
    expect(sqlHourWithOffset("created_at_ms", 330)).toBe(
      "CAST(strftime('%H', (created_at_ms + 19800000) / 1000, 'unixepoch') AS INTEGER)",
    );
  });
});
