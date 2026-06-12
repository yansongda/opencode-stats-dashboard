import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDashboardToolsHandler } from "../../../src/api/dashboard/tools";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/tools", createDashboardToolsHandler(db));
  return app;
}

describe("tools dashboard handler", () => {
  it("returns summary, tool rows, timeline and recent errors", async () => {
    const response = await createApp().request("/tools?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary.total_tool_calls).toBe(2);
    expect(body.data.summary.failed_tool_calls).toBe(1);
    expect(body.data.tools).toHaveLength(2);
    expect(body.data.timeline).toHaveLength(1);
    expect(body.data.recent_errors).toHaveLength(1);
    expect(body.data.recent_errors[0].error_message).toBe("edit failed");
  });

  it("rejects invalid time ranges", async () => {
    const response = await createApp().request("/tools?start=2&end=1");

    expect(response.status).toBe(400);
  });
});
