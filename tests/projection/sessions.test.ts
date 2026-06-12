import { describe, expect, it } from "bun:test";
import { ProjectionEngine } from "../../src/projection/engine";
import { createSessionProjectionHandler } from "../../src/projection/sessions";
import { createTestDb } from "../helpers/db";
import { assistantMessage, sessionCreated, sessionDeleted, sessionError, sessionUpdated, toolCompleted, userMessage } from "../helpers/stats-events";

function createEngine() {
  const db = createTestDb();
  const engine = new ProjectionEngine(db);
  engine.registerHandler("sessions", createSessionProjectionHandler());
  return { db, engine };
}

describe("session projection handler", () => {
  it("declares all supported event types", () => {
    expect(createSessionProjectionHandler().handles).toEqual([
      "session.created",
      "session.updated",
      "session.deleted",
      "session.error",
      "message.updated.user",
      "message.updated.assistant",
      "tool.execute.pending",
      "tool.execute.running",
      "tool.execute.completed",
      "tool.execute.failed",
    ]);
  });

  it("creates, updates and deletes session rows", () => {
    const { db, engine } = createEngine();

    engine.processEvent(sessionCreated({ created_at_ms: 1_000 }));
    engine.processEvent(sessionUpdated({ created_at_ms: 2_500, title: "Renamed" }));
    engine.processEvent(sessionDeleted({ created_at_ms: 4_000 }));

    expect(db.query("SELECT session_id, title, status, first_event_at_ms, last_event_at_ms, duration_ms, deleted_at_ms FROM sessions WHERE session_id = ?").get("ses_1")).toEqual({
      session_id: "ses_1",
      title: "Renamed",
      status: "deleted",
      first_event_at_ms: 1_000,
      last_event_at_ms: 4_000,
      duration_ms: 3_000,
      deleted_at_ms: 4_000,
    });
  });

  it("updates timestamps for session errors", () => {
    const { db, engine } = createEngine();
    engine.processEvent(sessionCreated({ created_at_ms: 1_000 }));

    engine.processEvent(sessionError({ created_at_ms: 3_000 }));

    expect(db.query("SELECT last_event_at_ms, duration_ms FROM sessions WHERE session_id = ?").get("ses_1")).toEqual({
      last_event_at_ms: 3_000,
      duration_ms: 2_000,
    });
  });

  it("creates placeholder sessions for message events before session.created", () => {
    const { db, engine } = createEngine();

    engine.processEvent(userMessage({ session_id: "ses_late", project_path: "/late", created_at_ms: 5_000 }));

    expect(db.query("SELECT session_id, project_path, title, status, first_event_at_ms, last_event_at_ms FROM sessions WHERE session_id = ?").get("ses_late")).toEqual({
      session_id: "ses_late",
      project_path: "/late",
      title: "",
      status: "active",
      first_event_at_ms: 5_000,
      last_event_at_ms: 5_000,
    });
  });

  it("updates timestamps for assistant and tool events", () => {
    const { db, engine } = createEngine();
    engine.processEvent(sessionCreated({ created_at_ms: 1_000 }));
    engine.processEvent(assistantMessage({ created_at_ms: 6_000 }));
    engine.processEvent(toolCompleted({ created_at_ms: 8_000 }));

    expect(db.query("SELECT last_event_at_ms, duration_ms FROM sessions WHERE session_id = ?").get("ses_1")).toEqual({
      last_event_at_ms: 8_000,
      duration_ms: 7_000,
    });
  });
});
