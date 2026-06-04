import { describe, test, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { runMigrations, CURRENT_VERSION } from "../src/db/schema"
import { insertEvent } from "../src/db/event"
import { processSessionEvent, processToolEvent } from "../src/db/reducer"
import type { IngestEventEnvelope } from "../src/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb(): Database {
  const db = new Database(":memory:")
  runMigrations(db)
  return db
}

function validEvent(
  overrides?: Partial<IngestEventEnvelope>
): IngestEventEnvelope {
  return {
    event_id: "evt_test_001",
    event_type: "session.created",
    session_id: "ses_test_001",
    project_path: "/tmp/test",
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

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe("schema", () => {
  test("migrations create expected tables", () => {
    const db = setupDb()
    const rows = db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[]
    const tables = rows.map((r) => r.name)

    for (const expected of [
      "events",
      "sessions",
      "tool_calls",
      "schema_migrations",
    ]) {
      expect(tables).toContain(expected)
    }
  })

  test("events table has expected indexes", () => {
    const db = setupDb()
    const rows = db.query("PRAGMA index_list(events)").all() as {
      name: string
    }[]
    const indexes = rows.map((r) => r.name)

    for (const expected of [
      "idx_events_session",
      "idx_events_type",
      "idx_events_timestamp",
    ]) {
      expect(indexes).toContain(expected)
    }
  })

  test("sessions table has expected indexes", () => {
    const db = setupDb()
    const rows = db.query("PRAGMA index_list(sessions)").all() as {
      name: string
    }[]
    const indexes = rows.map((r) => r.name)

    for (const expected of [
      "idx_sessions_project",
      "idx_sessions_deleted",
    ]) {
      expect(indexes).toContain(expected)
    }
  })

  test("tool_calls table has expected indexes", () => {
    const db = setupDb()
    const rows = db.query("PRAGMA index_list(tool_calls)").all() as {
      name: string
    }[]
    const indexes = rows.map((r) => r.name)

    for (const expected of [
      "idx_tool_calls_session",
      "idx_tool_calls_tool",
    ]) {
      expect(indexes).toContain(expected)
    }
  })

  test("migration is idempotent", () => {
    const db = new Database(":memory:")
    const applied1 = runMigrations(db)
    const applied2 = runMigrations(db)

    expect(applied1).toBe(1)
    expect(applied2).toBe(0)
  })

  test("current_version returns applied version", () => {
    const db = new Database(":memory:")

    // Fresh db — no schema_migrations table yet
    let row = db
      .query(
        "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
      )
      .get() as { cnt: number } | null
    // Table doesn't exist yet, so cnt should be 0
    expect(row?.cnt ?? 0).toBe(0)

    runMigrations(db)

    row = db
      .query("SELECT MAX(version) as v FROM schema_migrations")
      .get() as { v: number } | null
    expect(row?.v).toBe(CURRENT_VERSION)
  })

  test("schema excludes full payload columns", () => {
    const db = setupDb()

    for (const table of ["events", "sessions", "tool_calls"]) {
      const rows = db.query(`PRAGMA table_info(${table})`).all() as {
        name: string
      }[]
      const columns = rows.map((r) => r.name)
      for (const forbidden of [
        "message_body",
        "tool_input",
        "tool_output",
      ]) {
        expect(columns).not.toContain(forbidden)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Event insert tests
// ---------------------------------------------------------------------------

describe("insertEvent", () => {
  let db: Database

  beforeEach(() => {
    db = setupDb()
  })

  test("inserts new event (accepted)", () => {
    const event = validEvent()
    const result = insertEvent(db, event)
    expect(result).toBe("accepted")
  })

  test("duplicate event returns 'duplicate'", () => {
    const event = validEvent()
    insertEvent(db, event)
    const result = insertEvent(db, event)
    expect(result).toBe("duplicate")
  })

  test("different event_ids are independent", () => {
    insertEvent(db, validEvent({ event_id: "evt_001" }))
    const result = insertEvent(db, validEvent({ event_id: "evt_002" }))
    expect(result).toBe("accepted")
  })
})

// ---------------------------------------------------------------------------
// Session reducer tests
// ---------------------------------------------------------------------------

describe("processSessionEvent", () => {
  let db: Database

  beforeEach(() => {
    db = setupDb()
  })

  test("session.created inserts into sessions", () => {
    const event = validEvent({
      event_type: "session.created",
      session_id: "ses_001",
      project_path: "/Users/test/project",
      model: "claude-sonnet-4-20250514",
      tokens: 0,
      cost_usd: 0,
    })

    processSessionEvent(db, event)

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get() as Record<string, unknown> | null

    expect(row).not.toBeNull()
    expect(row!.session_id).toBe("ses_001")
    expect(row!.project_path).toBe("/Users/test/project")
    expect(row!.model).toBe("claude-sonnet-4-20250514")
    expect(row!.total_tokens).toBe(0)
    expect(row!.total_cost_usd).toBe(0)
    expect(row!.deleted).toBe(0) // FALSE
    expect(row!.deleted_at).toBeNull()
    expect(row!.first_event_at).not.toBeNull()
    expect(row!.last_event_at).not.toBeNull()
  })

  test("session.deleted marks session as deleted", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "session.created",
        session_id: "ses_001",
      })
    )

    // Usage update to accumulate tokens
    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_usage_001",
        event_type: "usage.updated",
        session_id: "ses_001",
        tokens: 2500,
        cost_usd: 0.0125,
      })
    )

    // Delete — tokens/cost_usd in the event are 0 (OpenCode doesn't send cumulative totals)
    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_del_001",
        event_type: "session.deleted",
        session_id: "ses_001",
        tokens: 0,
        cost_usd: 0,
      })
    )

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get() as Record<string, unknown> | null

    expect(row).not.toBeNull()
    expect(row!.deleted).toBe(1) // TRUE
    expect(row!.deleted_at).not.toBeNull()
    expect(row!.total_tokens).toBe(2500) // Preserved from usage.updated
    expect(row!.total_cost_usd).toBeCloseTo(0.0125) // Preserved from usage.updated
  })

  test("deleted session row is still queryable (not physically deleted)", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "session.created",
        session_id: "ses_001",
      })
    )
    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_del_001",
        event_type: "session.deleted",
        session_id: "ses_001",
        tokens: 100,
        cost_usd: 0.001,
      })
    )

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get()
    expect(row).not.toBeNull()
  })

  test("usage.updated increments tokens and cost", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "session.created",
        session_id: "ses_001",
      })
    )

    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_usage_001",
        event_type: "usage.updated",
        session_id: "ses_001",
        tokens: 1500,
        cost_usd: 0.0075,
      })
    )

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get() as Record<string, unknown> | null

    expect(row!.total_tokens).toBe(1500)
    expect(row!.total_cost_usd).toBeCloseTo(0.0075)
  })

  test("usage.updated accumulates multiple updates", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "session.created",
        session_id: "ses_001",
      })
    )

    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_usage_001",
        event_type: "usage.updated",
        session_id: "ses_001",
        tokens: 1500,
        cost_usd: 0.0075,
      })
    )
    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_usage_002",
        event_type: "usage.updated",
        session_id: "ses_001",
        tokens: 1500,
        cost_usd: 0.0075,
      })
    )

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get() as Record<string, unknown> | null

    expect(row!.total_tokens).toBe(3000)
    expect(row!.total_cost_usd).toBeCloseTo(0.015)
  })

  test("unknown event types are silently ignored", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "unknown.event" as IngestEventEnvelope["event_type"],
        event_id: "evt_unknown_001",
      })
    )

    const count = (
      db.query("SELECT COUNT(*) as cnt FROM sessions").get() as {
        cnt: number
      }
    ).cnt
    expect(count).toBe(0)
  })

  test("full lifecycle: create → usage → delete", () => {
    processSessionEvent(
      db,
      validEvent({
        event_type: "session.created",
        session_id: "ses_001",
      })
    )

    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_usage_001",
        event_type: "usage.updated",
        session_id: "ses_001",
        tokens: 1500,
        cost_usd: 0.0075,
      })
    )

    processSessionEvent(
      db,
      validEvent({
        event_id: "evt_del_001",
        event_type: "session.deleted",
        session_id: "ses_001",
        tokens: 0,
        cost_usd: 0,
      })
    )

    const row = db
      .query("SELECT * FROM sessions WHERE session_id = 'ses_001'")
      .get() as Record<string, unknown> | null

    expect(row!.deleted).toBe(1)
    expect(row!.total_tokens).toBe(1500)
    expect(row!.total_cost_usd).toBeCloseTo(0.0075)
    expect(row!.deleted_at).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tool reducer tests
// ---------------------------------------------------------------------------

describe("processToolEvent", () => {
  let db: Database

  beforeEach(() => {
    db = setupDb()
  })

  test("tool.started inserts into tool_calls", () => {
    const event = validEvent({
      event_id: "evt_tool_001",
      event_type: "tool.started",
      session_id: "ses_001",
      tool: "bash",
      status: "started",
      summary: "run npm install",
    })

    processToolEvent(db, event)

    const row = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null

    expect(row).not.toBeNull()
    expect(row!.tool_name).toBe("bash")
    expect(row!.session_id).toBe("ses_001")
    expect(row!.status).toBe("started")
    expect(row!.completed_at).toBeNull()
  })

  test("tool.completed updates status and completed_at", () => {
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_tool_start",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "bash",
        status: "started",
        timestamp_ms: 1717400050000,
      })
    )

    processToolEvent(
      db,
      validEvent({
        event_id: "evt_tool_done",
        event_type: "tool.completed",
        session_id: "ses_001",
        tool: "bash",
        status: "completed",
        timestamp_ms: 1717400060000,
        tokens: 350,
        cost_usd: 0.0018,
        summary: "npm install done",
      })
    )

    const row = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null

    expect(row!.status).toBe("completed")
    expect(row!.completed_at).not.toBeNull()
    expect(row!.tokens).toBe(350)
    expect(row!.cost_usd).toBeCloseTo(0.0018)
    expect(row!.summary).toBe("npm install done")
  })

  test("tool.failed updates status", () => {
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_tool_start",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "bash",
        status: "started",
      })
    )

    processToolEvent(
      db,
      validEvent({
        event_id: "evt_tool_fail",
        event_type: "tool.failed",
        session_id: "ses_001",
        tool: "bash",
        status: "failed",
      })
    )

    const row = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null

    expect(row!.status).toBe("failed")
    expect(row!.completed_at).toBeNull()
  })

  test("tool.started is idempotent", () => {
    const event = validEvent({
      event_id: "evt_tool_dup",
      event_type: "tool.started",
      session_id: "ses_001",
      tool: "bash",
      status: "started",
    })

    processToolEvent(db, event)
    processToolEvent(db, event) // second call should be idempotent

    const count = (
      db
        .query(
          "SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = 'ses_001'"
        )
        .get() as { cnt: number }
    ).cnt
    expect(count).toBe(1)
  })

  test("tool.completed without started throws", () => {
    expect(() => {
      processToolEvent(
        db,
        validEvent({
          event_id: "evt_tool_orphan",
          event_type: "tool.completed",
          session_id: "ses_001",
          tool: "bash",
          status: "completed",
        })
      )
    }).toThrow("no matching 'started' record found for tool call")
  })

  test("tool.failed without started throws", () => {
    expect(() => {
      processToolEvent(
        db,
        validEvent({
          event_id: "evt_tool_orphan",
          event_type: "tool.failed",
          session_id: "ses_001",
          tool: "bash",
          status: "failed",
        })
      )
    }).toThrow("no matching 'started' record found for tool call")
  })

  test("missing tool field throws", () => {
    expect(() => {
      processToolEvent(
        db,
        validEvent({
          event_id: "evt_no_tool",
          event_type: "tool.started",
          session_id: "ses_001",
          tool: null,
          status: "started",
        })
      )
    }).toThrow("event missing required 'tool' field")
  })

  test("missing status field throws", () => {
    expect(() => {
      processToolEvent(
        db,
        validEvent({
          event_id: "evt_no_status",
          event_type: "tool.started",
          session_id: "ses_001",
          tool: "bash",
          status: null,
        })
      )
    }).toThrow("event missing required 'status' field")
  })

  test("full lifecycle: started → completed", () => {
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_t001",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "bash",
        status: "started",
        timestamp_ms: 1717400050000,
        summary: "run npm install",
      })
    )

    let row = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null
    expect(row!.status).toBe("started")
    expect(row!.completed_at).toBeNull()

    processToolEvent(
      db,
      validEvent({
        event_id: "evt_t002",
        event_type: "tool.completed",
        session_id: "ses_001",
        tool: "bash",
        status: "completed",
        timestamp_ms: 1717400060000,
        tokens: 350,
        cost_usd: 0.0018,
        summary: "npm install done",
      })
    )

    row = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null
    expect(row!.status).toBe("completed")
    expect(row!.completed_at).not.toBeNull()
  })

  test("multiple tools independent per session", () => {
    // Start bash
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_bash_start",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "bash",
        status: "started",
        timestamp_ms: 1717400050000,
      })
    )
    // Start read
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_read_start",
        event_type: "tool.started",
        session_id: "ses_001",
        tool: "read",
        status: "started",
        timestamp_ms: 1717400051000,
      })
    )

    // Complete bash only
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_bash_done",
        event_type: "tool.completed",
        session_id: "ses_001",
        tool: "bash",
        status: "completed",
        timestamp_ms: 1717400060000,
        tokens: 100,
        cost_usd: 0.001,
      })
    )

    const bashRow = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'bash'"
      )
      .get() as Record<string, unknown> | null
    expect(bashRow!.status).toBe("completed")

    const readRow = db
      .query(
        "SELECT * FROM tool_calls WHERE session_id = 'ses_001' AND tool_name = 'read'"
      )
      .get() as Record<string, unknown> | null
    expect(readRow!.status).toBe("started")
  })

  test("unknown tool status is ignored", () => {
    processToolEvent(
      db,
      validEvent({
        event_id: "evt_unknown",
        event_type: "tool.unknown",
        session_id: "ses_001",
        tool: "bash",
        status: "unknown_status" as "started",
      })
    )

    const count = (
      db
        .query(
          "SELECT COUNT(*) as cnt FROM tool_calls WHERE session_id = 'ses_001'"
        )
        .get() as { cnt: number }
    ).cnt
    expect(count).toBe(0)
  })
})
