import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { buildStatsNotification, createDashboardHandler, createDashboardStreamHandler } from "../../../src/api/dashboard";
import { SSE_EVENT_NAME } from "../../../src/types/stream";
import { createTestDb } from "../../helpers/db";
import { seedDashboardData } from "../../helpers/dashboard-seed";
import { sessionCreated } from "../../helpers/stats-events";

describe("dashboard index helpers", () => {
  it("builds lightweight stats notifications", () => {
    expect(buildStatsNotification(sessionCreated({ event_id: "evt", created_at_ms: 0 }))).toEqual({
      version: 1,
      event_id: "evt",
      event_type: "session.created",
      occurred_at_ms: 0,
      occurred_at: "1970-01-01T00:00:00.000Z",
      session_id: "ses_1",
    });
  });

  it("registers dashboard REST routes", async () => {
    const db = createTestDb();
    seedDashboardData(db);
    const app = new Hono();
    createDashboardHandler(db)(app);

    const response = await app.request("/api/v1/dashboard/overview?start=0&end=10000&tz=UTC");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.summary.total_sessions).toBe(2);
  });

  it("registers the dashboard SSE stream route", async () => {
    const app = new Hono();
    const stream = new ReadableStream<Uint8Array>();
    const broadcaster = { addClient: () => stream };
    createDashboardStreamHandler(broadcaster)(app);

    const response = await app.request("/api/v1/dashboard/stream");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(SSE_EVENT_NAME).toBe("notification");
  });
});
