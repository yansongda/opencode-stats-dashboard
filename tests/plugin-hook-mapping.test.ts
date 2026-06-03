/**
 * Tests for buildSdkEnvelope — SDK Event → IngestEventEnvelope mapping.
 *
 * These tests enforce the correct mapping between OpenCode SDK runtime
 * events and our ingest envelope format. They catch regressions in:
 *   - session.idle must NOT map to session.deleted
 *   - session.created/deleted must use info.directory for project_path
 *   - message.part.updated must be ignored (no cost/token data)
 *   - message.updated must extract AssistantMessage.cost and tokens
 */

import { describe, test, expect } from "bun:test"
import { buildSdkEnvelope } from "../src/events/mapper"
import type { Event } from "@opencode-ai/sdk"

// ---------------------------------------------------------------------------
// Test fixtures — minimal SDK Event shapes
// ---------------------------------------------------------------------------

function sdkSessionCreated(overrides?: Partial<Event>): Event {
  return {
    id: "evt_sdk_001",
    type: "session.created",
    properties: {
      sessionID: "ses_sdk_001",
      info: {
        id: "ses_sdk_001",
        directory: "/tmp/test-project",
        title: "Test Session",
        version: "1.0.0",
        slug: "test",
        projectID: "proj_001",
        time: { created: 1717400000, updated: 1717400000 },
      },
    },
    ...overrides,
  } as unknown as Event
}

function sdkSessionDeleted(): Event {
  return {
    id: "evt_sdk_002",
    type: "session.deleted",
    properties: {
      sessionID: "ses_sdk_001",
      info: {
        id: "ses_sdk_001",
        directory: "/tmp/test-project",
        title: "Test Session",
        version: "1.0.0",
        slug: "test",
        projectID: "proj_001",
        summary: { additions: 10, deletions: 5, files: 3 },
        time: { created: 1717400000, updated: 1717400100 },
      },
    },
  } as unknown as Event
}

function sdkSessionIdle(): Event {
  return {
    id: "evt_sdk_003",
    type: "session.idle",
    properties: {
      sessionID: "ses_sdk_001",
    },
  } as unknown as Event
}

function sdkMessageUpdatedAssistant(): Event {
  return {
    id: "evt_sdk_004",
    type: "message.updated",
    properties: {
      sessionID: "ses_sdk_001",
      info: {
        id: "msg_001",
        sessionID: "ses_sdk_001",
        role: "assistant",
        modelID: "claude-sonnet-4-20250514",
        cost: 0.015,
        tokens: {
          input: 800,
          output: 400,
          reasoning: 0,
          total: 1200,
        },
      },
    },
  } as unknown as Event
}

function sdkMessageUpdatedUser(): Event {
  return {
    id: "evt_sdk_005",
    type: "message.updated",
    properties: {
      sessionID: "ses_sdk_001",
      info: {
        id: "msg_002",
        sessionID: "ses_sdk_001",
        role: "user",
      },
    },
  } as unknown as Event
}

function sdkMessagePartUpdated(): Event {
  return {
    id: "evt_sdk_006",
    type: "message.part.updated",
    properties: {
      sessionID: "ses_sdk_001",
      part: {
        id: "part_001",
        messageID: "msg_001",
        type: "text",
        text: "Hello world",
      },
      time: 1717400050,
    },
  } as unknown as Event
}

function sdkUnknownEvent(): Event {
  return {
    id: "evt_sdk_099",
    type: "session.updated",
    properties: {},
  } as unknown as Event
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSdkEnvelope", () => {
  describe("session.created", () => {
    test("maps sessionID to session_id", () => {
      const result = buildSdkEnvelope(sdkSessionCreated())
      expect(result).not.toBeNull()
      expect(result!.session_id).toBe("ses_sdk_001")
    })

    test("maps info.directory to project_path", () => {
      const result = buildSdkEnvelope(sdkSessionCreated())
      expect(result).not.toBeNull()
      expect(result!.project_path).toBe("/tmp/test-project")
    })

    test("sets event_type to session.created", () => {
      const result = buildSdkEnvelope(sdkSessionCreated())
      expect(result).not.toBeNull()
      expect(result!.event_type).toBe("session.created")
    })

    test("sets deleted to false", () => {
      const result = buildSdkEnvelope(sdkSessionCreated())
      expect(result).not.toBeNull()
      expect(result!.deleted).toBe(false)
    })

    test("preserves title and version in metadata", () => {
      const result = buildSdkEnvelope(sdkSessionCreated())
      expect(result).not.toBeNull()
      expect(result!.metadata.title).toBe("Test Session")
      expect(result!.metadata.version).toBe("1.0.0")
    })
  })

  describe("session.deleted", () => {
    test("sets deleted to true", () => {
      const result = buildSdkEnvelope(sdkSessionDeleted())
      expect(result).not.toBeNull()
      expect(result!.deleted).toBe(true)
    })

    test("maps info.directory to project_path", () => {
      const result = buildSdkEnvelope(sdkSessionDeleted())
      expect(result).not.toBeNull()
      expect(result!.project_path).toBe("/tmp/test-project")
    })

    test("preserves summary metadata (additions/deletions/files)", () => {
      const result = buildSdkEnvelope(sdkSessionDeleted())
      expect(result).not.toBeNull()
      expect(result!.metadata.additions).toBe(10)
      expect(result!.metadata.deletions).toBe(5)
      expect(result!.metadata.files).toBe(3)
    })

    test("sets summary to session title", () => {
      const result = buildSdkEnvelope(sdkSessionDeleted())
      expect(result).not.toBeNull()
      expect(result!.summary).toBe("Test Session")
    })
  })

  describe("session.idle", () => {
    test("must NOT map to session.deleted", () => {
      const result = buildSdkEnvelope(sdkSessionIdle())
      // session.idle is a heartbeat, not a delete event
      if (result !== null) {
        expect(result.event_type).not.toBe("session.deleted")
      }
    })

    test("returns null — idle events are not ingested", () => {
      const result = buildSdkEnvelope(sdkSessionIdle())
      expect(result).toBeNull()
    })
  })

  describe("message.updated", () => {
    test("extracts cost from AssistantMessage.cost", () => {
      const result = buildSdkEnvelope(sdkMessageUpdatedAssistant())
      expect(result).not.toBeNull()
      expect(result!.event_type).toBe("usage.updated")
      expect(result!.cost_usd).toBe(0.015)
    })

    test("extracts total tokens from AssistantMessage.tokens.total", () => {
      const result = buildSdkEnvelope(sdkMessageUpdatedAssistant())
      expect(result).not.toBeNull()
      expect(result!.tokens).toBe(1200)
    })

    test("extracts model from AssistantMessage.modelID", () => {
      const result = buildSdkEnvelope(sdkMessageUpdatedAssistant())
      expect(result).not.toBeNull()
      expect(result!.model).toBe("claude-sonnet-4-20250514")
    })

    test("preserves token breakdown in metadata", () => {
      const result = buildSdkEnvelope(sdkMessageUpdatedAssistant())
      expect(result).not.toBeNull()
      expect(result!.metadata.input_tokens).toBe(800)
      expect(result!.metadata.output_tokens).toBe(400)
      expect(result!.metadata.reasoning_tokens).toBe(0)
      expect(result!.metadata.message_id).toBe("msg_001")
    })

    test("ignores non-assistant messages (user role)", () => {
      const result = buildSdkEnvelope(sdkMessageUpdatedUser())
      expect(result).toBeNull()
    })
  })

  describe("message.part.updated", () => {
    test("returns null — part updates are not ingested", () => {
      const result = buildSdkEnvelope(sdkMessagePartUpdated())
      expect(result).toBeNull()
    })
  })

  describe("unknown events", () => {
    test("returns null for unrecognized event types", () => {
      const result = buildSdkEnvelope(sdkUnknownEvent())
      expect(result).toBeNull()
    })
  })
})
