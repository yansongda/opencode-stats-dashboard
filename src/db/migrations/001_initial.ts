/**
 * Migration 001: Initial schema — all 5 core tables.
 *
 * Tables:
 *   - events              (Event Store, §3.1)
 *   - projection_sessions  (§4.1)
 *   - projection_daily     (§4.2)
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
      timestamp_ms    INTEGER NOT NULL,
      ingested_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      model           TEXT,
      total_tokens    INTEGER DEFAULT 0,
      cost_usd        REAL DEFAULT 0,
      event_contents  TEXT NOT NULL DEFAULT '{}'
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)");
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp_ms)",
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_events_model ON events(model)");

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
      primary_agent             TEXT,
      agent_usage               TEXT,
      error_count               INTEGER DEFAULT 0,
      projected_at              DATETIME DEFAULT CURRENT_TIMESTAMP,
      event_count               INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projection_daily (
      date                TEXT NOT NULL,
      project_path        TEXT NOT NULL,
      model               TEXT NOT NULL,
      session_count       INTEGER DEFAULT 0,
      active_sessions     INTEGER DEFAULT 0,
      deleted_sessions    INTEGER DEFAULT 0,
      message_count       INTEGER DEFAULT 0,
      user_messages       INTEGER DEFAULT 0,
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
      agent_usage         TEXT,
      error_count         INTEGER DEFAULT 0,
      projected_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
      event_count         INTEGER DEFAULT 0,
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
      input_tokens    INTEGER DEFAULT 0,
      output_tokens   INTEGER DEFAULT 0,
      cache_read      INTEGER DEFAULT 0,
      cache_write     INTEGER DEFAULT 0,
      cost_usd        REAL DEFAULT 0,
      title           TEXT,
      error_message   TEXT,
      projected_at    DATETIME DEFAULT CURRENT_TIMESTAMP
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

  db.run(`
    CREATE TABLE IF NOT EXISTS snapshots (
      snapshot_id     TEXT PRIMARY KEY,
      snapshot_type   TEXT NOT NULL,
      target_id       TEXT NOT NULL,
      snapshot_at     INTEGER NOT NULL,
      period_start    INTEGER,
      period_end      INTEGER,
      snapshot_data   TEXT NOT NULL,
      event_count     INTEGER,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(
    "CREATE INDEX IF NOT EXISTS idx_snap_type ON snapshots(snapshot_type)",
  );
  db.run("CREATE INDEX IF NOT EXISTS idx_snap_target ON snapshots(target_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_snap_time ON snapshots(snapshot_at)");
}
