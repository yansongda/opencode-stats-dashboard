/**
 * DailyProjectionHandler tests — TDD RED phase.
 *
 * Covers:
 *  - Message event aggregation (tokens, cost, messages)
 *  - Tool event aggregation (calls, errors)
 *  - File event aggregation (files_edited, lines)
 *  - Error event aggregation (error_count)
 *  - Agent usage tracking (JSON field)
 *  - Cross-day event isolation
 *  - Multi-dimension aggregation (date × project × model)
 *  - Integration with ProjectionEngine
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations } from "../db/schema"
import { ProjectionEngine } from "./engine"
import { DailyProjectionHandler } from "./daily"
import type { IngestEventEnvelope } from "../types/events"
import type { AgentUsage } from "../types/projections"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:")
  runMigrations(db)
  return db
}

/** Timestamp for 2026-06-05T12:00:00Z (YYYY-MM-DD = 2026-06-05) */
const JUN5_NOON = Date.UTC(2026, 5, 5, 12, 0, 0)

/** Timestamp for 2026-06-06T12:00:00Z (YYYY-MM-DD = 2026-06-06) */
const JUN6_NOON = Date.UTC(2026, 5, 6, 12, 0, 0)

function makeEvent(overrides: Partial<IngestEventEnvelope> = {}): IngestEventEnvelope {
  return {
    event_id: "evt_001",
    event_type: "message.updated",
    session_id: "ses_001",
    project_path: "/test/project",
    timestamp_ms: JUN5_NOON,
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

// ---------------------------------------------------------------------------
// Query helper
// ---------------------------------------------------------------------------

interface DailyRow {
  date: string
  project_path: string
  model: string
  session_count: number
  active_sessions: number
  deleted_sessions: number
  message_count: number
  user_messages: number
  assistant_messages: number
  total_tokens: number
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read: number
  cache_write: number
  total_cost_usd: number
  tool_calls: number
  tool_errors: number
  files_edited: number
  lines_added: number
  lines_deleted: number
  agent_usage: string | null
  error_count: number
  event_count: number
}

function queryDailyRow(db: Database, date: string, project: string, model: string): DailyRow | null {
  return (
    (db
      .query("SELECT * FROM projection_daily WHERE date = ? AND project_path = ? AND model = ?")
      .get(date, project, model) as DailyRow) ?? null
  )
}

function queryDailyRows(db: Database, date: string): DailyRow[] {
  return db
    .query("SELECT * FROM projection_daily WHERE date = ? ORDER BY project_path, model")
    .all(date) as DailyRow[]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DailyProjectionHandler", () => {
  let db: Database
  let engine: ProjectionEngine

  beforeEach(() => {
    db = createTestDb()
    engine = new ProjectionEngine(db)
    engine.registerHandler("daily", new DailyProjectionHandler())
  })

  // =========================================================================
  // Message Events
  // =========================================================================

  describe("message events", () => {
    it("inserts a new row on first message.updated event", () => {
      const event = makeEvent({
        event_id: "evt_msg1",
        event_type: "message.updated",
        model: "claude-sonnet-4-20250514",
        tokens: 150,
        cost_usd: 0.002,
        metadata: {
          message_id: "msg_001",
          role: "assistant",
        },
      })

      engine.processEvent(event)

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row).not.toBeNull()
      expect(row!.message_count).toBe(1)
      expect(row!.assistant_messages).toBe(1)
      expect(row!.total_tokens).toBe(150)
      expect(row!.total_cost_usd).toBeCloseTo(0.002)
      expect(row!.event_count).toBe(1)
    })

    it("increments counters on subsequent message events", () => {
      const base = {
        event_type: "message.updated" as const,
        project_path: "/test/project",
        model: "claude-sonnet-4-20250514",
        timestamp_ms: JUN5_NOON,
      }

      engine.processEvent(makeEvent({ ...base, event_id: "evt_1", tokens: 100, cost_usd: 0.001 }))
      engine.processEvent(makeEvent({ ...base, event_id: "evt_2", tokens: 200, cost_usd: 0.003 }))

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row).not.toBeNull()
      expect(row!.message_count).toBe(2)
      expect(row!.total_tokens).toBe(300)
      expect(row!.total_cost_usd).toBeCloseTo(0.004)
      expect(row!.event_count).toBe(2)
    })

    it("tracks user and assistant message roles", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_u1",
          event_type: "message.updated",
          metadata: { role: "user" },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_a1",
          event_type: "message.updated",
          metadata: { role: "assistant" },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_a2",
          event_type: "message.updated",
          metadata: { role: "assistant" },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.message_count).toBe(3)
      expect(row!.user_messages).toBe(1)
      expect(row!.assistant_messages).toBe(2)
    })

    it("handles message.created event", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_mc1",
          event_type: "message.created",
          tokens: 50,
          cost_usd: 0.001,
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row).not.toBeNull()
      expect(row!.message_count).toBe(1)
      expect(row!.total_tokens).toBe(50)
      expect(row!.event_count).toBe(1)
    })
  })

  // =========================================================================
  // Token Breakdown
  // =========================================================================

  describe("token breakdown", () => {
    it("accumulates input, output, reasoning, and cache tokens", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_t1",
          event_type: "message.updated",
          tokens: 1000,
          metadata: {
            role: "assistant",
            tokens: {
              input: 600,
              output: 300,
              reasoning: 100,
              cache: { read: 50, write: 25 },
            },
          },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.total_tokens).toBe(1000)
      expect(row!.input_tokens).toBe(600)
      expect(row!.output_tokens).toBe(300)
      expect(row!.reasoning_tokens).toBe(100)
      expect(row!.cache_read).toBe(50)
      expect(row!.cache_write).toBe(25)
    })

    it("sums token breakdown across multiple events", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_t1",
          event_type: "message.updated",
          tokens: 100,
          metadata: {
            tokens: { input: 60, output: 30, reasoning: 10, cache: { read: 5, write: 2 } },
          },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_t2",
          event_type: "message.updated",
          tokens: 200,
          metadata: {
            tokens: { input: 120, output: 60, reasoning: 20, cache: { read: 10, write: 5 } },
          },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.total_tokens).toBe(300)
      expect(row!.input_tokens).toBe(180)
      expect(row!.output_tokens).toBe(90)
      expect(row!.reasoning_tokens).toBe(30)
      expect(row!.cache_read).toBe(15)
      expect(row!.cache_write).toBe(7)
    })
  })

  // =========================================================================
  // Tool Events
  // =========================================================================

  describe("tool events", () => {
    it("increments tool_calls on tool.completed", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_tc1",
          event_type: "tool.completed",
          tool: "Bash",
          tokens: 50,
          cost_usd: 0.001,
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.tool_calls).toBe(1)
      expect(row!.tool_errors).toBe(0)
    })

    it("increments tool_calls and tool_errors on tool.failed", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_tf1",
          event_type: "tool.failed",
          tool: "Bash",
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.tool_calls).toBe(1)
      expect(row!.tool_errors).toBe(1)
    })

    it("handles tool.started event (increments tool_calls)", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_ts1",
          event_type: "tool.started",
          tool: "Read",
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.tool_calls).toBe(1)
    })
  })

  // =========================================================================
  // File Events
  // =========================================================================

  describe("file events", () => {
    it("increments files_edited and lines on file.edited", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_fe1",
          event_type: "file.edited",
          metadata: { file_path: "/src/index.ts", additions: 10, deletions: 5 },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.files_edited).toBe(1)
      expect(row!.lines_added).toBe(10)
      expect(row!.lines_deleted).toBe(5)
    })

    it("accumulates multiple file.edited events", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_fe1",
          event_type: "file.edited",
          metadata: { additions: 10, deletions: 5 },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_fe2",
          event_type: "file.edited",
          metadata: { additions: 20, deletions: 3 },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.files_edited).toBe(2)
      expect(row!.lines_added).toBe(30)
      expect(row!.lines_deleted).toBe(8)
    })
  })

  // =========================================================================
  // Error Events
  // =========================================================================

  describe("error events", () => {
    it("increments error_count on session.error", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_err1",
          event_type: "session.error",
          metadata: { error_type: "RateLimitError", error_message: "Too many requests" },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.error_count).toBe(1)
      expect(row!.event_count).toBe(1)
    })

    it("accumulates multiple errors", () => {
      engine.processEvent(makeEvent({ event_id: "evt_e1", event_type: "session.error" }))
      engine.processEvent(makeEvent({ event_id: "evt_e2", event_type: "session.error" }))
      engine.processEvent(makeEvent({ event_id: "evt_e3", event_type: "session.error" }))

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.error_count).toBe(3)
    })
  })

  // =========================================================================
  // Agent Usage (JSON field)
  // =========================================================================

  describe("agent_usage", () => {
    it("populates agent_usage from metadata.agent on first agent event", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_ag1",
          event_type: "message.updated",
          tokens: 500,
          cost_usd: 0.005,
          metadata: { agent: "build", role: "assistant" },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.agent_usage).not.toBeNull()
      const usage: AgentUsage = JSON.parse(row!.agent_usage!)
      expect(usage["build"]).toBeDefined()
      expect(usage["build"]!.message_count).toBe(1)
      expect(usage["build"]!.cost_usd).toBeCloseTo(0.005)
    })

    it("accumulates agent usage across multiple events", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_ag1",
          event_type: "message.updated",
          tokens: 100,
          cost_usd: 0.001,
          metadata: { agent: "build", role: "assistant" },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_ag2",
          event_type: "message.updated",
          tokens: 200,
          cost_usd: 0.002,
          metadata: { agent: "build", role: "assistant" },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      const usage: AgentUsage = JSON.parse(row!.agent_usage!)
      expect(usage["build"]!.message_count).toBe(2)
      expect(usage["build"]!.cost_usd).toBeCloseTo(0.003)
    })

    it("tracks multiple agents independently", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_ag1",
          event_type: "message.updated",
          tokens: 100,
          cost_usd: 0.001,
          metadata: { agent: "build" },
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_ag2",
          event_type: "message.updated",
          tokens: 200,
          cost_usd: 0.002,
          metadata: { agent: "plan" },
        })
      )

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      const usage: AgentUsage = JSON.parse(row!.agent_usage!)
      expect(usage["build"]).toBeDefined()
      expect(usage["plan"]).toBeDefined()
      expect(usage["build"]!.message_count).toBe(1)
      expect(usage["plan"]!.message_count).toBe(1)
    })
  })

  // =========================================================================
  // Cross-Day Isolation
  // =========================================================================

  describe("cross-day event handling", () => {
    it("creates separate rows for different dates", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_d1",
          event_type: "message.updated",
          timestamp_ms: JUN5_NOON,
          tokens: 100,
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_d2",
          event_type: "message.updated",
          timestamp_ms: JUN6_NOON,
          tokens: 200,
        })
      )

      const row5 = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      const row6 = queryDailyRow(db, "2026-06-06", "/test/project", "claude-sonnet-4-20250514")

      expect(row5).not.toBeNull()
      expect(row6).not.toBeNull()
      expect(row5!.total_tokens).toBe(100)
      expect(row6!.total_tokens).toBe(200)
      expect(row5!.event_count).toBe(1)
      expect(row6!.event_count).toBe(1)
    })

    it("handles UTC date boundary correctly", () => {
      const beforeMidnight = Date.UTC(2026, 5, 5, 23, 59, 59)
      const afterMidnight = Date.UTC(2026, 5, 6, 0, 0, 0)

      engine.processEvent(
        makeEvent({ event_id: "evt_bm", timestamp_ms: beforeMidnight, tokens: 100 })
      )
      engine.processEvent(
        makeEvent({ event_id: "evt_am", timestamp_ms: afterMidnight, tokens: 200 })
      )

      const rows5 = queryDailyRows(db, "2026-06-05")
      const rows6 = queryDailyRows(db, "2026-06-06")

      expect(rows5.length).toBe(1)
      expect(rows5[0]!.total_tokens).toBe(100)
      expect(rows6.length).toBe(1)
      expect(rows6[0]!.total_tokens).toBe(200)
    })
  })

  // =========================================================================
  // Multi-Dimension Aggregation
  // =========================================================================

  describe("multi-dimension aggregation", () => {
    it("creates separate rows for different projects", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_p1",
          project_path: "/project-a",
          tokens: 100,
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_p2",
          project_path: "/project-b",
          tokens: 200,
        })
      )

      const rowA = queryDailyRow(db, "2026-06-05", "/project-a", "claude-sonnet-4-20250514")
      const rowB = queryDailyRow(db, "2026-06-05", "/project-b", "claude-sonnet-4-20250514")

      expect(rowA).not.toBeNull()
      expect(rowB).not.toBeNull()
      expect(rowA!.total_tokens).toBe(100)
      expect(rowB!.total_tokens).toBe(200)
    })

    it("creates separate rows for different models", () => {
      engine.processEvent(
        makeEvent({
          event_id: "evt_m1",
          model: "claude-sonnet-4-20250514",
          tokens: 100,
        })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_m2",
          model: "claude-haiku-4-20250514",
          tokens: 200,
        })
      )

      const rowSonnet = queryDailyRow(
        db,
        "2026-06-05",
        "/test/project",
        "claude-sonnet-4-20250514"
      )
      const rowHaiku = queryDailyRow(
        db,
        "2026-06-05",
        "/test/project",
        "claude-haiku-4-20250514"
      )

      expect(rowSonnet).not.toBeNull()
      expect(rowHaiku).not.toBeNull()
      expect(rowSonnet!.total_tokens).toBe(100)
      expect(rowHaiku!.total_tokens).toBe(200)
    })
  })

  // =========================================================================
  // Integration with ProjectionEngine
  // =========================================================================

  describe("ProjectionEngine integration", () => {
    it("handler is registered and receives events", () => {
      expect(engine.hasHandler("daily")).toBe(true)
    })

    it("processes multiple event types in sequence", () => {
      engine.processEvent(
        makeEvent({ event_id: "evt_1", event_type: "message.updated", tokens: 100, cost_usd: 0.001 })
      )
      engine.processEvent(
        makeEvent({ event_id: "evt_2", event_type: "tool.completed", tool: "Bash" })
      )
      engine.processEvent(
        makeEvent({
          event_id: "evt_3",
          event_type: "file.edited",
          metadata: { additions: 10, deletions: 5 },
        })
      )
      engine.processEvent(makeEvent({ event_id: "evt_4", event_type: "session.error" }))

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row).not.toBeNull()
      expect(row!.message_count).toBe(1)
      expect(row!.tool_calls).toBe(1)
      expect(row!.files_edited).toBe(1)
      expect(row!.error_count).toBe(1)
      expect(row!.event_count).toBe(4)
    })

    it("is idempotent — processing same event twice does not double-count", () => {
      const event = makeEvent({
        event_id: "evt_dup",
        event_type: "message.updated",
        tokens: 100,
      })

      engine.processEvent(event)
      engine.processEvent(event)

      const row = queryDailyRow(db, "2026-06-05", "/test/project", "claude-sonnet-4-20250514")
      expect(row!.message_count).toBe(1)
      expect(row!.total_tokens).toBe(100)
      expect(row!.event_count).toBe(1)
    })
  })
})
