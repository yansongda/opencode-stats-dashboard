/**
 * SQLite schema definitions and migration runner for the opencode-stats database.
 *
 * All tables are created idempotently. The `schema_migrations` table tracks
 * which migration versions have been applied so that repeated calls to
 * {@link runMigrations} are safe.
 */

import { Database } from "bun:sqlite"

/** Current schema version — bump when adding new migrations. */
export const CURRENT_VERSION = 1

/** Migration definitions: [version, SQL statements]. */
const MIGRATIONS: [number, string[]][] = [
  [
    1,
    [
      // ── events: raw ingest log ──────────────────────────────────────
      `CREATE TABLE IF NOT EXISTS events (
          event_id     TEXT PRIMARY KEY,
          event_type   TEXT NOT NULL,
          session_id   TEXT NOT NULL,
          project_path TEXT,
          timestamp_ms INTEGER NOT NULL,
          model        TEXT,
          tokens       INTEGER,
          cost_usd     REAL,
          tool         TEXT,
          status       TEXT,
          summary      TEXT,
          deleted      BOOLEAN DEFAULT FALSE,
          metadata     TEXT,
          created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      "CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_events_type      ON events(event_type)",
      "CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp_ms)",
      // ── sessions: aggregated session record ──────────────────────────
      `CREATE TABLE IF NOT EXISTS sessions (
          session_id      TEXT PRIMARY KEY,
          project_path    TEXT,
          model           TEXT,
          total_tokens    INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          deleted         BOOLEAN DEFAULT FALSE,
          deleted_at      DATETIME,
          first_event_at  DATETIME,
          last_event_at   DATETIME,
          tool_call_count INTEGER DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_deleted ON sessions(deleted)",
      // ── tool_calls: per-tool audit trail ─────────────────────────────
      `CREATE TABLE IF NOT EXISTS tool_calls (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          tool_name     TEXT NOT NULL,
          session_id    TEXT NOT NULL,
          status        TEXT NOT NULL,
          model         TEXT,
          tokens        INTEGER,
          cost_usd      REAL,
          started_at    DATETIME,
          completed_at  DATETIME,
          summary       TEXT,
          UNIQUE(session_id, tool_name, started_at)
      )`,
      "CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_tool_calls_tool    ON tool_calls(tool_name)",
      // ── daily_usage: pre-aggregated daily stats ──────────────────────
      `CREATE TABLE IF NOT EXISTS daily_usage (
          date            TEXT PRIMARY KEY,
          session_count   INTEGER DEFAULT 0,
          deleted_count   INTEGER DEFAULT 0,
          total_tokens    INTEGER DEFAULT 0,
          total_cost_usd  REAL DEFAULT 0,
          tool_call_count INTEGER DEFAULT 0
      )`,
      // ── schema_migrations: version tracking ──────────────────────────
      `CREATE TABLE IF NOT EXISTS schema_migrations (
          version     INTEGER PRIMARY KEY,
          applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
    ],
  ],
]

/** Return the highest applied migration version, or 0 if none. */
function currentVersion(db: Database): number {
  // Table may not exist yet on first run — treat as version 0.
  const exists = db
    .query(
      "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    )
    .get() as { cnt: number } | null

  if (!exists || exists.cnt === 0) {
    return 0
  }

  const row = db
    .query("SELECT COALESCE(MAX(version), 0) as v FROM schema_migrations")
    .get() as { v: number } | null

  return row?.v ?? 0
}

/**
 * Run all pending migrations inside a single transaction.
 *
 * This function is idempotent — calling it multiple times with the same
 * database is safe and will only apply new migrations.
 *
 * @returns The number of migrations applied (0 if already up-to-date).
 */
export function runMigrations(db: Database): number {
  const current = currentVersion(db)
  let appliedCount = 0

  const tx = db.transaction(() => {
    for (const [version, statements] of MIGRATIONS) {
      if (version <= current) {
        continue
      }
      for (const sql of statements) {
        db.run(sql)
      }
      db.run("INSERT INTO schema_migrations (version) VALUES (?)", [version])
      appliedCount++
    }
  })

  tx()
  return appliedCount
}
