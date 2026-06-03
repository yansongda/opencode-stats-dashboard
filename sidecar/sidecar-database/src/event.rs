use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Result of an idempotent event insert.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InsertResult {
    /// Event was newly inserted.
    Accepted,
    /// Event with this `event_id` already existed (idempotent duplicate).
    Duplicate,
}

/// Insert an event into the `events` table idempotently.
///
/// Uses `INSERT OR IGNORE` on the `event_id` primary key. Returns
/// [`InsertResult::Duplicate`] when the `event_id` already exists.
pub fn insert_event(conn: &Connection, event: &IngestEventEnvelope) -> Result<InsertResult, rusqlite::Error> {
    let metadata_json = serde_json::to_string(&event.metadata).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        r#"
        INSERT OR IGNORE INTO events (
            event_id, event_type, session_id, project_path,
            timestamp_ms, model, tokens, cost_usd,
            tool, status, summary, deleted, metadata
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        "#,
        params![
            event.event_id,
            event.event_type,
            event.session_id,
            event.project_path,
            event.timestamp_ms,
            event.model,
            event.tokens,
            event.cost_usd,
            event.tool,
            event.status,
            event.summary,
            event.deleted,
            metadata_json,
        ],
    )?;

    if conn.changes() == 0 {
        Ok(InsertResult::Duplicate)
    } else {
        Ok(InsertResult::Accepted)
    }
}

/// Canonical ingest event envelope shared between TS plugin and Rust sidecar.
///
/// All fields use `Option` for nullable JSON values (null in JSON maps to None).
/// The `metadata` field must never contain full tool inputs/outputs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IngestEventEnvelope {
    /// UUID v4 — idempotency key for deduplication
    pub event_id: String,
    /// Discriminator for event routing
    pub event_type: String,
    /// OpenCode session identifier
    pub session_id: String,
    /// Absolute path to the project directory
    pub project_path: String,
    /// Event timestamp in milliseconds since epoch
    pub timestamp_ms: u64,
    /// Model identifier
    pub model: String,
    /// Token count associated with this event
    pub tokens: u64,
    /// Cost in USD associated with this event
    pub cost_usd: f64,
    /// Tool name — present only for tool events
    pub tool: Option<String>,
    /// Tool execution status — present only for tool events
    pub status: Option<String>,
    /// Short human-readable summary
    pub summary: Option<String>,
    /// Whether the session is deleted
    pub deleted: bool,
    /// Redacted metadata — no full tool inputs/outputs allowed
    pub metadata: HashMap<String, serde_json::Value>,
}

/// Privacy-sensitive keys that must NEVER appear in metadata.
pub const FORBIDDEN_METADATA_KEYS: &[&str] = &[
    "tool_input",
    "tool_output",
    "message_body",
    "raw_input",
    "raw_output",
];

impl IngestEventEnvelope {
    /// Validate that metadata does not contain forbidden full-payload keys.
    pub fn validate_privacy(&self) -> Result<(), String> {
        for key in FORBIDDEN_METADATA_KEYS {
            if self.metadata.contains_key(*key) {
                return Err(format!("full_payload_not_allowed: metadata contains forbidden key '{}'", key));
            }
        }
        Ok(())
    }

    /// Parse from JSON string.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

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

    const FIXTURE_NAMES: &[&str] = &[
        "session-created",
        "session-deleted",
        "usage-updated",
        "tool-call-started",
        "tool-call-completed",
        "duplicate-event",
        "privacy-redaction",
    ];

    #[test]
    fn all_fixtures_parse_successfully() {
        for name in FIXTURE_NAMES {
            let event = load_fixture(name);
            assert!(!event.event_id.is_empty(), "{}: event_id is empty", name);
            assert!(!event.event_type.is_empty(), "{}: event_type is empty", name);
            assert!(!event.session_id.is_empty(), "{}: session_id is empty", name);
            assert!(!event.project_path.is_empty(), "{}: project_path is empty", name);
            assert!(event.timestamp_ms > 0, "{}: timestamp_ms is 0", name);
        }
    }

    #[test]
    fn session_created_has_correct_fields() {
        let event = load_fixture("session-created");
        assert_eq!(event.event_type, "session.created");
        assert_eq!(event.deleted, false);
        assert_eq!(event.tokens, 0);
        assert_eq!(event.cost_usd, 0.0);
        assert!(event.tool.is_none());
        assert!(event.status.is_none());
    }

    #[test]
    fn session_deleted_has_deleted_true() {
        let event = load_fixture("session-deleted");
        assert_eq!(event.event_type, "session.deleted");
        assert_eq!(event.deleted, true);
        assert!(event.tokens > 0);
        assert!(event.cost_usd > 0.0);
        assert!(event.summary.is_some());
    }

    #[test]
    fn usage_updated_has_correct_fields() {
        let event = load_fixture("usage-updated");
        assert_eq!(event.event_type, "usage.updated");
        assert_eq!(event.deleted, false);
        assert!(event.tokens > 0);
        assert!(event.cost_usd > 0.0);
        assert!(event.summary.is_some());
    }

    #[test]
    fn tool_call_started_has_tool_and_status() {
        let event = load_fixture("tool-call-started");
        assert_eq!(event.event_type, "tool.started");
        assert_eq!(event.tool.as_deref(), Some("bash"));
        assert_eq!(event.status.as_deref(), Some("started"));
        assert_eq!(event.deleted, false);
    }

    #[test]
    fn tool_call_completed_has_metadata() {
        let event = load_fixture("tool-call-completed");
        assert_eq!(event.event_type, "tool.completed");
        assert_eq!(event.tool.as_deref(), Some("bash"));
        assert_eq!(event.status.as_deref(), Some("completed"));
        assert!(event.metadata.contains_key("exit_code"));
        assert!(event.metadata.contains_key("duration_ms"));
    }

    #[test]
    fn duplicate_event_shares_event_id_with_session_created() {
        let original = load_fixture("session-created");
        let duplicate = load_fixture("duplicate-event");
        assert_eq!(duplicate.event_id, original.event_id);
        assert_eq!(duplicate.session_id, original.session_id);
    }

    #[test]
    fn privacy_redaction_fixture_has_no_forbidden_keys() {
        let event = load_fixture("privacy-redaction");
        event.validate_privacy().expect("privacy validation should pass");
        for key in FORBIDDEN_METADATA_KEYS {
            assert!(
                !event.metadata.contains_key(*key),
                "privacy-redaction: metadata should not contain forbidden key '{}'",
                key
            );
        }
    }

    #[test]
    fn rejects_full_payload_by_default() {
        // Simulate an event with forbidden metadata keys
        let json = r#"{
            "event_id": "evt_test_privacy_reject",
            "event_type": "tool.completed",
            "session_id": "ses_test",
            "project_path": "/tmp",
            "timestamp_ms": 1717400000000,
            "model": "test",
            "tokens": 100,
            "cost_usd": 0.001,
            "tool": "bash",
            "status": "completed",
            "summary": null,
            "deleted": false,
            "metadata": {
                "tool_input": "rm -rf /",
                "tool_output": "forbidden"
            }
        }"#;

        let event = IngestEventEnvelope::from_json(json).unwrap();
        let result = event.validate_privacy();
        assert!(result.is_err());
        let err_msg = result.unwrap_err();
        assert!(err_msg.contains("full_payload_not_allowed"));
    }

    #[test]
    fn fixture_event_types_are_valid() {
        let valid_types = ["session.created", "session.deleted", "usage.updated", "tool.started", "tool.completed"];
        for name in FIXTURE_NAMES {
            let event = load_fixture(name);
            assert!(
                valid_types.contains(&event.event_type.as_str()),
                "{}: invalid event_type '{}'",
                name,
                event.event_type
            );
        }
    }
}
