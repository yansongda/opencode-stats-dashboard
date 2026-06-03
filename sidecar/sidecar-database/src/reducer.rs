//! Session and tool-call state reducers for processing ingest events.
//!
//! - [`SessionReducer`] maintains the `sessions` aggregated table by reacting
//!   to session lifecycle events. It never deletes session rows — deletion
//!   events only set `deleted = true` to preserve audit history.
//! - [`ToolReducer`] maintains the `tool_calls` table by reacting to tool
//!   lifecycle events (`tool.started`, `tool.completed`, `tool.failed`).

use chrono::TimeZone;
use rusqlite::{params, Connection};
use thiserror::Error;

use crate::event::IngestEventEnvelope;

/// Errors that can occur during event processing.
#[derive(Debug, Error)]
pub enum ReducerError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("event missing required 'tool' field")]
    MissingToolName,

    #[error("event missing required 'status' field")]
    MissingStatus,

    #[error("no matching 'started' record found for tool call")]
    NoMatchingStartedRecord,
}

/// Session state reducer.
///
/// Processes [`IngestEventEnvelope`] events and updates the `sessions`
/// table accordingly.
pub struct SessionReducer;

impl SessionReducer {
    /// Process a single ingest event and update the sessions table.
    ///
    /// - `session.created` → INSERT OR REPLACE into sessions
    /// - `session.deleted` → UPDATE sessions SET deleted=true, preserve usage
    /// - `usage.updated`   → UPDATE sessions SET total_tokens += N, total_cost_usd += N
    ///
    /// Unknown event types are silently ignored (returning `Ok`).
    pub fn process_event(
        &self,
        conn: &Connection,
        event: &IngestEventEnvelope,
    ) -> Result<(), ReducerError> {
        match event.event_type.as_str() {
            "session.created" => {
                conn.execute(
                    r#"
                    INSERT OR REPLACE INTO sessions (
                        session_id, project_path, model,
                        total_tokens, total_cost_usd,
                        deleted, deleted_at,
                        first_event_at, last_event_at,
                        tool_call_count
                    ) VALUES (
                        ?1, ?2, ?3,
                        ?4, ?5,
                        FALSE, NULL,
                        datetime(?6 / 1000, 'unixepoch'),
                        datetime(?6 / 1000, 'unixepoch'),
                        0
                    )
                    "#,
                    params![
                        event.session_id,
                        event.project_path,
                        event.model,
                        event.tokens,
                        event.cost_usd,
                        event.timestamp_ms,
                    ],
                )?;
            }
            "session.deleted" => {
                conn.execute(
                    r#"
                    UPDATE sessions
                    SET deleted       = TRUE,
                        deleted_at    = datetime(?2 / 1000, 'unixepoch'),
                        last_event_at = datetime(?2 / 1000, 'unixepoch'),
                        total_tokens  = ?3,
                        total_cost_usd = ?4
                    WHERE session_id = ?1
                    "#,
                    params![
                        event.session_id,
                        event.timestamp_ms,
                        event.tokens,
                        event.cost_usd,
                    ],
                )?;
            }
            "usage.updated" => {
                conn.execute(
                    r#"
                    UPDATE sessions
                    SET total_tokens   = total_tokens + ?2,
                        total_cost_usd = total_cost_usd + ?3,
                        last_event_at  = datetime(?4 / 1000, 'unixepoch')
                    WHERE session_id = ?1
                    "#,
                    params![
                        event.session_id,
                        event.tokens,
                        event.cost_usd,
                        event.timestamp_ms,
                    ],
                )?;
            }
            _ => {
                // Unknown event type — nothing to reduce for sessions.
            }
        }
        Ok(())
    }
}

/// Tool-call lifecycle reducer.
///
/// Processes tool events and maintains the `tool_calls` table as an
/// aggregated audit trail. Uses `(session_id, tool_name, started_at)`
/// for stable identity.
pub struct ToolReducer;

impl ToolReducer {
    pub fn process_tool_event(
        &self,
        conn: &Connection,
        event: &IngestEventEnvelope,
    ) -> Result<(), ReducerError> {
        let tool_name = event
            .tool
            .as_deref()
            .ok_or(ReducerError::MissingToolName)?;
        let status = event
            .status
            .as_deref()
            .ok_or(ReducerError::MissingStatus)?;

        match status {
            "started" => {
                let started_at =
                    chrono::Utc.timestamp_millis_opt(event.timestamp_ms as i64).single()
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());

                conn.execute(
                    r#"
                    INSERT OR IGNORE INTO tool_calls (
                        tool_name, session_id, status, model, tokens, cost_usd,
                        started_at, completed_at, summary
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8)
                    "#,
                    params![
                        tool_name,
                        event.session_id,
                        "started",
                        event.model,
                        event.tokens,
                        event.cost_usd,
                        started_at,
                        event.summary,
                    ],
                )?;
            }
            "completed" => {
                let completed_at =
                    chrono::Utc.timestamp_millis_opt(event.timestamp_ms as i64).single()
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string());

                let rows = conn.execute(
                    r#"
                    UPDATE tool_calls
                    SET status = 'completed',
                        completed_at = ?1,
                        tokens = ?2,
                        cost_usd = ?3,
                        summary = ?4
                    WHERE id = (
                        SELECT id FROM tool_calls
                        WHERE session_id = ?5 AND tool_name = ?6 AND status = 'started'
                        ORDER BY started_at DESC
                        LIMIT 1
                    )
                    "#,
                    params![
                        completed_at,
                        event.tokens,
                        event.cost_usd,
                        event.summary,
                        event.session_id,
                        tool_name,
                    ],
                )?;

                if rows == 0 {
                    return Err(ReducerError::NoMatchingStartedRecord);
                }
            }
            "failed" => {
                let rows = conn.execute(
                    r#"
                    UPDATE tool_calls
                    SET status = 'failed'
                    WHERE id = (
                        SELECT id FROM tool_calls
                        WHERE session_id = ?1 AND tool_name = ?2 AND status = 'started'
                        ORDER BY started_at DESC
                        LIMIT 1
                    )
                    "#,
                    params![event.session_id, tool_name],
                )?;

                if rows == 0 {
                    return Err(ReducerError::NoMatchingStartedRecord);
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::IngestEventEnvelope;
    use crate::schema::run_migrations;
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        run_migrations(&conn).expect("migrations should succeed");
        conn
    }

    fn fixtures_dir() -> PathBuf {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        PathBuf::from(manifest_dir)
            .ancestors()
            .nth(2)
            .unwrap()
            .join("fixtures")
            .join("events")
    }

    fn load_fixture(name: &str) -> IngestEventEnvelope {
        let path = fixtures_dir().join(format!("{}.json", name));
        let raw = fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("Failed to read {:?}: {}", path, e));
        IngestEventEnvelope::from_json(&raw)
            .unwrap_or_else(|e| panic!("Failed to parse {:?}: {}", path, e))
    }

    /// Helper: query a session row as (session_id, project_path, model, total_tokens, total_cost_usd, deleted, deleted_at, first_event_at, last_event_at, tool_call_count).
    fn query_session(
        conn: &Connection,
        session_id: &str,
    ) -> Option<(
        String,
        String,
        String,
        i64,
        f64,
        bool,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    )> {
        let mut stmt = conn
            .prepare(
                "SELECT session_id, project_path, model, total_tokens, total_cost_usd, \
                 deleted, deleted_at, first_event_at, last_event_at, tool_call_count \
                 FROM sessions WHERE session_id = ?1",
            )
            .expect("prepare query");
        stmt.query_row(params![session_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, i64>(9)?,
            ))
        })
        .ok()
    }

    // ── session.created ──────────────────────────────────────────────

    #[test]
    fn reducer_creates_session_from_created_event() {
        let conn = setup_db();
        let reducer = SessionReducer;
        let event = load_fixture("session-created");

        reducer.process_event(&conn, &event).expect("process should succeed");

        let row = query_session(&conn, &event.session_id)
            .expect("session should exist after created event");

        assert_eq!(row.0, "ses_fixture_001");
        assert_eq!(row.1, "/Users/user/my-project");
        assert_eq!(row.2, "claude-sonnet-4-20250514");
        assert_eq!(row.3, 0, "initial tokens should be 0");
        assert!((row.4 - 0.0).abs() < f64::EPSILON, "initial cost should be 0.0");
        assert!(!row.5, "session should not be deleted");
        assert!(row.6.is_none(), "deleted_at should be NULL");
        assert!(row.7.is_some(), "first_event_at should be set");
        assert!(row.8.is_some(), "last_event_at should be set");
    }

    // ── session.deleted ──────────────────────────────────────────────

    #[test]
    fn reducer_marks_session_deleted_and_preserves_usage() {
        let conn = setup_db();
        let reducer = SessionReducer;

        // Create the session first
        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create should succeed");

        // Now delete it — the deleted fixture carries usage totals
        let deleted = load_fixture("session-deleted");
        reducer.process_event(&conn, &deleted).expect("delete should succeed");

        let row = query_session(&conn, &deleted.session_id)
            .expect("session should still exist after deletion");

        assert!(row.5, "session should be marked deleted");
        assert!(row.6.is_some(), "deleted_at should be set");
        assert_eq!(row.3, 2500, "tokens from deleted event should be preserved");
        assert!(
            (row.4 - 0.0125).abs() < f64::EPSILON,
            "cost from deleted event should be preserved, got {}",
            row.4
        );
    }

    #[test]
    fn reducer_deleted_session_still_queryable() {
        let conn = setup_db();
        let reducer = SessionReducer;

        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create");

        let deleted = load_fixture("session-deleted");
        reducer.process_event(&conn, &deleted).expect("delete");

        // Query with deleted=true filter (simulates API behavior)
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE deleted = TRUE AND session_id = ?1",
                params![deleted.session_id],
                |row| row.get(0),
            )
            .expect("count query");

        assert_eq!(count, 1, "deleted session should be queryable");
    }

    #[test]
    fn reducer_does_not_delete_session_row() {
        let conn = setup_db();
        let reducer = SessionReducer;

        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create");

        let deleted = load_fixture("session-deleted");
        reducer.process_event(&conn, &deleted).expect("delete");

        // Row must still exist — never physically deleted
        let exists = query_session(&conn, &deleted.session_id);
        assert!(exists.is_some(), "session row must not be physically deleted");
    }

    // ── usage.updated ────────────────────────────────────────────────

    #[test]
    fn reducer_updates_usage_tokens_and_cost() {
        let conn = setup_db();
        let reducer = SessionReducer;

        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create");

        let updated = load_fixture("usage-updated");
        reducer.process_event(&conn, &updated).expect("update");

        let row = query_session(&conn, &updated.session_id)
            .expect("session should exist");

        assert_eq!(row.3, 1500, "tokens should be updated from usage event");
        assert!(
            (row.4 - 0.0075).abs() < f64::EPSILON,
            "cost should be updated, got {}",
            row.4
        );
    }

    #[test]
    fn reducer_accumulates_multiple_usage_updates() {
        let conn = setup_db();
        let reducer = SessionReducer;

        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create");

        let updated = load_fixture("usage-updated");
        reducer.process_event(&conn, &updated).expect("first update");
        reducer.process_event(&conn, &updated).expect("second update");

        let row = query_session(&conn, &updated.session_id)
            .expect("session should exist");

        assert_eq!(row.3, 3000, "tokens should accumulate (1500 * 2)");
        assert!(
            (row.4 - 0.015).abs() < f64::EPSILON,
            "cost should accumulate (0.0075 * 2), got {}",
            row.4
        );
    }

    // ── edge cases ───────────────────────────────────────────────────

    #[test]
    fn reducer_ignores_unknown_event_types() {
        let conn = setup_db();
        let reducer = SessionReducer;

        let mut event = load_fixture("session-created");
        event.event_type = "unknown.event".to_string();
        event.event_id = "evt_unknown_001".to_string();

        let result = reducer.process_event(&conn, &event);
        assert!(result.is_ok(), "unknown events should not error");
    }

    #[test]
    fn reducer_no_historical_recovery_without_events() {
        let conn = setup_db();

        // Query without processing any events
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count query");

        assert_eq!(count, 0, "no sessions should exist without events");
    }

    // ── full lifecycle: create → usage → delete ──────────────────────

    #[test]
    fn reducer_preserves_deleted_session_usage() {
        let conn = setup_db();
        let reducer = SessionReducer;

        // 1. Create session
        let created = load_fixture("session-created");
        reducer.process_event(&conn, &created).expect("create");

        // 2. Incremental usage update
        let updated = load_fixture("usage-updated");
        reducer.process_event(&conn, &updated).expect("usage update");

        // 3. Delete session (carries final cumulative totals)
        let deleted = load_fixture("session-deleted");
        reducer.process_event(&conn, &deleted).expect("delete");

        let row = query_session(&conn, "ses_fixture_001")
            .expect("session should exist");

        // After delete, total_tokens is set to the deleted event's value (2500)
        assert!(row.5, "session should be deleted");
        assert_eq!(row.3, 2500, "deleted event sets final token total");
        assert!(
            (row.4 - 0.0125).abs() < f64::EPSILON,
            "deleted event sets final cost, got {}",
            row.4
        );
        assert!(row.6.is_some(), "deleted_at should be set");
    }

    // ── ToolReducer: tool lifecycle ─────────────────────────────────

    fn make_tool_event(
        event_id: &str,
        event_type: &str,
        session_id: &str,
        tool: Option<&str>,
        status: Option<&str>,
        timestamp_ms: u64,
        tokens: u64,
        cost_usd: f64,
        summary: Option<&str>,
    ) -> IngestEventEnvelope {
        IngestEventEnvelope {
            event_id: event_id.to_string(),
            event_type: event_type.to_string(),
            session_id: session_id.to_string(),
            project_path: "/tmp/test".to_string(),
            timestamp_ms,
            model: "claude-sonnet-4-20250514".to_string(),
            tokens,
            cost_usd,
            tool: tool.map(|s| s.to_string()),
            status: status.map(|s| s.to_string()),
            summary: summary.map(|s| s.to_string()),
            deleted: false,
            metadata: std::collections::HashMap::new(),
        }
    }

    fn query_tool_call(
        conn: &Connection,
        session_id: &str,
        tool_name: &str,
    ) -> Option<(String, String, String, Option<String>)> {
        conn.query_row(
            "SELECT tool_name, session_id, status, completed_at \
             FROM tool_calls WHERE session_id = ?1 AND tool_name = ?2",
            params![session_id, tool_name],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .ok()
    }

    #[test]
    fn tool_started_inserts_into_tool_calls() {
        let conn = setup_db();
        let reducer = ToolReducer;
        let event = load_fixture("tool-call-started");

        reducer.process_tool_event(&conn, &event).expect("should succeed");

        let row = query_tool_call(&conn, "ses_fixture_001", "bash").expect("row should exist");
        assert_eq!(row.0, "bash");
        assert_eq!(row.1, "ses_fixture_001");
        assert_eq!(row.2, "started");
        assert!(row.3.is_none(), "completed_at should be NULL for started");
    }

    #[test]
    fn tool_completed_updates_status() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let started = load_fixture("tool-call-started");
        reducer.process_tool_event(&conn, &started).expect("started");

        let completed = load_fixture("tool-call-completed");
        reducer.process_tool_event(&conn, &completed).expect("completed");

        let row = query_tool_call(&conn, "ses_fixture_001", "bash").expect("row should exist");
        assert_eq!(row.2, "completed");
        assert!(row.3.is_some(), "completed_at should be set");
    }

    #[test]
    fn tool_failed_updates_status() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let started = make_tool_event(
            "evt_f001", "tool.started", "ses_f001",
            Some("bash"), Some("started"), 1717400050000, 0, 0.0, None,
        );
        reducer.process_tool_event(&conn, &started).expect("started");

        let failed = make_tool_event(
            "evt_f002", "tool.failed", "ses_f001",
            Some("bash"), Some("failed"), 1717400055000, 0, 0.0, None,
        );
        reducer.process_tool_event(&conn, &failed).expect("failed");

        let row = query_tool_call(&conn, "ses_f001", "bash").expect("row should exist");
        assert_eq!(row.2, "failed");
        assert!(row.3.is_none(), "completed_at should remain NULL for failed");
    }

    #[test]
    fn tool_started_is_idempotent() {
        let conn = setup_db();
        let reducer = ToolReducer;
        let event = load_fixture("tool-call-started");

        reducer.process_tool_event(&conn, &event).expect("first");
        reducer.process_tool_event(&conn, &event).expect("second should be idempotent");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tool_calls WHERE session_id = 'ses_fixture_001'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn tool_completed_without_started_errors() {
        let conn = setup_db();
        let reducer = ToolReducer;
        let event = load_fixture("tool-call-completed");

        let result = reducer.process_tool_event(&conn, &event);
        assert!(matches!(result, Err(ReducerError::NoMatchingStartedRecord)));
    }

    #[test]
    fn tool_failed_without_started_errors() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let event = make_tool_event(
            "evt_f003", "tool.failed", "ses_f002",
            Some("bash"), Some("failed"), 1717400055000, 0, 0.0, None,
        );

        let result = reducer.process_tool_event(&conn, &event);
        assert!(matches!(result, Err(ReducerError::NoMatchingStartedRecord)));
    }

    #[test]
    fn missing_tool_name_errors() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let event = make_tool_event(
            "evt_f004", "tool.started", "ses_f003",
            None, Some("started"), 1717400050000, 0, 0.0, None,
        );

        let result = reducer.process_tool_event(&conn, &event);
        assert!(matches!(result, Err(ReducerError::MissingToolName)));
    }

    #[test]
    fn missing_status_errors() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let event = make_tool_event(
            "evt_f005", "tool.started", "ses_f004",
            Some("bash"), None, 1717400050000, 0, 0.0, None,
        );

        let result = reducer.process_tool_event(&conn, &event);
        assert!(matches!(result, Err(ReducerError::MissingStatus)));
    }

    #[test]
    fn unknown_tool_status_is_ignored() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let event = make_tool_event(
            "evt_f006", "tool.unknown", "ses_f005",
            Some("bash"), Some("unknown_status"), 1717400050000, 0, 0.0, None,
        );

        reducer.process_tool_event(&conn, &event).expect("should succeed");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tool_calls WHERE session_id = 'ses_f005'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn tool_full_lifecycle_started_then_completed() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let started = make_tool_event(
            "evt_f007", "tool.started", "ses_f006",
            Some("bash"), Some("started"), 1717400050000, 0, 0.0, Some("run npm install"),
        );
        reducer.process_tool_event(&conn, &started).expect("started");

        let row = query_tool_call(&conn, "ses_f006", "bash").expect("row");
        assert_eq!(row.2, "started");
        assert!(row.3.is_none());

        let completed = make_tool_event(
            "evt_f008", "tool.completed", "ses_f006",
            Some("bash"), Some("completed"), 1717400060000, 350, 0.0018, Some("npm install done"),
        );
        reducer.process_tool_event(&conn, &completed).expect("completed");

        let row = query_tool_call(&conn, "ses_f006", "bash").expect("row");
        assert_eq!(row.2, "completed");
        assert!(row.3.is_some());
    }

    #[test]
    fn multiple_tools_independent_per_session() {
        let conn = setup_db();
        let reducer = ToolReducer;

        let bash_start = make_tool_event(
            "evt_f009", "tool.started", "ses_f007",
            Some("bash"), Some("started"), 1717400050000, 0, 0.0, None,
        );
        let read_start = make_tool_event(
            "evt_f010", "tool.started", "ses_f007",
            Some("read"), Some("started"), 1717400051000, 0, 0.0, None,
        );
        reducer.process_tool_event(&conn, &bash_start).expect("bash started");
        reducer.process_tool_event(&conn, &read_start).expect("read started");

        let bash_complete = make_tool_event(
            "evt_f011", "tool.completed", "ses_f007",
            Some("bash"), Some("completed"), 1717400060000, 100, 0.001, None,
        );
        reducer.process_tool_event(&conn, &bash_complete).expect("bash completed");

        let bash_row = query_tool_call(&conn, "ses_f007", "bash").expect("bash row");
        assert_eq!(bash_row.2, "completed");

        let read_row = query_tool_call(&conn, "ses_f007", "read").expect("read row");
        assert_eq!(read_row.2, "started");
    }
}
