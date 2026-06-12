import { describe, expect, it } from "bun:test";
import { queryHeatmap } from "../../../../src/api/dashboard/components/heatmap";
import { createTestDb } from "../../../helpers/db";
import { seedDashboardData } from "../../../helpers/dashboard-seed";

describe("queryHeatmap", () => {
  it("aggregates messages by weekday and hour", () => {
    const db = createTestDb();
    seedDashboardData(db);

    const heatmap = queryHeatmap(db, 0, 10_000, 0);

    expect(heatmap.reduce((sum, point) => sum + point.messages, 0)).toBe(3);
    expect(heatmap.every((point) => point.weekday >= 0 && point.weekday <= 6)).toBe(true);
    expect(heatmap.every((point) => point.hour >= 0 && point.hour <= 23)).toBe(true);
  });
});
