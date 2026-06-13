import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createDashboardSessionDetailHandler } from "../../../src/api/dashboard/sessions-detail";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";

function createApp() {
  const db = createTestDb();
  seedDashboardData(db);
  const app = new Hono();
  app.get("/sessions/:id", createDashboardSessionDetailHandler(db));
  return app;
}

describe("session detail dashboard handler", () => {
  it("returns full session detail", async () => {
    const response = await createApp().request("/sessions/ses_2?tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.session).toMatchObject({
      session_id: "ses_2",
      message_count: 1,
      total_tokens: 140,
      tool_call_count: 1,
      error_count: 1,
      primary_model: "anthropic/claude",
    });
    expect(body.data.messages).toHaveLength(1);
    expect(body.data.model_usage).toHaveLength(1);
    expect(body.data.tool_calls).toHaveLength(1);
    expect(body.data.errors.map((error: { event_type: string }) => error.event_type)).toEqual([
      "message.error:ModelError",
      "session.error",
      "tool.error:edit",
    ]);
  });

  it("returns 404 when session is missing", async () => {
    const response = await createApp().request("/sessions/missing?tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Session not found");
  });

  it("returns 400 for invalid timezone", async () => {
    const response = await createApp().request("/sessions/ses_1?tz=Invalid/Zone");

    expect(response.status).toBe(400);
  });
});
