/**
 * ProjectionEngine tests — TDD RED phase.
 *
 * Covers:
 *  - Event routing (event_type → correct handler)
 *  - Transactional updates (all-or-nothing)
 *  - Idempotency (same event processed twice → same result)
 */

import { describe, it, expect, beforeEach, mock } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations } from "../db/schema"
import { ProjectionEngine } from "./engine"
import type { IngestEventEnvelope } from "../types/events"
import type { ProjectionHandler } from "./handlers/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:")
  runMigrations(db)
  return db
}

function makeEvent(overrides: Partial<IngestEventEnvelope> = {}): IngestEventEnvelope {
  return {
    event_id: "evt_001",
    event_type: "session.created",
    session_id: "ses_001",
    project_path: "/test/project",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    tokens: 100,
    cost_usd: 0.001,
    tool: null,
    status: null,
    summary: "Test event",
    deleted: false,
    metadata: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProjectionEngine", () => {
  let db: Database
  let engine: ProjectionEngine

  beforeEach(() => {
    db = createTestDb()
    engine = new ProjectionEngine(db)
  })

  // =========================================================================
  // Event Routing
  // =========================================================================

  describe("event routing", () => {
    it("routes session.created to session handler", () => {
      const sessionHandler = mock(() => {})
      const messageHandler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created", "session.updated", "session.deleted", "session.error", "session.diff"],
        handle: sessionHandler,
      })

      engine.registerHandler("message", {
        handles: ["message.created", "message.updated", "message.deleted"],
        handle: messageHandler,
      })

      const event = makeEvent({ event_type: "session.created" })
      engine.processEvent(event)

      expect(sessionHandler).toHaveBeenCalledTimes(1)
      expect(messageHandler).toHaveBeenCalledTimes(0)
    })

    it("routes message.updated to message handler", () => {
      const sessionHandler = mock(() => {})
      const messageHandler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created", "session.updated", "session.deleted", "session.error", "session.diff"],
        handle: sessionHandler,
      })

      engine.registerHandler("message", {
        handles: ["message.created", "message.updated", "message.deleted"],
        handle: messageHandler,
      })

      const event = makeEvent({ event_type: "message.updated" })
      engine.processEvent(event)

      expect(sessionHandler).toHaveBeenCalledTimes(0)
      expect(messageHandler).toHaveBeenCalledTimes(1)
    })

    it("routes tool.started to tool handler", () => {
      const toolHandler = mock(() => {})

      engine.registerHandler("tool", {
        handles: ["tool.started", "tool.completed", "tool.failed", "tool.execute.before", "tool.execute.after"],
        handle: toolHandler,
      })

      const event = makeEvent({ event_type: "tool.started" })
      engine.processEvent(event)

      expect(toolHandler).toHaveBeenCalledTimes(1)
    })

    it("ignores events with no registered handler", () => {
      const sessionHandler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: sessionHandler,
      })

      const event = makeEvent({ event_type: "message.updated" })
      engine.processEvent(event)

      expect(sessionHandler).toHaveBeenCalledTimes(0)
    })

    it("routes to multiple handlers when event matches multiple registrations", () => {
      const handler1 = mock(() => {})
      const handler2 = mock(() => {})

      engine.registerHandler("handler1", {
        handles: ["session.created"],
        handle: handler1,
      })

      engine.registerHandler("handler2", {
        handles: ["session.created", "session.updated"],
        handle: handler2,
      })

      const event = makeEvent({ event_type: "session.created" })
      engine.processEvent(event)

      expect(handler1).toHaveBeenCalledTimes(1)
      expect(handler2).toHaveBeenCalledTimes(1)
    })
  })

  // =========================================================================
  // Transactional Updates
  // =========================================================================

  describe("transactional updates", () => {
    it("wraps handler execution in a transaction", () => {
      const calls: string[] = []

      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: (event, txn) => {
          calls.push("handler-start")
          txn.run(
            `INSERT INTO projection_sessions (session_id, project_path, title)
             VALUES (?, ?, ?)`,
            [event.session_id, event.project_path, "Test Session"]
          )
          calls.push("handler-end")
        },
      })

      const event = makeEvent({ event_type: "session.created" })
      engine.processEvent(event)

      expect(calls).toEqual(["handler-start", "handler-end"])

      const row = db
        .query("SELECT session_id, project_path, title FROM projection_sessions WHERE session_id = ?")
        .get("ses_001") as { session_id: string; project_path: string; title: string } | null
      expect(row).not.toBeNull()
      expect(row!.session_id).toBe("ses_001")
      expect(row!.project_path).toBe("/test/project")
      expect(row!.title).toBe("Test Session")
    })

    it("rolls back all changes when handler throws", () => {
      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: (event, txn) => {
          txn.run(
            `INSERT INTO projection_sessions (session_id, project_path, title)
             VALUES (?, ?, ?)`,
            [event.session_id, event.project_path, "Test Session"]
          )
          throw new Error("Handler failed")
        },
      })

      const event = makeEvent({ event_type: "session.created" })
      engine.processEvent(event)

      const row = db
        .query("SELECT COUNT(*) as cnt FROM projection_sessions")
        .get() as { cnt: number }
      expect(row.cnt).toBe(0)
    })

    it("rolls back multi-table updates on failure", () => {
      engine.registerHandler("message", {
        handles: ["message.updated"],
        handle: (event, txn) => {
          txn.run(
            `INSERT INTO projection_sessions (session_id, total_tokens)
             VALUES (?, ?)`,
            [event.session_id, 500]
          )
          txn.run(
            `INSERT INTO projection_daily (date, project_path, model, total_tokens)
             VALUES (?, ?, ?, ?)`,
            ["2026-06-05", event.project_path, event.model, 500]
          )
          throw new Error("Multi-table handler failed")
        },
      })

      const event = makeEvent({ event_type: "message.updated" })
      engine.processEvent(event)

      const sessions = db
        .query("SELECT COUNT(*) as cnt FROM projection_sessions")
        .get() as { cnt: number }
      const daily = db
        .query("SELECT COUNT(*) as cnt FROM projection_daily")
        .get() as { cnt: number }
      expect(sessions.cnt).toBe(0)
      expect(daily.cnt).toBe(0)
    })
  })

  // =========================================================================
  // Idempotency
  // =========================================================================

  describe("idempotency", () => {
    it("skips processing when event_id already processed", () => {
      const handler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: handler,
      })

      const event = makeEvent({ event_id: "evt_idempotent", event_type: "session.created" })

      engine.processEvent(event)
      expect(handler).toHaveBeenCalledTimes(1)

      engine.processEvent(event)
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it("tracks processed event_ids to prevent reprocessing", () => {
      const handler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: handler,
      })

      const event1 = makeEvent({ event_id: "evt_001", event_type: "session.created" })
      const event2 = makeEvent({ event_id: "evt_002", event_type: "session.created" })

      engine.processEvent(event1)
      engine.processEvent(event2)

      expect(handler).toHaveBeenCalledTimes(2)

      engine.processEvent(event1)
      engine.processEvent(event2)

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it("allows different event_ids even with same content", () => {
      const handler = mock(() => {})

      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: handler,
      })

      const event1 = makeEvent({ event_id: "evt_A", session_id: "ses_001" })
      const event2 = makeEvent({ event_id: "evt_B", session_id: "ses_001" })

      engine.processEvent(event1)
      engine.processEvent(event2)

      expect(handler).toHaveBeenCalledTimes(2)
    })
  })

  // =========================================================================
  // Handler Registration
  // =========================================================================

  describe("handler registration", () => {
    it("registers handler with a name", () => {
      const handler: ProjectionHandler = {
        handles: ["session.created"],
        handle: () => {},
      }

      engine.registerHandler("session", handler)
      expect(engine.hasHandler("session")).toBe(true)
    })

    it("throws when registering duplicate handler name", () => {
      const handler: ProjectionHandler = {
        handles: ["session.created"],
        handle: () => {},
      }

      engine.registerHandler("session", handler)
      expect(() => engine.registerHandler("session", handler)).toThrow()
    })

    it("returns registered handler names", () => {
      engine.registerHandler("session", {
        handles: ["session.created"],
        handle: () => {},
      })
      engine.registerHandler("message", {
        handles: ["message.updated"],
        handle: () => {},
      })

      const names = engine.getHandlerNames()
      expect(names).toContain("session")
      expect(names).toContain("message")
      expect(names.length).toBe(2)
    })
  })
})
