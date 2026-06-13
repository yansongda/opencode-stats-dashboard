import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createOverviewDashboardHandler } from "../../../src/api/dashboard/overview";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/overview", createOverviewDashboardHandler(db));
  return app;
}

describe("overview dashboard handler", () => {
  it("returns aggregate overview data", async () => {
    const response = await createApp().request("/overview?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary.total_sessions).toBe(2);
    expect(body.data.summary.total_messages).toBe(3);
    expect(body.data.summary.total_tokens).toBe(310);
    expect(body.data.summary.total_tool_calls).toBe(2);
    expect(body.data.top_models).toHaveLength(2);
  });

  it("returns 400 for invalid time range", async () => {
    const response = await createApp().request("/overview?start=10&end=1");
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("start (10) must be ≤ end (1)");
  });
});
