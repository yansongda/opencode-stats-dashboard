import { describe, test, expect } from "bun:test"
import {
  mapOpenCodeEvent,
  generateEventId,
  sanitizeMetadata,
} from "../src/events/mapper"
import type { RawOpenCodeEvent } from "../src/events/mapper"
import { FORBIDDEN_METADATA_KEYS } from "../src/types"

// ---------------------------------------------------------------------------
// Fixtures — minimal raw OpenCode events
// ---------------------------------------------------------------------------

function sessionCreatedRaw(): RawOpenCodeEvent {
  return {
    event_type: "session.created",
    session_id: "ses_test_001",
    project_path: "/tmp/my-project",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    metadata: {},
  }
}

function toolCompletedRaw(): RawOpenCodeEvent {
  return {
    event_type: "tool.completed",
    session_id: "ses_test_001",
    project_path: "/tmp/my-project",
    timestamp_ms: 1717400060000,
    model: "claude-sonnet-4-20250514",
    tokens: 350,
    cost_usd: 0.0018,
    tool: "bash",
    status: "completed",
    summary: "执行命令: npm install",
    metadata: {
      call_id: "call_001",
      exit_code: 0,
      duration_ms: 10000,
      // forbidden — must be stripped
      tool_input: "rm -rf /",
      tool_output: "deleted everything",
      message_body: "secret message",
    },
  }
}

function sessionDeletedRaw(): RawOpenCodeEvent {
  return {
    event_type: "session.deleted",
    session_id: "ses_test_001",
    project_path: "/tmp/my-project",
    timestamp_ms: 1717400100000,
    model: "claude-sonnet-4-20250514",
    tokens: 2500,
    cost_usd: 0.0125,
    summary: "实现用户认证功能",
    deleted: true,
    metadata: {
      files_changed: 5,
      additions: 150,
      deletions: 30,
    },
  }
}

// ---------------------------------------------------------------------------
// generateEventId
// ---------------------------------------------------------------------------

describe("generateEventId", () => {
  test("returns a string starting with 'evt-'", () => {
    const id = generateEventId("ses_001", 1000, "session.created")
    expect(id).toStartWith("evt-")
  })

  test("produces a UUID-like format (evt-8-4-4-4-12)", () => {
    const id = generateEventId("ses_001", 1000, "session.created")
    // evt-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id).toMatch(
      /^evt-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  test("same inputs produce identical event_id (deterministic)", () => {
    const a = generateEventId("ses_001", 1000, "session.created")
    const b = generateEventId("ses_001", 1000, "session.created")
    expect(a).toBe(b)
  })

  test("different sessions produce different event_ids", () => {
    const a = generateEventId("ses_001", 1000, "session.created")
    const b = generateEventId("ses_002", 1000, "session.created")
    expect(a).not.toBe(b)
  })

  test("different timestamps produce different event_ids", () => {
    const a = generateEventId("ses_001", 1000, "session.created")
    const b = generateEventId("ses_001", 2000, "session.created")
    expect(a).not.toBe(b)
  })

  test("different event types produce different event_ids", () => {
    const a = generateEventId("ses_001", 1000, "session.created")
    const b = generateEventId("ses_001", 1000, "session.deleted")
    expect(a).not.toBe(b)
  })
})

// ---------------------------------------------------------------------------
// sanitizeMetadata
// ---------------------------------------------------------------------------

describe("sanitizeMetadata", () => {
  test("preserves allowed keys", () => {
    const result = sanitizeMetadata({
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
      const result = sanitizeMetadata({
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
    expect(sanitizeMetadata(allForbidden)).toEqual({})
  })

  test("returns empty object for empty input", () => {
    expect(sanitizeMetadata({})).toEqual({})
  })
})

// ---------------------------------------------------------------------------
// mapOpenCodeEvent
// ---------------------------------------------------------------------------

describe("mapOpenCodeEvent", () => {
  test("mapped event has event_id and event_type", () => {
    const result = mapOpenCodeEvent(sessionCreatedRaw())
    expect(result.event_id).toBeDefined()
    expect(result.event_id).toStartWith("evt-")
    expect(result.event_type).toBe("session.created")
  })

  test("session.created event has null tool/status", () => {
    const result = mapOpenCodeEvent(sessionCreatedRaw())
    expect(result.tool).toBeNull()
    expect(result.status).toBeNull()
    expect(result.deleted).toBe(false)
    expect(result.tokens).toBe(0)
    expect(result.cost_usd).toBe(0)
  })

  test("tool.completed event preserves tool and status", () => {
    const result = mapOpenCodeEvent(toolCompletedRaw())
    expect(result.tool).toBe("bash")
    expect(result.status).toBe("completed")
    expect(result.tokens).toBe(350)
    expect(result.cost_usd).toBe(0.0018)
    expect(result.summary).toBe("执行命令: npm install")
  })

  test("tool.completed metadata has no forbidden keys", () => {
    const result = mapOpenCodeEvent(toolCompletedRaw())
    for (const key of FORBIDDEN_METADATA_KEYS) {
      expect(result.metadata).not.toHaveProperty(key)
    }
    // allowed keys should survive
    expect(result.metadata).toHaveProperty("call_id", "call_001")
    expect(result.metadata).toHaveProperty("exit_code", 0)
    expect(result.metadata).toHaveProperty("duration_ms", 10000)
  })

  test("session.deleted has deleted=true", () => {
    const result = mapOpenCodeEvent(sessionDeletedRaw())
    expect(result.deleted).toBe(true)
    expect(result.event_type).toBe("session.deleted")
    expect(result.tokens).toBe(2500)
    expect(result.cost_usd).toBe(0.0125)
  })

  test("default model is 'unknown' when omitted", () => {
    const raw: RawOpenCodeEvent = {
      event_type: "session.created",
      session_id: "ses_002",
      project_path: "/tmp",
      timestamp_ms: 9999,
    }
    const result = mapOpenCodeEvent(raw)
    expect(result.model).toBe("unknown")
    expect(result.tokens).toBe(0)
    expect(result.cost_usd).toBe(0)
    expect(result.metadata).toEqual({})
  })

  test("same raw event always produces same event_id", () => {
    const raw = sessionCreatedRaw()
    const a = mapOpenCodeEvent(raw)
    const b = mapOpenCodeEvent(raw)
    expect(a.event_id).toBe(b.event_id)
  })

  test("mapped event has all required IngestEventEnvelope fields", () => {
    const result = mapOpenCodeEvent(toolCompletedRaw())
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
