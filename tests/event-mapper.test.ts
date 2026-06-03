import { describe, test, expect } from "bun:test"
import {
  buildEventId,
  stripSensitiveKeys,
  buildSdkEnvelope,
} from "../src/events/mapper"
import type { Event } from "@opencode-ai/sdk"
import { FORBIDDEN_METADATA_KEYS } from "../src/types"

// ---------------------------------------------------------------------------
// buildEventId
// ---------------------------------------------------------------------------

describe("buildEventId", () => {
  test("returns a string starting with 'evt-'", () => {
    const id = buildEventId("ses_001", 1000, "session.created")
    expect(id).toStartWith("evt-")
  })

  test("produces a UUID-like format (evt-8-4-4-4-12)", () => {
    const id = buildEventId("ses_001", 1000, "session.created")
    expect(id).toMatch(
      /^evt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  test("same inputs produce identical event_id (deterministic)", () => {
    const a = buildEventId("ses_001", 1000, "session.created")
    const b = buildEventId("ses_001", 1000, "session.created")
    expect(a).toBe(b)
  })

  test("different sessions produce different event_ids", () => {
    const a = buildEventId("ses_001", 1000, "session.created")
    const b = buildEventId("ses_002", 1000, "session.created")
    expect(a).not.toBe(b)
  })

  test("different timestamps produce different event_ids", () => {
    const a = buildEventId("ses_001", 1000, "session.created")
    const b = buildEventId("ses_001", 2000, "session.created")
    expect(a).not.toBe(b)
  })

  test("different event types produce different event_ids", () => {
    const a = buildEventId("ses_001", 1000, "session.created")
    const b = buildEventId("ses_001", 1000, "session.deleted")
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// stripSensitiveKeys
// ---------------------------------------------------------------------------

describe("stripSensitiveKeys", () => {
  test("preserves allowed keys", () => {
    const result = stripSensitiveKeys({
      call_id: "call_001",
      exit_code: 0,
      duration_ms: 10000,
    })
    expect(result).toEqual({
      call_id: "call_001",
      exit_code: 0,
      duration_ms: 10000,
    })
  })

  for (const key of FORBIDDEN_METADATA_KEYS) {
    test(`strips forbidden key '${key}'`, () => {
      const result = stripSensitiveKeys({
        safe_key: "value",
        [key]: "should be removed",
      })
      expect(result).not.toHaveProperty(key)
      expect(result).toHaveProperty("safe_key", "value")
    })
  }

  test("returns empty object when all keys are forbidden", () => {
    const allForbidden: Record<string, unknown> = {}
    for (const key of FORBIDDEN_METADATA_KEYS) {
      allForbidden[key] = "bad"
    }
    expect(stripSensitiveKeys(allForbidden)).toEqual({})
  })

  test("returns empty object for empty input", () => {
    expect(stripSensitiveKeys({})).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// buildSdkEnvelope
// ---------------------------------------------------------------------------

describe("buildSdkEnvelope", () => {
  test("session.created produces event_id starting with 'evt-'", () => {
    const event = {
      id: "evt_001",
      type: "session.created",
      properties: {
        sessionID: "ses_001",
        info: { id: "ses_001", directory: "/tmp/proj", title: "Test", version: "1.0" },
      },
    } as unknown as Event
    const result = buildSdkEnvelope(event)
    expect(result).not.toBeNull()
    expect(result!.event_id).toStartWith("evt-")
    expect(result!.event_type).toBe("session.created")
  })

  test("session.created has null tool/status and deleted=false", () => {
    const event = {
      id: "evt_002",
      type: "session.created",
      properties: {
        sessionID: "ses_001",
        info: { id: "ses_001", directory: "/tmp/proj" },
      },
    } as unknown as Event
    const result = buildSdkEnvelope(event)
    expect(result).not.toBeNull()
    expect(result!.tool).toBeNull()
    expect(result!.status).toBeNull()
    expect(result!.deleted).toBe(false)
    expect(result!.tokens).toBe(0)
    expect(result!.cost_usd).toBe(0)
  })

  test("session.deleted has deleted=true", () => {
    const event = {
      id: "evt_003",
      type: "session.deleted",
      properties: {
        sessionID: "ses_001",
        info: {
          id: "ses_001",
          directory: "/tmp/proj",
          title: "Ended",
          summary: { additions: 10, deletions: 5, files: 3 },
        },
      },
    } as unknown as Event
    const result = buildSdkEnvelope(event)
    expect(result).not.toBeNull()
    expect(result!.deleted).toBe(true)
    expect(result!.event_type).toBe("session.deleted")
    expect(result!.summary).toBe("Ended")
  })

  test("message.updated (assistant) extracts cost and tokens", () => {
    const event = {
      id: "evt_004",
      type: "message.updated",
      properties: {
        sessionID: "ses_001",
        info: {
          id: "msg_001",
          role: "assistant",
          modelID: "claude-sonnet-4-20250514",
          cost: 0.015,
          tokens: { input: 800, output: 400, reasoning: 0, total: 1200 },
        },
      },
    } as unknown as Event
    const result = buildSdkEnvelope(event)
    expect(result).not.toBeNull()
    expect(result!.event_type).toBe("usage.updated")
    expect(result!.cost_usd).toBe(0.015)
    expect(result!.tokens).toBe(1200)
    expect(result!.model).toBe("claude-sonnet-4-20250514")
  })

  test("message.updated (user) returns null", () => {
    const event = {
      id: "evt_005",
      type: "message.updated",
      properties: {
        sessionID: "ses_001",
        info: { id: "msg_002", role: "user" },
      },
    } as unknown as Event
    expect(buildSdkEnvelope(event)).toBeNull()
  })

  test("session.idle returns null", () => {
    const event = {
      id: "evt_006",
      type: "session.idle",
      properties: { sessionID: "ses_001" },
    } as unknown as Event
    expect(buildSdkEnvelope(event)).toBeNull()
  })

  test("message.part.updated returns null", () => {
    const event = {
      id: "evt_007",
      type: "message.part.updated",
      properties: {
        sessionID: "ses_001",
        part: { id: "part_001", messageID: "msg_001", type: "text", text: "hi" },
        time: 1717400050,
      },
    } as unknown as Event
    expect(buildSdkEnvelope(event)).toBeNull()
  })

  test("unknown event type returns null", () => {
    const event = {
      id: "evt_099",
      type: "session.updated",
      properties: {},
    } as unknown as Event
    expect(buildSdkEnvelope(event)).toBeNull()
  })

  test("result has all required IngestEventEnvelope fields", () => {
    const event = {
      id: "evt_010",
      type: "session.created",
      properties: {
        sessionID: "ses_001",
        info: { id: "ses_001", directory: "/tmp" },
      },
    } as unknown as Event
    const result = buildSdkEnvelope(event)!
    expect(result).toHaveProperty("event_id")
    expect(result).toHaveProperty("event_type")
    expect(result).toHaveProperty("session_id")
    expect(result).toHaveProperty("project_path")
    expect(result).toHaveProperty("timestamp_ms")
    expect(result).toHaveProperty("model")
    expect(result).toHaveProperty("tokens")
    expect(result).toHaveProperty("cost_usd")
    expect(result).toHaveProperty("tool")
    expect(result).toHaveProperty("status")
    expect(result).toHaveProperty("summary")
    expect(result).toHaveProperty("deleted")
    expect(result).toHaveProperty("metadata")
  })
})
