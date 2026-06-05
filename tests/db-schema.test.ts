import { describe, it, expect, beforeEach } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { runMigrations, configurePragmas, CURRENT_VERSION } from "../src/db/schema"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh in-memory database for each test */
function createTestDb(): Database {
  const db = new Database(":memory:")
  return db
}

/** Create a temporary file-based database for WAL testing */
function createTempFileDb(): { db: Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "schema-test-"))
  const db = new Database(join(dir, "test.db"))
  return { db, dir }
}

/** Query sqlite_master for existing table names */
function getTableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

/** Query a PRAGMA value */
function getPragma(db: Database, name: string): unknown {
  const row = db.query(`PRAGMA ${name}`).get() as Record<string, unknown>
  return Object.values(row)[0]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("configurePragmas", () => {
  it("sets journal_mode to WAL", () => {
    const { db, dir } = createTempFileDb()
    configurePragmas(db)
    expect(getPragma(db, "journal_mode")).toBe("wal")
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("sets synchronous to NORMAL", () => {
    const { db, dir } = createTempFileDb()
    configurePragmas(db)
    expect(getPragma(db, "synchronous")).toBe(1)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("runMigrations", () => {
  let db: Database

  beforeEach(() => {
    db = createTestDb()
  })

  it("returns current version number", () => {
    expect(CURRENT_VERSION).toBeGreaterThan(0)
  })

  it("creates all 5 tables on first run", () => {
    runMigrations(db)

    const tables = getTableNames(db)
    expect(tables).toContain("events")
    expect(tables).toContain("projection_sessions")
    expect(tables).toContain("projection_daily")
    expect(tables).toContain("projection_tool_calls")
    expect(tables).toContain("snapshots")
    expect(tables).toContain("schema_migrations")

    db.close()
  })

  it("applies exactly one migration record on first run", () => {
    runMigrations(db)

    const rows = db
      .query("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[]
    expect(rows.length).toBe(1)
    expect(rows[0]!.version).toBe(1)

    db.close()
  })

  it("is idempotent — running twice creates no duplicate migration records", () => {
    runMigrations(db)
    runMigrations(db)

    const rows = db
      .query("SELECT version FROM schema_migrations ORDER BY version")
      .all() as { version: number }[]
    expect(rows.length).toBe(1)

    db.close()
  })

  it("events table has correct columns per design doc §3.1", () => {
    runMigrations(db)

    const cols = db
      .query("PRAGMA table_info(events)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toContain("event_id")
    expect(names).toContain("event_type")
    expect(names).toContain("session_id")
    expect(names).toContain("timestamp_ms")
    expect(names).toContain("ingested_at")
    expect(names).toContain("model")
    expect(names).toContain("total_tokens")
    expect(names).toContain("cost_usd")
    expect(names).toContain("event_contents")

    db.close()
  })

  it("projection_sessions table has correct columns per design doc §4.1", () => {
    runMigrations(db)

    const cols = db
      .query("PRAGMA table_info(projection_sessions)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toContain("session_id")
    expect(names).toContain("project_path")
    expect(names).toContain("title")
    expect(names).toContain("status")
    expect(names).toContain("primary_model")
    expect(names).toContain("model_usage")
    expect(names).toContain("first_event_at")
    expect(names).toContain("last_event_at")
    expect(names).toContain("duration_ms")
    expect(names).toContain("total_tokens")
    expect(names).toContain("total_cost_usd")
    expect(names).toContain("tool_call_count")
    expect(names).toContain("files_edited")
    expect(names).toContain("lines_added")
    expect(names).toContain("lines_deleted")

    db.close()
  })

  it("projection_daily table has correct columns per design doc §4.2", () => {
    runMigrations(db)

    const cols = db
      .query("PRAGMA table_info(projection_daily)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toContain("date")
    expect(names).toContain("project_path")
    expect(names).toContain("model")
    expect(names).toContain("session_count")
    expect(names).toContain("message_count")
    expect(names).toContain("total_tokens")
    expect(names).toContain("total_cost_usd")
    expect(names).toContain("tool_calls")
    expect(names).toContain("files_edited")

    db.close()
  })

  it("projection_tool_calls table has correct columns per design doc §4.3", () => {
    runMigrations(db)

    const cols = db
      .query("PRAGMA table_info(projection_tool_calls)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toContain("call_id")
    expect(names).toContain("session_id")
    expect(names).toContain("tool_name")
    expect(names).toContain("status")
    expect(names).toContain("started_at")
    expect(names).toContain("completed_at")
    expect(names).toContain("duration_ms")
    expect(names).toContain("cost_usd")

    db.close()
  })

  it("snapshots table has correct columns per design doc §5.1", () => {
    runMigrations(db)

    const cols = db
      .query("PRAGMA table_info(snapshots)")
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toContain("snapshot_id")
    expect(names).toContain("snapshot_type")
    expect(names).toContain("target_id")
    expect(names).toContain("snapshot_at")
    expect(names).toContain("period_start")
    expect(names).toContain("period_end")
    expect(names).toContain("snapshot_data")
    expect(names).toContain("event_count")

    db.close()
  })
})
