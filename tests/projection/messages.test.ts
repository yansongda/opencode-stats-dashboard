import { describe, expect, it } from "bun:test";
import { ProjectionEngine } from "../../src/projection/engine";
import { messagesHandler } from "../../src/projection/messages";
import { createTestDb } from "../helpers/db";
import { assistantMessage, userMessage } from "../helpers/stats-events";

function createEngine() {
  const db = createTestDb();
  const engine = new ProjectionEngine(db);
  engine.registerHandler("messages", messagesHandler);
  return { db, engine };
}

describe("messages projection handler", () => {
  it("declares user and assistant message events", () => {
    expect(messagesHandler.handles).toEqual(["message.updated.user", "message.updated.assistant"]);
  });

  it("inserts user message code-change metrics", () => {
    const { db, engine } = createEngine();

    engine.processEvent(userMessage());

    expect(db.query("SELECT message_id, role, model, agent, lines_added, lines_deleted, files_changed, total_tokens, cost_usd FROM messages WHERE message_id = ?").get("msg_user_1")).toEqual({
      message_id: "msg_user_1",
      role: "user",
      model: null,
      agent: "coder",
      lines_added: 7,
      lines_deleted: 2,
      files_changed: 3,
      total_tokens: 0,
      cost_usd: 0,
    });
  });

  it("inserts assistant token and cost metrics", () => {
    const { db, engine } = createEngine();

    engine.processEvent(assistantMessage());

    expect(db.query("SELECT model, role, input_tokens, output_tokens, reasoning_tokens, cache_read, cache_write, total_tokens, cost_usd, completed_at_ms, duration_ms, finish_reason, has_error FROM messages WHERE message_id = ?").get("msg_assistant_1")).toEqual({
      model: "provider/model",
      role: "assistant",
      input_tokens: 10,
      output_tokens: 20,
      reasoning_tokens: 3,
      cache_read: 4,
      cache_write: 5,
      total_tokens: 42,
      cost_usd: 0.12,
      completed_at_ms: 6_900,
      duration_ms: 900,
      finish_reason: "stop",
      has_error: 0,
    });
  });

  it("does not let stale events overwrite newer message metrics", () => {
    const { db, engine } = createEngine();
    engine.processEvent(userMessage({ message_id: "msg_stale", event_id: "evt_new", created_at_ms: 2_000, lines_added: 10 }));

    engine.processEvent(userMessage({ message_id: "msg_stale", event_id: "evt_old", created_at_ms: 1_000, lines_added: 99 }));

    expect(db.query("SELECT event_id, lines_added, created_at_ms FROM messages WHERE message_id = ?").get("msg_stale")).toEqual({
      event_id: "evt_new",
      lines_added: 10,
      created_at_ms: 2_000,
    });
  });

  it("updates mutable metrics when the incoming event is newer", () => {
    const { db, engine } = createEngine();
    engine.processEvent(userMessage({ message_id: "msg_update", event_id: "evt_old", created_at_ms: 1_000, lines_added: 1 }));

    engine.processEvent(userMessage({ message_id: "msg_update", event_id: "evt_new", created_at_ms: 2_000, lines_added: 5 }));

    expect(db.query("SELECT event_id, lines_added, created_at_ms FROM messages WHERE message_id = ?").get("msg_update")).toEqual({
      event_id: "evt_old",
      lines_added: 5,
      created_at_ms: 1_000,
    });
  });

  it("skips assistant messages without a model", () => {
    const { db, engine } = createEngine();

    engine.processEvent(assistantMessage({ message_id: "msg_no_model", model: "" }));

    expect(db.query("SELECT COUNT(*) AS count FROM messages WHERE message_id = ?").get("msg_no_model")).toEqual({ count: 0 });
  });
});
