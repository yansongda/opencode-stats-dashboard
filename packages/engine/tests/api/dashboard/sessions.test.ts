import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDashboardSessionsHandler } from "../../../src/api/dashboard/sessions";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/sessions", createDashboardSessionsHandler(db));
  return app;
}

describe("sessions dashboard handler", () => {
  it("returns session list with message aggregates", async () => {
    const response = await createApp().request("/sessions?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      session_id: "ses_1",
      message_count: 2,
      total_tokens: 170,
      primary_model: "openai/gpt-4",
    });
  });

  it("filters by status and project_path", async () => {
    const response = await createApp().request("/sessions?start=0&end=10000&status=deleted&project_path=/repo-b&tz=UTC");
    const body = await response.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].session_id).toBe("ses_2");
  });
});
