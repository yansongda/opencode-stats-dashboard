import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createProjectsDashboardHandler } from "../../../src/api/dashboard/projects";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/projects", createProjectsDashboardHandler(db));
  return app;
}

describe("projects dashboard handler", () => {
  it("returns project metrics and model usage", async () => {
    const response = await createApp().request("/projects?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.projects).toHaveLength(2);
    expect(body.data.activity_trend.length).toBeGreaterThan(0);
    expect(body.data.project_model_usage).toHaveLength(2);
  });

  it("applies pagination", async () => {
    const response = await createApp().request("/projects?start=0&end=10000&limit=1&offset=1&tz=UTC");
    const body = await response.json();

    expect(body.data.projects).toHaveLength(1);
  });
});
