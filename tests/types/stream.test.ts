import { describe, expect, it } from "bun:test";
import { isStatsNotification, SSE_EVENT_NAME, SSE_KEEPALIVE } from "../../src/types/stream";

describe("SSE stream types", () => {
  const notification = {
    version: 1,
    event_id: "evt_1",
    event_type: "session.created",
    occurred_at_ms: 1_700_000_000_000,
    occurred_at: "2023-11-14T22:13:20.000Z",
    session_id: "ses_1",
  };

  it("exposes the expected SSE constants", () => {
    expect(SSE_EVENT_NAME).toBe("notification");
    expect(SSE_KEEPALIVE).toBe(": keepalive\n\n");
  });

  it("accepts a valid notification", () => {
    expect(isStatsNotification(notification)).toBe(true);
  });

  it("accepts a valid notification without optional session_id", () => {
    const { session_id: _sessionId, ...withoutSession } = notification;
    expect(isStatsNotification(withoutSession)).toBe(true);
  });

  it("rejects non-objects and missing required fields", () => {
    expect(isStatsNotification(null)).toBe(false);
    expect(isStatsNotification("keepalive")).toBe(false);
    expect(isStatsNotification({})).toBe(false);
  });

  it("rejects wrong field types", () => {
    expect(isStatsNotification({ ...notification, version: 2 })).toBe(false);
    expect(isStatsNotification({ ...notification, event_id: "" })).toBe(false);
    expect(isStatsNotification({ ...notification, occurred_at_ms: Number.NaN })).toBe(false);
    expect(isStatsNotification({ ...notification, session_id: 123 })).toBe(false);
  });
});
