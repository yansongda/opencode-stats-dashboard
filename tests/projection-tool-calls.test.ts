/**
 * projection_tool_calls tests — TDD RED phase.
 *
 * Covers:
 *  - Tool call lifecycle (tool.started → tool.completed)
 *  - Tool call failure (tool.started → tool.failed)
 *  - Token and cost statistics updates
 *  - Integration with ProjectionEngine
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations } from "../src/db/schema"
import { ProjectionEngine } from "../src/projection/engine"
import { toolCallHandler } from "../src/projection/tool-calls"
import type { IngestEventEnvelope } from "../src/types/events"

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
    event_type: "tool.started",
    session_id: "ses_001",
    project_path: "/test/project",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    tokens: 0,
    cost_usd: 0,
    tool: "bash",
    status: "started",
    summary: null,
    deleted: false,
    metadata: {},
    ...overrides,
  }
}

interface ToolCallRow {
  call_id: string
  session_id: string
  tool_name: string
  status: string | null
  started_at: number | null
  completed_at: number | null
  duration_ms: number | null
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number
  cost_usd: number
  title: string | null
  error_message: string | null
}

function getToolCall(db: Database, callId: string): ToolCallRow | null {
  return (
    (db
      .query("SELECT * FROM projection_tool_calls WHERE call_id = ?")
      .get(callId) as ToolCallRow) ?? null
  )
}

function getAllToolCalls(db: Database): ToolCallRow[] {
  return db.query("SELECT * FROM projection_tool_calls ORDER BY started_at").all() as ToolCallRow[]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolCallProjectionHandler", () => {
  let db: Database
  let engine: ProjectionEngine

  beforeEach(() => {
    db = createTestDb()
    engine = new ProjectionEngine(db)
    engine.registerHandler("tool-calls", toolCallHandler)
  })

  // =========================================================================
  // Tool Call Lifecycle (started → completed)
  // =========================================================================

  describe("tool call lifecycle", () => {
    it("creates a record on tool.started event", () => {
      const event = makeEvent({
        event_id: "evt_start_001",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "bash",
        status: "started",
        timestamp_ms: 1717400000000,
        metadata: {
          call_id: "call_001",
          tool_name: "bash",
          title: "Run ls command",
        },
      })

      engine.processEvent(event)

      const row = getToolCall(db, "call_001")
      expect(row).not.toBeNull()
      expect(row!.session_id).toBe("ses_001")
      expect(row!.tool_name).toBe("bash")
      expect(row!.status).toBe("pending")
      expect(row!.started_at).toBe(1717400000000)
      expect(row!.title).toBe("Run ls command")
      expect(row!.completed_at).toBeNull()
      expect(row!.duration_ms).toBeNull()
    })

    it("updates status to completed on tool.completed event", () => {
      // First: tool.started
      engine.processEvent(
        makeEvent({
          event_id: "evt_start_002",
          event_type: "tool.started",
          session_id: "ses_001",
          tool: "read_file",
          status: "started",
          timestamp_ms: 1717400000000,
          metadata: {
            call_id: "call_002",
            tool_name: "read_file",
            title: "Read config",
          },
        })
      )

      // Then: tool.completed
      engine.processEvent(
        makeEvent({
          event_id: "evt_complete_002",
          event_type: "tool.completed",
          session_id: "ses_001",
          tool: "read_file",
          status: "completed",
          timestamp_ms: 1717400005000,
          tokens: 150,
          cost_usd: 0.002,
          metadata: {
            call_id: "call_002",
            tool_name: "read_file",
            title: "Read config",
            duration_ms: 5000,
          },
        })
      )

      const row = getToolCall(db, "call_002")
      expect(row).not.toBeNull()
      expect(row!.status).toBe("completed")
      expect(row!.completed_at).toBe(1717400005000)
      expect(row!.duration_ms).toBe(5000)
      expect(row!.cost_usd).toBe(0.002)
    })

    it("tracks full lifecycle with multiple tool calls", () => {
      // Tool call 1: started → completed
      engine.processEvent(
        makeEvent({
          event_id: "evt_s1",
          event_type: "tool.started",
          metadata: { call_id: "call_A", tool_name: "bash" },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_c1",
          event_type: "tool.completed",
          tool: "bash",
          status: "completed",
          metadata: { call_id: "call_A", tool_name: "bash", duration_ms: 200 },
        })
      )

      // Tool call 2: started only (still pending)
      engine.processEvent(
        makeEvent({
          event_id: "evt_s2",
          event_type: "tool.started",
          metadata: { call_id: "call_B", tool_name: "read_file" },
        })
      )

      const allCalls = getAllToolCalls(db)
      expect(allCalls.length).toBe(2)

      const callA = getToolCall(db, "call_A")
      expect(callA!.status).toBe("completed")
      expect(callA!.duration_ms).toBe(200)

      const callB = getToolCall(db, "call_B")
      expect(callB!.status).toBe("pending")
    })
  })

  // =========================================================================
  // Tool Call Failure
  // =========================================================================

  describe("tool call failure", () => {
    it("updates status to error on tool.failed event", () => {
      // First: tool.started
      engine.processEvent(
        makeEvent({
          event_id: "evt_start_003",
          event_type: "tool.started",
          session_id: "ses_002",
          tool: "bash",
          status: "started",
          timestamp_ms: 1717400010000,
          metadata: {
            call_id: "call_003",
            tool_name: "bash",
            title: "Run npm install",
          },
        })
      )

      // Then: tool.failed
      engine.processEvent(
        makeEvent({
          event_id: "evt_fail_003",
          event_type: "tool.failed",
          session_id: "ses_002",
          tool: "bash",
          status: "failed",
          timestamp_ms: 1717400015000,
          metadata: {
            call_id: "call_003",
            tool_name: "bash",
            error_message: "Command not found: npm",
            duration_ms: 5000,
          },
        })
      )

      const row = getToolCall(db, "call_003")
      expect(row).not.toBeNull()
      expect(row!.status).toBe("error")
      expect(row!.error_message).toBe("Command not found: npm")
      expect(row!.duration_ms).toBe(5000)
      expect(row!.completed_at).toBe(1717400015000)
    })

    it("preserves error information correctly", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_s_err",
          event_type: "tool.started",
          metadata: { call_id: "call_err", tool_name: "write_file" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_f_err",
          event_type: "tool.failed",
          status: "failed",
          metadata: {
            call_id: "call_err",
            tool_name: "write_file",
            error_message: "Permission denied: /etc/hosts",
            duration_ms: 100,
          },
        })
      )

      const row = getToolCall(db, "call_err")
      expect(row!.status).toBe("error")
      expect(row!.error_message).toBe("Permission denied: /etc/hosts")
      expect(row!.duration_ms).toBe(100)
    })
  })

  // =========================================================================
  // Token Statistics
  // =========================================================================

  describe("token statistics", () => {
    it("updates token counts on tool.completed with token breakdown", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_s_tok",
          event_type: "tool.started",
          metadata: { call_id: "call_tok", tool_name: "bash" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_c_tok",
          event_type: "tool.completed",
          status: "completed",
          tokens: 500,
          cost_usd: 0.005,
          metadata: {
            call_id: "call_tok",
            tool_name: "bash",
            duration_ms: 1000,
            tokens: {
              input: 300,
              output: 200,
              reasoning: 0,
              cache: { read: 50, write: 25 },
            },
          },
        })
      )

      const row = getToolCall(db, "call_tok")
      expect(row!.input_tokens).toBe(300)
      expect(row!.output_tokens).toBe(200)
      expect(row!.cache_read).toBe(50)
      expect(row!.cache_write).toBe(25)
      expect(row!.cost_usd).toBe(0.005)
    })

    it("defaults token counts to 0 when not provided", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_s_notok",
          event_type: "tool.started",
          metadata: { call_id: "call_notok", tool_name: "bash" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_c_notok",
          event_type: "tool.completed",
          status: "completed",
          metadata: { call_id: "call_notok", tool_name: "bash", duration_ms: 500 },
        })
      )

      const row = getToolCall(db, "call_notok")
      expect(row!.input_tokens).toBe(0)
      expect(row!.output_tokens).toBe(0)
      expect(row!.cache_read).toBe(0)
      expect(row!.cache_write).toBe(0)
      expect(row!.cost_usd).toBe(0)
    })
  })

  // =========================================================================
  // Edge Cases
  // =========================================================================

  describe("edge cases", () => {
    it("ignores tool.completed for non-existent call_id gracefully", () => {
      // tool.completed without a prior tool.started should not crash
      engine.processEvent(
        makeEvent({
          event_id: "evt_orphan_complete",
          event_type: "tool.completed",
          metadata: { call_id: "call_orphan", tool_name: "bash" },
        })
      )

      const row = getToolCall(db, "call_orphan")
      // No row should be created for orphan completions
      expect(row).toBeNull()
    })

    it("ignores tool.failed for non-existent call_id gracefully", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_orphan_fail",
          event_type: "tool.failed",
          metadata: { call_id: "call_orphan_fail", tool_name: "bash" },
        })
      )

      const row = getToolCall(db, "call_orphan_fail")
      expect(row).toBeNull()
    })

    it("handles multiple sessions with independent tool calls", () => {
      // Session 1 tool call
      engine.processEvent(
        makeEvent({
          event_id: "evt_s_s1",
          event_type: "tool.started",
          session_id: "ses_100",
          metadata: { call_id: "call_s1", tool_name: "bash" },
        })
      )

      // Session 2 tool call
      engine.processEvent(
        makeEvent({
          event_id: "evt_s_s2",
          event_type: "tool.started",
          session_id: "ses_200",
          metadata: { call_id: "call_s2", tool_name: "read_file" },
        })
      )

      const s1 = getToolCall(db, "call_s1")
      const s2 = getToolCall(db, "call_s2")

      expect(s1!.session_id).toBe("ses_100")
      expect(s2!.session_id).toBe("ses_200")
      expect(s1!.tool_name).toBe("bash")
      expect(s2!.tool_name).toBe("read_file")
    })
  })

  // =========================================================================
  // Integration with ProjectionEngine
  // =========================================================================

  describe("integration with ProjectionEngine", () => {
    it("processes tool events through the engine", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_engine_s",
          event_type: "tool.started",
          session_id: "ses_engine",
          metadata: { call_id: "call_engine", tool_name: "bash" },
        })
      )

      engine.processEvent(
        makeEvent({
          event_id: "evt_engine_c",
          event_type: "tool.completed",
          session_id: "ses_engine",
          status: "completed",
          metadata: { call_id: "call_engine", tool_name: "bash", duration_ms: 300 },
        })
      )

      const row = getToolCall(db, "call_engine")
      expect(row).not.toBeNull()
      expect(row!.status).toBe("completed")
      expect(row!.duration_ms).toBe(300)
    })

    it("is idempotent when processing same event twice", () => {
      const startedEvent = makeEvent({
        event_id: "evt_idem",
        event_type: "tool.started",
        metadata: { call_id: "call_idem", tool_name: "bash" },
      })

      engine.processEvent(startedEvent)
      engine.processEvent(startedEvent) // duplicate

      const allCalls = getAllToolCalls(db)
      expect(allCalls.length).toBe(1)
    })
  })
})
