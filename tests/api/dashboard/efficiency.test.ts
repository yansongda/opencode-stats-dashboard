import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createEfficiencyHandler } from "../../../src/api/dashboard/efficiency";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/efficiency", createEfficiencyHandler(db));
  return app;
}

describe("efficiency dashboard handler", () => {
  it("returns summary, timeline and heatmap", async () => {
    const response = await createApp().request("/efficiency?start=0&end=10000&bucket=day&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary.total_files_changed).toBe(1);
    expect(body.data.timeline).toHaveLength(1);
    expect(body.data.heatmap.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid timezone", async () => {
    const response = await createApp().request("/efficiency?tz=Nope/Zone");

    expect(response.status).toBe(400);
  });
});
