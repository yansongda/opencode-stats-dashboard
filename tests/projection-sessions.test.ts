/**
 * SessionProjectionHandler tests — TDD RED phase.
 *
 * Covers:
 *  - session.created: create session record
 *  - session.deleted: update status
 *  - message.updated: update token/message stats, model_usage
 *  - tool.execute.before / tool.execute.after: update tool stats
 *  - file.edited: update file stats
 *  - session.error: update error count
 *  - agent.started / agent.completed: update agent_usage
 *  - JSON field structure validation (model_usage, agent_usage)
 *  - primary_model / primary_agent calculation
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations } from "../src/db/schema"
import { ProjectionEngine } from "../src/projection/engine"
import { createSessionProjectionHandler } from "../src/projection/sessions"
import type { IngestEventEnvelope, ModelUsage, AgentUsage } from "../src/types"

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
    tokens: 0,
    cost_usd: 0,
    tool: null,
    status: null,
    summary: null,
    deleted: false,
    metadata: {},
    ...overrides,
  }
}

/** Query projection_sessions row by session_id */
function getSession(
  db: Database,
  sessionId: string
): Record<string, unknown> | null {
  return (
    (db
      .query("SELECT * FROM projection_sessions WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown>) ?? null
  )
}

/** Parse JSON field from a session row, returning null if absent */
function parseJsonField<T>(row: Record<string, unknown>, field: string): T | null {
  const val = row[field]
  if (val === null || val === undefined) return null
  return JSON.parse(val as string) as T
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SessionProjectionHandler", () => {
  let db: Database
  let engine: ProjectionEngine

  beforeEach(() => {
    db = createTestDb()
    engine = new ProjectionEngine(db)
    engine.registerHandler("sessions", createSessionProjectionHandler())
  })

  // =========================================================================
  // session.created
  // =========================================================================

  describe("session.created", () => {
    it("creates a session record with session_id, project_path, title", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          metadata: { title: "My Session" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row).not.toBeNull()
      expect(row!.session_id).toBe("ses_001")
      expect(row!.project_path).toBe("/test/project")
      expect(row!.title).toBe("My Session")
    })

    it("sets first_event_at and last_event_at to event timestamp", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          timestamp_ms: 1717400000000,
          metadata: { title: "T" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.first_event_at).toBe(1717400000000)
      expect(row!.last_event_at).toBe(1717400000000)
    })

    it("sets status to active", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.status).toBe("active")
    })

    it("initializes model_usage as empty JSON object", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<ModelUsage>(row!, "model_usage")
      expect(usage).toEqual({})
    })

    it("initializes agent_usage as empty JSON object", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<AgentUsage>(row!, "agent_usage")
      expect(usage).toEqual({})
    })

    it("initializes event_count to 1", () => {
      engine.processEvent(
        makeEvent({
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.event_count).toBe(1)
    })
  })

  // =========================================================================
  // session.deleted
  // =========================================================================

  describe("session.deleted", () => {
    it("updates status to deleted", () => {
      // Create session first
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      // Delete session
      engine.processEvent(
        makeEvent({
          event_id: "evt_delete",
          event_type: "session.deleted",
          deleted: true,
          timestamp_ms: 1717400060000,
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.status).toBe("deleted")
    })

    it("sets deleted_at timestamp", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_delete",
          event_type: "session.deleted",
          timestamp_ms: 1717400060000,
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.deleted_at).toBe(1717400060000)
    })

    it("increments event_count", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_delete",
          event_type: "session.deleted",
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.event_count).toBe(2)
    })
  })

  // =========================================================================
  // message.updated
  // =========================================================================

  describe("message.updated", () => {
    it("increments user_message_count for user role", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          metadata: { message_id: "msg_001", role: "user" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.user_message_count).toBe(1)
      expect(row!.assistant_message_count).toBe(0)
    })

    it("increments assistant_message_count for assistant role", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 0, write: 0 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.assistant_message_count).toBe(1)
      expect(row!.user_message_count).toBe(0)
    })

    it("updates token statistics from event", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.total_tokens).toBe(500)
      expect(row!.input_tokens).toBe(300)
      expect(row!.output_tokens).toBe(150)
      expect(row!.reasoning_tokens).toBe(50)
      expect(row!.cache_read).toBe(10)
      expect(row!.cache_write).toBe(5)
      expect(row!.total_cost_usd).toBe(0.005)
    })

    it("accumulates token statistics across multiple messages", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg2",
          event_type: "message.updated",
          tokens: 300,
          cost_usd: 0.003,
          metadata: {
            message_id: "msg_002",
            role: "assistant",
            tokens: {
              input: 200,
              output: 100,
              reasoning: 0,
              cache: { read: 5, write: 0 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.total_tokens).toBe(800)
      expect(row!.input_tokens).toBe(500)
      expect(row!.output_tokens).toBe(250)
      expect(row!.reasoning_tokens).toBe(50)
      expect(row!.cache_read).toBe(15)
      expect(row!.cache_write).toBe(5)
      expect(row!.total_cost_usd).toBeCloseTo(0.008)
    })

    it("updates model_usage JSON for assistant messages", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<ModelUsage>(row!, "model_usage")
      expect(usage).not.toBeNull()
      expect(usage!["claude-sonnet-4-20250514"]).toBeDefined()
      expect(usage!["claude-sonnet-4-20250514"]!.message_count).toBe(1)
      expect(usage!["claude-sonnet-4-20250514"]!.tokens.input).toBe(300)
      expect(usage!["claude-sonnet-4-20250514"]!.tokens.output).toBe(150)
      expect(usage!["claude-sonnet-4-20250514"]!.tokens.reasoning).toBe(50)
      expect(usage!["claude-sonnet-4-20250514"]!.cost_usd).toBe(0.005)
    })

    it("accumulates model_usage across messages from same model", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg2",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 300,
          cost_usd: 0.003,
          metadata: {
            message_id: "msg_002",
            role: "assistant",
            tokens: {
              input: 200,
              output: 100,
              reasoning: 0,
              cache: { read: 5, write: 0 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<ModelUsage>(row!, "model_usage")
      expect(usage!["claude-sonnet-4-20250514"]!.message_count).toBe(2)
      expect(usage!["claude-sonnet-4-20250514"]!.tokens.input).toBe(500)
      expect(usage!["claude-sonnet-4-20250514"]!.tokens.output).toBe(250)
    })

    it("recalculates primary_model as model with highest message_count", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      // 2 messages from claude-sonnet
      for (let i = 0; i < 2; i++) {
        engine.processEvent(
          makeEvent({
            event_id: `evt_sonnet_${i}`,
            event_type: "message.updated",
            model: "claude-sonnet-4-20250514",
            tokens: 100,
            cost_usd: 0.001,
            metadata: {
              message_id: `msg_sonnet_${i}`,
              role: "assistant",
              tokens: {
                input: 60,
                output: 30,
                reasoning: 10,
                cache: { read: 0, write: 0 },
              },
            },
          })
        )
      }

      // 1 message from gpt-4o
      engine.processEvent(
        makeEvent({
          event_id: "evt_gpt",
          event_type: "message.updated",
          model: "gpt-4o",
          tokens: 200,
          cost_usd: 0.002,
          metadata: {
            message_id: "msg_gpt",
            role: "assistant",
            tokens: {
              input: 100,
              output: 100,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.primary_model).toBe("claude-sonnet-4-20250514")
    })

    it("updates last_event_at on each message event", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          timestamp_ms: 1717400000000,
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          timestamp_ms: 1717400060000,
          metadata: { message_id: "msg_001", role: "user" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.last_event_at).toBe(1717400060000)
      expect(row!.duration_ms).toBe(60000)
    })
  })

  // =========================================================================
  // tool events
  // =========================================================================

  describe("tool events", () => {
    it("increments tool_call_count on tool.execute.before", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_tool1",
          event_type: "tool.execute.before",
          tool: "bash",
          metadata: { tool_name: "bash", call_id: "call_001" },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.tool_call_count).toBe(1)
    })

    it("increments tool_error_count on tool.execute.after with error status", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_tool_err",
          event_type: "tool.execute.after",
          tool: "bash",
          status: "failed",
          metadata: {
            tool_name: "bash",
            call_id: "call_001",
            status: "error",
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.tool_error_count).toBe(1)
    })

    it("does not increment tool_error_count on completed status", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_tool_ok",
          event_type: "tool.execute.after",
          tool: "bash",
          status: "completed",
          metadata: {
            tool_name: "bash",
            call_id: "call_001",
            status: "completed",
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.tool_error_count).toBe(0)
    })
  })

  // =========================================================================
  // file.edited
  // =========================================================================

  describe("file.edited", () => {
    it("increments files_edited count", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_file1",
          event_type: "file.edited",
          metadata: {
            file_path: "/test/file.ts",
            additions: 10,
            deletions: 5,
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.files_edited).toBe(1)
    })

    it("adds to lines_added and lines_deleted", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_file1",
          event_type: "file.edited",
          metadata: {
            file_path: "/test/file.ts",
            additions: 10,
            deletions: 5,
          },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_file2",
          event_type: "file.edited",
          metadata: {
            file_path: "/test/other.ts",
            additions: 20,
            deletions: 3,
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.files_edited).toBe(2)
      expect(row!.lines_added).toBe(30)
      expect(row!.lines_deleted).toBe(8)
    })
  })

  // =========================================================================
  // session.error
  // =========================================================================

  describe("session.error", () => {
    it("increments error_count", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_err1",
          event_type: "session.error",
          metadata: {
            error_type: "timeout",
            error_message: "Request timed out",
          },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_err2",
          event_type: "session.error",
          metadata: {
            error_type: "rate_limit",
            error_message: "Rate limit exceeded",
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.error_count).toBe(2)
    })
  })

  // =========================================================================
  // agent events
  // =========================================================================

  describe("agent events", () => {
    it("updates agent_usage on agent.completed", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_agent1",
          event_type: "agent.completed",
          model: "claude-sonnet-4-20250514",
          tokens: 1000,
          cost_usd: 0.01,
          metadata: {
            agent_name: "build",
            tokens: {
              input: 600,
              output: 300,
              reasoning: 100,
              cache: { read: 50, write: 20 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<AgentUsage>(row!, "agent_usage")
      expect(usage).not.toBeNull()
      expect(usage!["build"]).toBeDefined()
      expect(usage!["build"]!.message_count).toBe(1)
      expect(usage!["build"]!.tokens.input).toBe(600)
      expect(usage!["build"]!.cost_usd).toBe(0.01)
    })

    it("recalculates primary_agent as agent with highest message_count", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      // 2 completions from build agent
      for (let i = 0; i < 2; i++) {
        engine.processEvent(
          makeEvent({
            event_id: `evt_build_${i}`,
            event_type: "agent.completed",
            tokens: 500,
            cost_usd: 0.005,
            metadata: {
              agent_name: "build",
              tokens: {
                input: 300,
                output: 200,
                reasoning: 0,
                cache: { read: 0, write: 0 },
              },
            },
          })
        )
      }

      // 1 completion from plan agent
      engine.processEvent(
        makeEvent({
          event_id: "evt_plan",
          event_type: "agent.completed",
          tokens: 200,
          cost_usd: 0.002,
          metadata: {
            agent_name: "plan",
            tokens: {
              input: 100,
              output: 100,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.primary_agent).toBe("build")
    })
  })

  // =========================================================================
  // JSON field structure validation
  // =========================================================================

  describe("JSON field structure", () => {
    it("model_usage has correct structure with tokens breakdown", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_msg1",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            message_id: "msg_001",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<Record<string, unknown>>(row!, "model_usage")

      // Validate structure: { model_name: { message_count, tokens: { input, output, reasoning, cache: { read, write } }, cost_usd } }
      expect(usage).not.toBeNull()
      const entry = usage!["claude-sonnet-4-20250514"] as Record<string, unknown>
      expect(entry).toBeDefined()
      expect(typeof entry.message_count).toBe("number")
      expect(typeof entry.cost_usd).toBe("number")

      const tokens = entry.tokens as Record<string, unknown>
      expect(typeof tokens.input).toBe("number")
      expect(typeof tokens.output).toBe("number")
      expect(typeof tokens.reasoning).toBe("number")

      const cache = tokens.cache as Record<string, unknown>
      expect(typeof cache.read).toBe("number")
      expect(typeof cache.write).toBe("number")
    })

    it("agent_usage has correct structure", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          metadata: { title: "T" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_agent1",
          event_type: "agent.completed",
          tokens: 1000,
          cost_usd: 0.01,
          metadata: {
            agent_name: "build",
            tokens: {
              input: 600,
              output: 300,
              reasoning: 100,
              cache: { read: 50, write: 20 },
            },
          },
        })
      )

      const row = getSession(db, "ses_001")
      const usage = parseJsonField<Record<string, unknown>>(row!, "agent_usage")

      expect(usage).not.toBeNull()
      const entry = usage!["build"] as Record<string, unknown>
      expect(entry).toBeDefined()
      expect(typeof entry.message_count).toBe("number")
      expect(typeof entry.cost_usd).toBe("number")

      const tokens = entry.tokens as Record<string, unknown>
      expect(typeof tokens.input).toBe("number")
      expect(typeof tokens.output).toBe("number")
      expect(typeof tokens.reasoning).toBe("number")

      const cache = tokens.cache as Record<string, unknown>
      expect(typeof cache.read).toBe("number")
      expect(typeof cache.write).toBe("number")
    })
  })

  // =========================================================================
  // Integration with ProjectionEngine
  // =========================================================================

  describe("integration with ProjectionEngine", () => {
    it("handles full session lifecycle", () => {
      // Create
      engine.processEvent(
        makeEvent({
          event_id: "evt_create",
          event_type: "session.created",
          timestamp_ms: 1717400000000,
          metadata: { title: "Full Lifecycle" },
        })
      )

      // User message
      engine.processEvent(
        makeEvent({
          event_id: "evt_user_msg",
          event_type: "message.updated",
          timestamp_ms: 1717400010000,
          metadata: { message_id: "msg_001", role: "user" },
        })
      )

      // Assistant message
      engine.processEvent(
        makeEvent({
          event_id: "evt_asst_msg",
          event_type: "message.updated",
          model: "claude-sonnet-4-20250514",
          tokens: 500,
          cost_usd: 0.005,
          timestamp_ms: 1717400020000,
          metadata: {
            message_id: "msg_002",
            role: "assistant",
            tokens: {
              input: 300,
              output: 150,
              reasoning: 50,
              cache: { read: 10, write: 5 },
            },
          },
        })
      )

      // Tool call
      engine.processEvent(
        makeEvent({
          event_id: "evt_tool",
          event_type: "tool.execute.before",
          tool: "bash",
          timestamp_ms: 1717400030000,
          metadata: { tool_name: "bash", call_id: "call_001" },
        })
      )

      // File edit
      engine.processEvent(
        makeEvent({
          event_id: "evt_file",
          event_type: "file.edited",
          timestamp_ms: 1717400040000,
          metadata: {
            file_path: "/test/file.ts",
            additions: 10,
            deletions: 5,
          },
        })
      )

      // Agent completed
      engine.processEvent(
        makeEvent({
          event_id: "evt_agent",
          event_type: "agent.completed",
          tokens: 200,
          cost_usd: 0.002,
          timestamp_ms: 1717400050000,
          metadata: {
            agent_name: "build",
            tokens: {
              input: 100,
              output: 80,
              reasoning: 20,
              cache: { read: 5, write: 2 },
            },
          },
        })
      )

      // Delete
      engine.processEvent(
        makeEvent({
          event_id: "evt_delete",
          event_type: "session.deleted",
          timestamp_ms: 1717400060000,
        })
      )

      const row = getSession(db, "ses_001")
      expect(row!.status).toBe("deleted")
      expect(row!.user_message_count).toBe(1)
      expect(row!.assistant_message_count).toBe(1)
      expect(row!.total_tokens).toBe(700) // 500 from message + 200 from agent
      expect(row!.tool_call_count).toBe(1)
      expect(row!.files_edited).toBe(1)
      expect(row!.lines_added).toBe(10)
      expect(row!.lines_deleted).toBe(5)
      expect(row!.event_count).toBe(7)
      expect(row!.first_event_at).toBe(1717400000000)
      expect(row!.last_event_at).toBe(1717400060000)
      expect(row!.duration_ms).toBe(60000)
    })

    it("skips events for non-existent sessions (except session.created)", () => {
      // Try to update a session that doesn't exist
      engine.processEvent(
        makeEvent({
          event_id: "evt_orphan",
          event_type: "message.updated",
          session_id: "ses_nonexistent",
          metadata: { message_id: "msg_001", role: "user" },
        })
      )

      const row = getSession(db, "ses_nonexistent")
      expect(row).toBeNull()
    })
  })
})
