import { describe, expect, it } from "bun:test";
import { ProjectionEngine } from "../../src/projection/engine";
import { toolCallHandler } from "../../src/projection/tool-calls";
import { createTestDb } from "../helpers/db";
import { toolCompleted, toolFailed, toolPending, toolRunning } from "../helpers/stats-events";

function createEngine() {
  const db = createTestDb();
  const engine = new ProjectionEngine(db);
  engine.registerHandler("tools", toolCallHandler);
  return { db, engine };
}

describe("tool call projection handler", () => {
  it("declares the tool lifecycle events", () => {
    expect(toolCallHandler.handles).toEqual([
      "tool.execute.pending",
      "tool.execute.running",
      "tool.execute.completed",
      "tool.execute.failed",
    ]);
  });

  it("inserts pending tool calls as running", () => {
    const { db, engine } = createEngine();

    engine.processEvent(toolPending());

    expect(db.query("SELECT call_id, session_id, tool_name, status, started_at_ms FROM tool_calls WHERE call_id = ?").get("call_1")).toEqual({
      call_id: "call_1",
      session_id: "ses_1",
      tool_name: "bash",
      status: "running",
      started_at_ms: 7_000,
    });
  });

  it("leaves running events as no-ops", () => {
    const { db, engine } = createEngine();

    engine.processEvent(toolRunning({ call_id: "call_running" }));

    expect(db.query("SELECT COUNT(*) AS count FROM tool_calls WHERE call_id = ?").get("call_running")).toEqual({ count: 0 });
  });

  it("updates pending calls when completed", () => {
    const { db, engine } = createEngine();
    engine.processEvent(toolPending({ created_at_ms: 7_000 }));

    engine.processEvent(toolCompleted({ created_at_ms: 8_250, duration_ms: 1_250, title: "done" }));

    expect(db.query("SELECT status, completed_at_ms, duration_ms, title, error_message FROM tool_calls WHERE call_id = ?").get("call_1")).toEqual({
      status: "completed",
      completed_at_ms: 8_250,
      duration_ms: 1_250,
      title: "done",
      error_message: null,
    });
  });

  it("preserves explicit zero duration when completing a pending call", () => {
    const { db, engine } = createEngine();
    engine.processEvent(toolPending({ created_at_ms: 7_000 }));

    engine.processEvent(toolCompleted({ created_at_ms: 8_250, duration_ms: 0 }));

    expect(db.query("SELECT duration_ms FROM tool_calls WHERE call_id = ?").get("call_1")).toEqual({
      duration_ms: 0,
    });
  });

  it("updates pending calls when failed", () => {
    const { db, engine } = createEngine();
    engine.processEvent(toolPending({ created_at_ms: 7_000 }));

    engine.processEvent(toolFailed({ created_at_ms: 8_500, duration_ms: 1_500, error_message: "boom" }));

    expect(db.query("SELECT status, completed_at_ms, duration_ms, title, error_message FROM tool_calls WHERE call_id = ?").get("call_1")).toEqual({
      status: "error",
      completed_at_ms: 8_500,
      duration_ms: 1_500,
      title: null,
      error_message: "boom",
    });
  });

  it("creates a completed row when the pending event was missed", () => {
    const { db, engine } = createEngine();

    engine.processEvent(toolCompleted({ call_id: "call_late", created_at_ms: 9_000, duration_ms: 0 }));

    expect(db.query("SELECT status, started_at_ms, completed_at_ms, duration_ms FROM tool_calls WHERE call_id = ?").get("call_late")).toEqual({
      status: "completed",
      started_at_ms: 9_000,
      completed_at_ms: 9_000,
      duration_ms: null,
    });
  });
});
