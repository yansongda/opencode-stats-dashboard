/**
 * SnapshotManager tests — TDD RED phase.
 *
 * Covers:
 *  - Session snapshot generation (from projection_sessions)
 *  - Daily snapshot generation (from projection_daily aggregation)
 *  - getSnapshot retrieval (latest by type + target)
 *  - isSnapshotValid check (new events since snapshot)
 *  - Query-time completion (getOrGenerateDailySnapshot)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations } from "../db/schema"
import { SnapshotManager } from "./manager"
import {
  isSessionSnapshotData,
  isDailySnapshotData,
  type SessionSnapshotData,
  type DailySnapshotData,
  type SnapshotData,
} from "../types/snapshots"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:")
  runMigrations(db)
  return db
}

/**
 * Normalize snapshot_data to a parsed object.
 *
 * When reading from DB (getSnapshot), snapshot_data is a JSON string.
 * When returned from generate*(), snapshot_data is already an object.
 */
function asSnapshotData(
  data: SnapshotData | string
): SnapshotData {
  if (typeof data === "string") {
    return JSON.parse(data) as SnapshotData
  }
  return data
}

/** Insert a minimal projection_sessions row for testing. */
function insertSessionProjection(
  db: Database,
  overrides: Record<string, unknown> = {}
): void {
  const defaults = {
    session_id: "ses_001",
    project_path: "/test/project",
    title: "Test Session",
    status: "active",
    deleted_at: null,
    primary_model: "claude-sonnet-4-20250514",
    model_usage: JSON.stringify({
      "claude-sonnet-4-20250514": {
        message_count: 5,
        tokens: {
          input: 1000,
          output: 500,
          reasoning: 200,
          cache: { read: 100, write: 50 },
        },
        cost_usd: 0.018,
      },
    }),
    first_event_at: 1717400000000,
    last_event_at: 1717401800000,
    duration_ms: 1800000,
    user_message_count: 3,
    assistant_message_count: 5,
    total_tokens: 1800,
    input_tokens: 1000,
    output_tokens: 500,
    reasoning_tokens: 200,
    cache_read: 100,
    cache_write: 50,
    total_cost_usd: 0.018,
    tool_call_count: 15,
    tool_error_count: 1,
    files_edited: 3,
    lines_added: 150,
    lines_deleted: 30,
    primary_agent: "build",
    agent_usage: JSON.stringify({
      build: {
        message_count: 4,
        tokens: {
          input: 800,
          output: 400,
          reasoning: 150,
          cache: { read: 80, write: 40 },
        },
        cost_usd: 0.015,
      },
    }),
    error_count: 0,
    projected_at: new Date().toISOString(),
    event_count: 20,
    ...overrides,
  }

  const cols = Object.keys(defaults).join(", ")
  const placeholders = Object.keys(defaults)
    .map(() => "?")
    .join(", ")
  const values = Object.values(defaults)

  db.run(
    `INSERT INTO projection_sessions (${cols}) VALUES (${placeholders})`,
    values
  )
}

/** Insert a projection_daily row for testing. */
function insertDailyProjection(
  db: Database,
  overrides: Record<string, unknown> = {}
): void {
  const defaults = {
    date: "2026-06-04",
    project_path: "/test/project",
    model: "claude-sonnet-4-20250514",
    session_count: 3,
    active_sessions: 2,
    deleted_sessions: 1,
    message_count: 20,
    user_messages: 10,
    assistant_messages: 10,
    total_tokens: 5000,
    input_tokens: 3000,
    output_tokens: 1500,
    reasoning_tokens: 500,
    cache_read: 200,
    cache_write: 100,
    total_cost_usd: 0.05,
    tool_calls: 30,
    tool_errors: 2,
    files_edited: 5,
    lines_added: 300,
    lines_deleted: 50,
    agent_usage: JSON.stringify({
      build: {
        sessions: 2,
        tokens: 4000,
      },
    }),
    error_count: 1,
    projected_at: new Date().toISOString(),
    event_count: 50,
    ...overrides,
  }

  const cols = Object.keys(defaults).join(", ")
  const placeholders = Object.keys(defaults)
    .map(() => "?")
    .join(", ")
  const values = Object.values(defaults)

  db.run(
    `INSERT INTO projection_daily (${cols}) VALUES (${placeholders})`,
    values
  )
}

/** Insert an event into the events table for isSnapshotValid testing. */
function insertEvent(
  db: Database,
  overrides: Record<string, unknown> = {}
): void {
  const defaults = {
    event_id: "evt_001",
    event_type: "session.created",
    session_id: "ses_001",
    timestamp_ms: 1717400000000,
    model: "claude-sonnet-4-20250514",
    total_tokens: 100,
    cost_usd: 0.001,
    event_contents: "{}",
    ...overrides,
  }

  const cols = Object.keys(defaults).join(", ")
  const placeholders = Object.keys(defaults)
    .map(() => "?")
    .join(", ")
  const values = Object.values(defaults)

  db.run(`INSERT INTO events (${cols}) VALUES (${placeholders})`, values)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SnapshotManager", () => {
  let db: Database
  let manager: SnapshotManager

  beforeEach(() => {
    db = createTestDb()
    manager = new SnapshotManager(db)
  })

  // =========================================================================
  // Session Snapshot Generation
  // =========================================================================

  describe("generateSessionSnapshot", () => {
    it("generates a session snapshot from projection_sessions", () => {
      insertSessionProjection(db)

      const snapshot = manager.generateSessionSnapshot("ses_001")

      expect(snapshot).not.toBeNull()
      expect(snapshot!.snapshot_type).toBe("session")
      expect(snapshot!.target_id).toBe("ses_001")
      expect(snapshot!.snapshot_id).toContain("session_ses_001_")
    })

    it("stores correct session snapshot data", () => {
      insertSessionProjection(db)

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      // Use type guard instead of type assertion
      expect(isSessionSnapshotData(data)).toBe(true)

      if (isSessionSnapshotData(data)) {
        expect(data.session_id).toBe("ses_001")
        expect(data.project_path).toBe("/test/project")
        expect(data.title).toBe("Test Session")
        expect(data.status).toBe("active")
        expect(data.primary_model).toBe("claude-sonnet-4-20250514")
        expect(data.total_tokens).toBe(1800)
        expect(data.input_tokens).toBe(1000)
        expect(data.output_tokens).toBe(500)
        expect(data.reasoning_tokens).toBe(200)
        expect(data.cache_read).toBe(100)
        expect(data.cache_write).toBe(50)
        expect(data.total_cost_usd).toBe(0.018)
        expect(data.tool_call_count).toBe(15)
        expect(data.tool_error_count).toBe(1)
        expect(data.files_edited).toBe(3)
        expect(data.lines_added).toBe(150)
        expect(data.lines_deleted).toBe(30)
        expect(data.primary_agent).toBe("build")
        expect(data.error_count).toBe(0)
      }
    })

    it("stores model_usage as structured data in snapshot", () => {
      insertSessionProjection(db)

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isSessionSnapshotData(data)) {
        expect(data.model_usage).not.toBeNull()
        expect(data.model_usage!["claude-sonnet-4-20250514"]).toBeDefined()
        expect(
          data.model_usage!["claude-sonnet-4-20250514"]!.message_count
        ).toBe(5)
        expect(data.model_usage!["claude-sonnet-4-20250514"]!.cost_usd).toBe(
          0.018
        )
      }
    })

    it("stores agent_usage as structured data in snapshot", () => {
      insertSessionProjection(db)

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isSessionSnapshotData(data)) {
        expect(data.agent_usage).not.toBeNull()
        expect(data.agent_usage!["build"]).toBeDefined()
        expect(data.agent_usage!["build"]!.message_count).toBe(4)
      }
    })

    it("returns null when session projection does not exist", () => {
      const snapshot = manager.generateSessionSnapshot("ses_nonexistent")
      expect(snapshot).toBeNull()
    })

    it("persists snapshot to database", () => {
      insertSessionProjection(db)

      manager.generateSessionSnapshot("ses_001")

      const row = db
        .query(
          "SELECT * FROM snapshots WHERE snapshot_type = ? AND target_id = ?"
        )
        .get("session", "ses_001") as Record<string, unknown> | null

      expect(row).not.toBeNull()
      expect(row!['snapshot_type']).toBe("session")
      expect(row!['target_id']).toBe("ses_001")
      expect(row!['snapshot_data']).toBeTruthy()
    })

    it("sets period_start and period_end from projection timestamps", () => {
      insertSessionProjection(db)

      const snapshot = manager.generateSessionSnapshot("ses_001")

      expect(snapshot!.period_start).toBe(1717400000000)
      expect(snapshot!.period_end).toBe(1717401800000)
    })

    it("handles deleted session status", () => {
      insertSessionProjection(db, {
        status: "deleted",
        deleted_at: 1717402000000,
      })

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isSessionSnapshotData(data)) {
        expect(data.status).toBe("deleted")
        expect(data.deleted_at).toBe(1717402000000)
      }
    })

    it("handles session with null model_usage", () => {
      insertSessionProjection(db, {
        primary_model: null,
        model_usage: null,
      })

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isSessionSnapshotData(data)) {
        expect(data.primary_model).toBeNull()
        expect(data.model_usage).toBeNull()
      }
    })
  })

  // =========================================================================
  // Daily Snapshot Generation
  // =========================================================================

  describe("generateDailySnapshot", () => {
    it("generates a daily snapshot from projection_daily rows", () => {
      insertDailyProjection(db)

      const snapshot = manager.generateDailySnapshot("2026-06-04")

      expect(snapshot).not.toBeNull()
      expect(snapshot!.snapshot_type).toBe("daily")
      expect(snapshot!.target_id).toBe("2026-06-04")
      expect(snapshot!.snapshot_id).toContain("daily_2026-06-04_")
    })

    it("aggregates multiple projection_daily rows for same date", () => {
      insertDailyProjection(db, {
        project_path: "/project-a",
        model: "claude-sonnet-4-20250514",
        session_count: 2,
        total_tokens: 3000,
        total_cost_usd: 0.03,
      })
      insertDailyProjection(db, {
        project_path: "/project-b",
        model: "gpt-4o",
        session_count: 1,
        total_tokens: 2000,
        total_cost_usd: 0.02,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const data = asSnapshotData(snapshot!.snapshot_data)

      expect(isDailySnapshotData(data)).toBe(true)

      if (isDailySnapshotData(data)) {
        expect(data.sessions.total).toBe(3)
        expect(data.tokens.total).toBe(5000)
        expect(data.cost_usd.total).toBe(0.05)
      }
    })

    it("groups tokens by model", () => {
      insertDailyProjection(db, {
        project_path: "/project-a",
        model: "claude-sonnet-4-20250514",
        total_tokens: 3000,
        input_tokens: 2000,
        output_tokens: 800,
        reasoning_tokens: 200,
        cache_read: 100,
        cache_write: 50,
        total_cost_usd: 0.03,
      })
      insertDailyProjection(db, {
        project_path: "/project-b",
        model: "gpt-4o",
        total_tokens: 2000,
        input_tokens: 1500,
        output_tokens: 400,
        reasoning_tokens: 100,
        cache_read: 50,
        cache_write: 25,
        total_cost_usd: 0.02,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isDailySnapshotData(data)) {
        expect(data.tokens.by_model["claude-sonnet-4-20250514"]).toBeDefined()
        expect(data.tokens.by_model["gpt-4o"]).toBeDefined()
        expect(data.tokens.by_model["claude-sonnet-4-20250514"]!.total).toBe(
          3000
        )
        expect(data.tokens.by_model["gpt-4o"]!.total).toBe(2000)
        expect(data.cost_usd.by_model["claude-sonnet-4-20250514"]).toBe(0.03)
        expect(data.cost_usd.by_model["gpt-4o"]).toBe(0.02)
      }
    })

    it("returns null when no projection_daily rows exist for date", () => {
      const snapshot = manager.generateDailySnapshot("2026-01-01")
      expect(snapshot).toBeNull()
    })

    it("persists snapshot to database", () => {
      insertDailyProjection(db)

      manager.generateDailySnapshot("2026-06-04")

      const row = db
        .query(
          "SELECT * FROM snapshots WHERE snapshot_type = ? AND target_id = ?"
        )
        .get("daily", "2026-06-04") as Record<string, unknown> | null

      expect(row).not.toBeNull()
      expect(row!['snapshot_type']).toBe("daily")
      expect(row!['target_id']).toBe("2026-06-04")
    })

    it("sets period_start and period_end for the day", () => {
      insertDailyProjection(db)

      const snapshot = manager.generateDailySnapshot("2026-06-04")

      // period_start should be start of day, period_end should be end of day
      expect(snapshot!.period_start).toBeGreaterThan(0)
      expect(snapshot!.period_end).toBeGreaterThan(snapshot!.period_start!)
    })

    it("aggregates message counts correctly", () => {
      insertDailyProjection(db, {
        project_path: "/project-a",
        model: "claude-sonnet-4-20250514",
        message_count: 10,
        user_messages: 4,
        assistant_messages: 6,
      })
      insertDailyProjection(db, {
        project_path: "/project-b",
        model: "gpt-4o",
        message_count: 8,
        user_messages: 3,
        assistant_messages: 5,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isDailySnapshotData(data)) {
        expect(data.messages.total).toBe(18)
        expect(data.messages.user).toBe(7)
        expect(data.messages.assistant).toBe(11)
      }
    })

    it("aggregates tool stats correctly", () => {
      insertDailyProjection(db, {
        project_path: "/project-a",
        model: "claude-sonnet-4-20250514",
        tool_calls: 20,
        tool_errors: 1,
      })
      insertDailyProjection(db, {
        project_path: "/project-b",
        model: "gpt-4o",
        tool_calls: 10,
        tool_errors: 1,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isDailySnapshotData(data)) {
        expect(data.tools.total_calls).toBe(30)
        expect(data.tools.errors).toBe(2)
      }
    })

    it("aggregates file stats correctly", () => {
      insertDailyProjection(db, {
        project_path: "/project-a",
        model: "claude-sonnet-4-20250514",
        files_edited: 3,
        lines_added: 150,
        lines_deleted: 30,
      })
      insertDailyProjection(db, {
        project_path: "/project-b",
        model: "gpt-4o",
        files_edited: 2,
        lines_added: 100,
        lines_deleted: 20,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const data = asSnapshotData(snapshot!.snapshot_data)

      if (isDailySnapshotData(data)) {
        expect(data.files.edited).toBe(5)
        expect(data.files.lines_added).toBe(250)
        expect(data.files.lines_deleted).toBe(50)
      }
    })
  })

  // =========================================================================
  // getSnapshot
  // =========================================================================

  describe("getSnapshot", () => {
    it("retrieves a session snapshot by target_id", () => {
      insertSessionProjection(db)
      manager.generateSessionSnapshot("ses_001")

      const snapshot = manager.getSnapshot("session", "ses_001")

      expect(snapshot).not.toBeNull()
      expect(snapshot!.snapshot_type).toBe("session")
      expect(snapshot!.target_id).toBe("ses_001")
    })

    it("retrieves a daily snapshot by target_id", () => {
      insertDailyProjection(db)
      manager.generateDailySnapshot("2026-06-04")

      const snapshot = manager.getSnapshot("daily", "2026-06-04")

      expect(snapshot).not.toBeNull()
      expect(snapshot!.snapshot_type).toBe("daily")
      expect(snapshot!.target_id).toBe("2026-06-04")
    })

    it("returns null when no snapshot exists", () => {
      const snapshot = manager.getSnapshot("session", "ses_nonexistent")
      expect(snapshot).toBeNull()
    })

    it("returns the latest snapshot when multiple exist", () => {
      insertSessionProjection(db)

      // Generate first snapshot
      const first = manager.generateSessionSnapshot("ses_001")

      // Insert a second snapshot manually with a later snapshot_at
      const laterTimestamp = first!.snapshot_at + 100000
      db.run(
        `INSERT INTO snapshots (snapshot_id, snapshot_type, target_id, snapshot_at, snapshot_data, event_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          `session_ses_001_${laterTimestamp}`,
          "session",
          "ses_001",
          laterTimestamp,
          JSON.stringify({ session_id: "ses_001", project_path: "/test" }),
          25,
        ]
      )

      const snapshot = manager.getSnapshot("session", "ses_001")

      expect(snapshot).not.toBeNull()
      expect(snapshot!.snapshot_at).toBe(laterTimestamp)
    })

    it("validates snapshot data with type guard", () => {
      insertSessionProjection(db)
      manager.generateSessionSnapshot("ses_001")

      const snapshot = manager.getSnapshot("session", "ses_001")
      const data = asSnapshotData(snapshot!.snapshot_data)

      expect(isSessionSnapshotData(data)).toBe(true)
    })
  })

  // =========================================================================
  // isSnapshotValid
  // =========================================================================

  describe("isSnapshotValid", () => {
    it("returns true when snapshot exists and no new events after it", () => {
      insertSessionProjection(db)
      insertEvent(db, {
        event_id: "evt_001",
        session_id: "ses_001",
        timestamp_ms: 1717400000000,
      })

      const snapshot = manager.generateSessionSnapshot("ses_001")

      // Snapshot was just created (snapshot_at ~= now). Insert an event with
      // timestamp_ms BEFORE the snapshot's snapshot_at so it counts as "old".
      // The snapshot_at is Date.now() which is ~1780xxx. The event timestamp
      // 1717400000000 is well before that, so 0 new events → valid.
      const valid = manager.isSnapshotValid("session", "ses_001")
      expect(valid).toBe(true)
    })

    it("returns false when new events exist after snapshot", () => {
      insertSessionProjection(db)
      insertEvent(db, {
        event_id: "evt_001",
        session_id: "ses_001",
        timestamp_ms: 1717400000000,
      })

      const snapshot = manager.generateSessionSnapshot("ses_001")
      const snapshotAt = snapshot!.snapshot_at

      // Insert an event with timestamp AFTER the snapshot's snapshot_at
      insertEvent(db, {
        event_id: "evt_002",
        session_id: "ses_001",
        timestamp_ms: snapshotAt + 1000,
      })

      const valid = manager.isSnapshotValid("session", "ses_001")
      expect(valid).toBe(false)
    })

    it("returns false when no snapshot exists", () => {
      const valid = manager.isSnapshotValid("session", "ses_nonexistent")
      expect(valid).toBe(false)
    })

    it("checks daily snapshot validity against events", () => {
      insertDailyProjection(db)
      insertEvent(db, {
        event_id: "evt_001",
        timestamp_ms: 1717400000000,
      })

      const snapshot = manager.generateDailySnapshot("2026-06-04")
      const snapshotAt = snapshot!.snapshot_at

      // Valid — all events are before the snapshot time
      expect(manager.isSnapshotValid("daily", "2026-06-04")).toBe(true)

      // Add event within the same day, but after the snapshot time
      insertEvent(db, {
        event_id: "evt_002",
        timestamp_ms: snapshotAt + 1000,
      })

      expect(manager.isSnapshotValid("daily", "2026-06-04")).toBe(false)
    })
  })

  // =========================================================================
  // Query-time Completion (getOrGenerateDailySnapshot)
  // =========================================================================

  describe("getOrGenerateDailySnapshot", () => {
    it("returns existing snapshot when valid", () => {
      insertDailyProjection(db)
      insertEvent(db, {
        event_id: "evt_001",
        timestamp_ms: 1717400000000,
      })

      const generated = manager.generateDailySnapshot("2026-06-04")
      const result = manager.getOrGenerateDailySnapshot("2026-06-04")

      expect(result).not.toBeNull()
      expect(result!.snapshot_id).toBe(generated!.snapshot_id)
    })

    it("generates new snapshot when none exists", () => {
      insertDailyProjection(db)

      const result = manager.getOrGenerateDailySnapshot("2026-06-04")

      expect(result).not.toBeNull()
      expect(result!.snapshot_type).toBe("daily")
      expect(result!.target_id).toBe("2026-06-04")
    })

    it("regenerates snapshot when invalid (new events)", () => {
      insertDailyProjection(db)
      insertEvent(db, {
        event_id: "evt_001",
        timestamp_ms: 1717400000000,
      })

      const firstSnapshot = manager.generateDailySnapshot("2026-06-04")
      const snapshotAt = firstSnapshot!.snapshot_at

      // Add new event AFTER the snapshot time (makes it invalid)
      insertEvent(db, {
        event_id: "evt_002",
        timestamp_ms: snapshotAt + 1000,
      })

      const result = manager.getOrGenerateDailySnapshot("2026-06-04")

      // Should regenerate — old invalid snapshot deleted, new one created
      expect(result).not.toBeNull()
      expect(result!.snapshot_type).toBe("daily")
      expect(result!.target_id).toBe("2026-06-04")

      // Only 1 snapshot should exist (old was deleted before regenerating)
      const count = db
        .query(
          "SELECT COUNT(*) as cnt FROM snapshots WHERE snapshot_type = ? AND target_id = ?"
        )
        .get("daily", "2026-06-04") as { cnt: number }

      expect(count.cnt).toBe(1)
    })

    it("returns null when no projection data exists for the date", () => {
      const result = manager.getOrGenerateDailySnapshot("2026-01-01")
      expect(result).toBeNull()
    })

    it("populates snapshot_data with correct daily structure", () => {
      insertDailyProjection(db)

      const result = manager.getOrGenerateDailySnapshot("2026-06-04")
      const data = asSnapshotData(result!.snapshot_data)

      expect(isDailySnapshotData(data)).toBe(true)

      if (isDailySnapshotData(data)) {
        expect(data.date).toBe("2026-06-04")
        expect(data.sessions).toBeDefined()
        expect(data.messages).toBeDefined()
        expect(data.tokens).toBeDefined()
        expect(data.cost_usd).toBeDefined()
        expect(data.tools).toBeDefined()
        expect(data.files).toBeDefined()
      }
    })
  })
})
