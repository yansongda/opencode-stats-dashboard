//! SQLite schema definitions and migration runner for the sidecar database.
//!
//! All tables are created idempotently. The `schema_migrations` table tracks
//! which migration versions have been applied so that repeated calls to
//! [`run_migrations`] are safe.

use rusqlite::{Connection, Transaction};

/// Current schema version — bump when adding new migrations.
pub const CURRENT_VERSION: i64 = 1;

/// Migration definitions: (version, SQL statements).
///
/// Each migration is a list of SQL statements that are executed within a
/// single transaction. Statements are applied in order.
const MIGRATIONS: &[(i64, &[&str])] = &[
    (
        1,
        &[
            // ── events: raw ingest log ──────────────────────────────────
            r#"
            CREATE TABLE IF NOT EXISTS events (
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
            )
            "#,
            "CREATE INDEX IF NOT EXISTS idx_events_session   ON events(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_events_type      ON events(event_type)",
            "CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp_ms)",
            // ── sessions: aggregated session record ──────────────────────
            r#"
            CREATE TABLE IF NOT EXISTS sessions (
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
            )
            "#,
            "CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path)",
            "CREATE INDEX IF NOT EXISTS idx_sessions_deleted ON sessions(deleted)",
            // ── tool_calls: per-tool audit trail ─────────────────────────
            r#"
            CREATE TABLE IF NOT EXISTS tool_calls (
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
            )
            "#,
            "CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_tool_calls_tool    ON tool_calls(tool_name)",
            // ── daily_usage: pre-aggregated daily stats ──────────────────
            r#"
            CREATE TABLE IF NOT EXISTS daily_usage (
                date            TEXT PRIMARY KEY,
                session_count   INTEGER DEFAULT 0,
                deleted_count   INTEGER DEFAULT 0,
                total_tokens    INTEGER DEFAULT 0,
                total_cost_usd  REAL DEFAULT 0,
                tool_call_count INTEGER DEFAULT 0
            )
            "#,
            // ── schema_migrations: version tracking ──────────────────────
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version     INTEGER PRIMARY KEY,
                applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            "#,
        ],
    ),
];

/// Run all pending migrations inside a single transaction.
///
/// This function is idempotent — calling it multiple times with the same
/// database is safe and will only apply new migrations.
pub fn run_migrations(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    let applied = run_migrations_tx(&tx)?;
    tx.commit()?;
    Ok(applied)
}

/// Run migrations within an existing transaction (useful for tests).
fn run_migrations_tx(tx: &Transaction) -> Result<i64, rusqlite::Error> {
    // Ensure the migrations table exists first.
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     INTEGER PRIMARY KEY,
            applied_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        "#,
    )?;

    let current = current_version_tx(tx)?;
    let mut applied_count: i64 = 0;

    for &(version, ref statements) in MIGRATIONS {
        if version <= current {
            continue;
        }
        for sql in *statements {
            tx.execute_batch(sql)?;
        }
        tx.execute(
            "INSERT INTO schema_migrations (version) VALUES (?1)",
            [version],
        )?;
        applied_count += 1;
    }

    Ok(applied_count)
}

/// Return the highest applied migration version, or 0 if none.
pub fn current_version(conn: &Connection) -> Result<i64, rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;
    let v = current_version_tx(&tx)?;
    tx.commit()?;
    Ok(v)
}

fn current_version_tx(tx: &Transaction) -> Result<i64, rusqlite::Error> {
    // Table may not exist yet on first run — treat as version 0.
    let exists: bool = tx.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    if !exists {
        return Ok(0);
    }

    let v: i64 = tx
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    Ok(v)
}

/// List all table names in the database (for testing / validation).
pub fn list_tables(conn: &Connection) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    let tables = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(tables)
}

/// List all column names for a given table (for testing / validation).
pub fn list_columns(conn: &Connection, table: &str) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let columns = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(columns)
}

/// List all index names for a given table (for testing / validation).
pub fn list_indexes(conn: &Connection, table: &str) -> Result<Vec<String>, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA index_list({})", table))?;
    let indexes = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(indexes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: open an in-memory database and run all migrations.
    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");
        run_migrations(&conn).expect("migrations should succeed");
        conn
    }

    #[test]
    fn migrations_create_expected_tables() {
        let conn = setup_db();
        let tables = list_tables(&conn).expect("should list tables");

        for expected in &["events", "sessions", "tool_calls", "daily_usage", "schema_migrations"] {
            assert!(
                tables.contains(&expected.to_string()),
                "missing table: {}; found: {:?}",
                expected,
                tables
            );
        }
    }

    #[test]
    fn schema_excludes_full_payload_columns() {
        let conn = setup_db();

        for table in &["events", "sessions", "tool_calls"] {
            let columns = list_columns(&conn, table).expect("should list columns");
            for forbidden in &["message_body", "tool_input", "tool_output"] {
                assert!(
                    !columns.contains(&forbidden.to_string()),
                    "table '{}' should not contain forbidden column '{}'",
                    table,
                    forbidden
                );
            }
        }
    }

    #[test]
    fn events_table_has_primary_key_event_id() {
        let conn = setup_db();
        let mut stmt = conn
            .prepare("PRAGMA table_info(events)")
            .expect("should prepare pragma");
        let rows: Vec<(String, String, bool)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(1)?, // name
                    row.get::<_, String>(2)?, // type
                    row.get::<_, bool>(5)?,   // pk
                ))
            })
            .expect("should query")
            .filter_map(|r| r.ok())
            .collect();

        let pk = rows.iter().find(|(_, _, pk)| *pk);
        assert!(pk.is_some(), "events table should have a primary key");
        let (name, col_type, _) = pk.unwrap();
        assert_eq!(name, "event_id", "primary key should be event_id");
        assert_eq!(col_type, "TEXT", "event_id should be TEXT type");
    }

    #[test]
    fn events_table_has_expected_indexes() {
        let conn = setup_db();
        let indexes = list_indexes(&conn, "events").expect("should list indexes");

        for expected in &["idx_events_session", "idx_events_type", "idx_events_timestamp"] {
            assert!(
                indexes.contains(&expected.to_string()),
                "missing index: {}; found: {:?}",
                expected,
                indexes
            );
        }
    }

    #[test]
    fn sessions_table_has_expected_indexes() {
        let conn = setup_db();
        let indexes = list_indexes(&conn, "sessions").expect("should list indexes");

        for expected in &["idx_sessions_project", "idx_sessions_deleted"] {
            assert!(
                indexes.contains(&expected.to_string()),
                "missing index: {}; found: {:?}",
                expected,
                indexes
            );
        }
    }

    #[test]
    fn tool_calls_table_has_expected_indexes() {
        let conn = setup_db();
        let indexes = list_indexes(&conn, "tool_calls").expect("should list indexes");

        for expected in &["idx_tool_calls_session", "idx_tool_calls_tool"] {
            assert!(
                indexes.contains(&expected.to_string()),
                "missing index: {}; found: {:?}",
                expected,
                indexes
            );
        }
    }

    #[test]
    fn tool_calls_unique_constraint_on_session_tool_started() {
        let conn = setup_db();

        // Insert first tool call
        let result = conn.execute(
            r#"
            INSERT INTO tool_calls (tool_name, session_id, status, started_at)
            VALUES ('bash', 'ses_001', 'started', '2025-01-01 00:00:00')
            "#,
            [],
        );
        assert!(result.is_ok(), "first insert should succeed");

        // Insert duplicate (same session_id, tool_name, started_at) should fail
        let result = conn.execute(
            r#"
            INSERT INTO tool_calls (tool_name, session_id, status, started_at)
            VALUES ('bash', 'ses_001', 'completed', '2025-01-01 00:00:00')
            "#,
            [],
        );
        assert!(
            result.is_err(),
            "duplicate (session_id, tool_name, started_at) should violate UNIQUE constraint"
        );
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");

        // Run migrations twice
        let applied1 = run_migrations(&conn).expect("first migration run");
        let applied2 = run_migrations(&conn).expect("second migration run");

        assert_eq!(applied1, 1, "first run should apply 1 migration");
        assert_eq!(applied2, 0, "second run should apply 0 new migrations");

        // Tables should still be intact
        let tables = list_tables(&conn).expect("should list tables");
        assert!(tables.contains(&"events".to_string()));
        assert!(tables.contains(&"sessions".to_string()));
    }

    #[test]
    fn current_version_returns_applied_version() {
        let conn = Connection::open_in_memory().expect("failed to open in-memory db");

        assert_eq!(
            current_version(&conn).unwrap(),
            0,
            "fresh db should have version 0"
        );

        run_migrations(&conn).expect("migrations should succeed");

        assert_eq!(
            current_version(&conn).unwrap(),
            CURRENT_VERSION,
            "after migration, version should be CURRENT_VERSION"
        );
    }

    #[test]
    fn schema_migrations_table_tracks_version() {
        let conn = setup_db();

        let version: i64 = conn
            .query_row(
                "SELECT MAX(version) FROM schema_migrations",
                [],
                |row| row.get(0),
            )
            .expect("should query schema_migrations");

        assert_eq!(version, CURRENT_VERSION);
    }

    #[test]
    fn daily_usage_date_is_primary_key() {
        let conn = setup_db();

        // Insert a row
        conn.execute(
            "INSERT INTO daily_usage (date, session_count) VALUES ('2025-01-01', 5)",
            [],
        )
        .expect("should insert");

        // Duplicate date should fail
        let result = conn.execute(
            "INSERT INTO daily_usage (date, session_count) VALUES ('2025-01-01', 10)",
            [],
        );
        assert!(result.is_err(), "duplicate date should violate PRIMARY KEY");
    }

    #[test]
    fn sessions_session_id_is_primary_key() {
        let conn = setup_db();

        conn.execute(
            "INSERT INTO sessions (session_id, project_path) VALUES ('ses_001', '/tmp')",
            [],
        )
        .expect("should insert");

        let result = conn.execute(
            "INSERT INTO sessions (session_id, project_path) VALUES ('ses_001', '/other')",
            [],
        );
        assert!(
            result.is_err(),
            "duplicate session_id should violate PRIMARY KEY"
        );
    }
}
