import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createModelsDashboardHandler } from "../../../src/api/dashboard/models";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/models", createModelsDashboardHandler(db));
  return app;
}

describe("models dashboard handler", () => {
  it("returns per-model metrics sorted by cost by default", async () => {
    const response = await createApp().request("/models?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.models.map((model: { model: string }) => model.model)).toEqual([
      "openai/gpt-4",
      "anthropic/claude",
    ]);
    expect(body.data.cost_trend).toHaveLength(2);
  });

  it("honors sorting and limit", async () => {
    const response = await createApp().request("/models?start=0&end=10000&sort=model&order=asc&limit=1&tz=UTC");
    const body = await response.json();

    expect(body.data.models).toHaveLength(1);
    expect(body.data.models[0].model).toBe("anthropic/claude");
  });
});
