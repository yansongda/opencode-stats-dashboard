/**
 * Migration 001: Initial schema — all 5 core tables.
 *
 * Tables:
 *   - events              (Event Store, §3.1)
 *   - projection_sessions  (§4.1)
 *   - projection_daily_model_usage (§4.2)
 *   - projection_tool_calls(§4.3)
 *   - snapshots            (§5.1)
 */

import type { Database } from "bun:sqlite";

export const VERSION = 1;

export function up(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      event_id        TEXT PRIMARY KEY,
      event_type      TEXT NOT NULL,
      session_id      TEXT NOT NULL,
      event_contents  TEXT NOT NULL DEFAULT '{}',
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at_ms   INTEGER NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at_ms)",
  );

  db.run(`
    CREATE TABLE IF NOT EXISTS projection_sessions (
      session_id                TEXT PRIMARY KEY,
      project_path              TEXT,
      title                     TEXT,
      status                    TEXT DEFAULT 'active',
      deleted_at                INTEGER,
      primary_model             TEXT,
      model_usage               TEXT,
      first_event_at            INTEGER,
      last_event_at             INTEGER,
      duration_ms               INTEGER,
      user_message_count        INTEGER DEFAULT 0,
      assistant_message_count   INTEGER DEFAULT 0,
      total_tokens              INTEGER DEFAULT 0,
      input_tokens              INTEGER DEFAULT 0,
      output_tokens             INTEGER DEFAULT 0,
      reasoning_tokens          INTEGER DEFAULT 0,
      cache_read                INTEGER DEFAULT 0,
      cache_write               INTEGER DEFAULT 0,
      total_cost_usd            REAL DEFAULT 0,
      tool_call_count           INTEGER DEFAULT 0,
      tool_error_count          INTEGER DEFAULT 0,
      files_edited              INTEGER DEFAULT 0,
      lines_added               INTEGER DEFAULT 0,
      lines_deleted             INTEGER DEFAULT 0,
      error_count               INTEGER DEFAULT 0,
      event_count               INTEGER DEFAULT 0,
      created_at                DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projection_daily_model_usage (
      date                TEXT NOT NULL,
      project_path        TEXT NOT NULL,
      model               TEXT NOT NULL,
      assistant_messages  INTEGER DEFAULT 0,
      total_tokens        INTEGER DEFAULT 0,
      input_tokens        INTEGER DEFAULT 0,
      output_tokens       INTEGER DEFAULT 0,
      reasoning_tokens    INTEGER DEFAULT 0,
      cache_read          INTEGER DEFAULT 0,
      cache_write         INTEGER DEFAULT 0,
      total_cost_usd      REAL DEFAULT 0,
      tool_calls          INTEGER DEFAULT 0,
      tool_errors         INTEGER DEFAULT 0,
      files_edited        INTEGER DEFAULT 0,
      lines_added         INTEGER DEFAULT 0,
      lines_deleted       INTEGER DEFAULT 0,
      error_count         INTEGER DEFAULT 0,
      event_count         INTEGER DEFAULT 0,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (date, project_path, model)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projection_tool_calls (
      call_id         TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      tool_name       TEXT NOT NULL,
      status          TEXT,
      started_at      INTEGER,
      completed_at    INTEGER,
      duration_ms     INTEGER,
      title           TEXT,
      error_message   TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_tc_session ON projection_tool_calls(session_id)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_tc_tool ON projection_tool_calls(tool_name)",
  );
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_tc_status ON projection_tool_calls(status)",
  );
}
