import { describe, expect, it } from "bun:test";
import { EventStore } from "../../src/store/event";
import { createTestDb } from "../helpers/db";
import { assistantMessage, sessionCreated, sessionError, userMessage } from "../helpers/stats-events";

describe("EventStore", () => {
  it("inserts and retrieves an event by id", () => {
    const store = new EventStore(createTestDb());
    const event = sessionCreated();

    expect(store.insertEvent(event)).toBe(true);
    const row = store.getEventById(event.event_id);

    expect(row?.event_id).toBe(event.event_id);
    expect(row?.event_type).toBe("session.created");
    expect(row?.session_id).toBe(event.session_id);
    expect(JSON.parse(row?.event_contents ?? "{}")).toEqual({
      session_id: event.session_id,
      project_path: event.project_path,
      title: event.title,
    });
  });

  it("ignores duplicate event ids", () => {
    const store = new EventStore(createTestDb());
    const event = sessionCreated();

    expect(store.insertEvent(event)).toBe(true);
    expect(store.insertEvent(event)).toBe(false);
    expect(store.countEvents()).toBe(1);
  });

  it("inserts batches transactionally and counts inserted rows", () => {
    const store = new EventStore(createTestDb());

    expect(store.insertEvents([sessionCreated(), userMessage(), assistantMessage()])).toBe(3);
    expect(store.insertEvents([sessionCreated(), sessionError()])).toBe(1);
    expect(store.countEvents()).toBe(4);
  });

  it("filters events by session, type and time range", () => {
    const store = new EventStore(createTestDb());
    store.insertEvents([
      sessionCreated({ session_id: "ses_a", created_at_ms: 1_000 }),
      userMessage({ session_id: "ses_a", created_at_ms: 2_000 }),
      assistantMessage({ session_id: "ses_b", created_at_ms: 3_000 }),
    ]);

    expect(store.getEvents({ session_id: "ses_a" }).map((row) => row.event_id)).toEqual([
      "evt_session_created",
      "evt_user_message",
    ]);
    expect(store.getEvents({ event_type: "message.updated.assistant" })).toHaveLength(1);
    expect(store.getEvents({ start_ms: 1_500, end_ms: 2_500 })).toHaveLength(1);
  });

  it("orders by created_at_ms and applies limit and offset", () => {
    const store = new EventStore(createTestDb());
    store.insertEvents([
      assistantMessage({ event_id: "evt_3", created_at_ms: 3_000 }),
      sessionCreated({ event_id: "evt_1", created_at_ms: 1_000 }),
      userMessage({ event_id: "evt_2", created_at_ms: 2_000 }),
    ]);

    expect(store.getEvents({ limit: 1, offset: 1 }).map((row) => row.event_id)).toEqual(["evt_2"]);
  });
});
