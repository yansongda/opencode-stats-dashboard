use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use salvo::prelude::*;
use serde::Serialize;

type DbConn = Arc<Mutex<Connection>>;

// ── Response types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct OverviewResponse {
    total_sessions: i64,
    deleted_sessions: i64,
    total_tokens: i64,
    total_cost_usd: f64,
}

#[derive(Debug, Serialize)]
struct SessionRow {
    session_id: String,
    project_path: Option<String>,
    model: Option<String>,
    total_tokens: i64,
    total_cost_usd: f64,
    deleted: bool,
    deleted_at: Option<String>,
    first_event_at: Option<String>,
    last_event_at: Option<String>,
    tool_call_count: i64,
}

#[derive(Debug, Serialize)]
struct ToolCallRow {
    id: i64,
    tool_name: String,
    session_id: String,
    status: String,
    model: Option<String>,
    tokens: Option<i64>,
    cost_usd: Option<f64>,
    started_at: Option<String>,
    completed_at: Option<String>,
    summary: Option<String>,
}

// ── Handlers ───────────────────────────────────────────────────────────

/// `GET /api/overview` — aggregate statistics across all sessions.
#[handler]
async fn overview(
    res: &mut Response,
    depot: &mut Depot,
) {
    let db = match depot.obtain::<DbConn>() {
        Ok(db) => db.clone(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "database_unavailable"
            })));
            return;
        }
    };

    let conn = db.lock().unwrap();

    let total_sessions: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
        .unwrap_or(0);

    let deleted_sessions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sessions WHERE deleted = TRUE",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_tokens: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_tokens), 0) FROM sessions",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let total_cost_usd: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_cost_usd), 0.0) FROM sessions",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0.0);

    res.render(Json(OverviewResponse {
        total_sessions,
        deleted_sessions,
        total_tokens,
        total_cost_usd,
    }));
}

/// `GET /api/sessions?include_deleted=true/false` — list sessions.
///
/// By default, deleted sessions are excluded. Pass `include_deleted=true`
/// to include all sessions.
#[handler]
async fn list_sessions(
    req: &mut Request,
    res: &mut Response,
    depot: &mut Depot,
) {
    let db = match depot.obtain::<DbConn>() {
        Ok(db) => db.clone(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "database_unavailable"
            })));
            return;
        }
    };

    let include_deleted: bool = req
        .query::<bool>("include_deleted")
        .unwrap_or(false);

    let conn = db.lock().unwrap();

    let sql = if include_deleted {
        "SELECT session_id, project_path, model, total_tokens, total_cost_usd, \
         deleted, deleted_at, first_event_at, last_event_at, tool_call_count \
         FROM sessions ORDER BY last_event_at DESC"
    } else {
        "SELECT session_id, project_path, model, total_tokens, total_cost_usd, \
         deleted, deleted_at, first_event_at, last_event_at, tool_call_count \
         FROM sessions WHERE deleted = FALSE ORDER BY last_event_at DESC"
    };

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "query_failed",
                "detail": e.to_string()
            })));
            return;
        }
    };

    let rows: Vec<SessionRow> = stmt
        .query_map([], |row| {
            Ok(SessionRow {
                session_id: row.get(0)?,
                project_path: row.get(1)?,
                model: row.get(2)?,
                total_tokens: row.get(3)?,
                total_cost_usd: row.get(4)?,
                deleted: row.get(5)?,
                deleted_at: row.get(6)?,
                first_event_at: row.get(7)?,
                last_event_at: row.get(8)?,
                tool_call_count: row.get(9)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    res.render(Json(serde_json::json!({
        "sessions": rows,
        "count": rows.len(),
    })));
}

/// `GET /api/tool-calls?session_id=xxx` — list tool calls, optionally filtered.
#[handler]
async fn list_tool_calls(
    req: &mut Request,
    res: &mut Response,
    depot: &mut Depot,
) {
    let db = match depot.obtain::<DbConn>() {
        Ok(db) => db.clone(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "database_unavailable"
            })));
            return;
        }
    };

    let session_filter: Option<String> = req.query("session_id");

    let conn = db.lock().unwrap();

    let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match &session_filter {
        Some(sid) => (
            "SELECT id, tool_name, session_id, status, model, tokens, cost_usd, \
             started_at, completed_at, summary \
             FROM tool_calls WHERE session_id = ?1 ORDER BY started_at",
            vec![Box::new(sid.clone())],
        ),
        None => (
            "SELECT id, tool_name, session_id, status, model, tokens, cost_usd, \
             started_at, completed_at, summary \
             FROM tool_calls ORDER BY session_id, started_at",
            vec![],
        ),
    };

    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(e) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "query_failed",
                "detail": e.to_string()
            })));
            return;
        }
    };

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows: Vec<ToolCallRow> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(ToolCallRow {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                session_id: row.get(2)?,
                status: row.get(3)?,
                model: row.get(4)?,
                tokens: row.get(5)?,
                cost_usd: row.get(6)?,
                started_at: row.get(7)?,
                completed_at: row.get(8)?,
                summary: row.get(9)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    res.render(Json(serde_json::json!({
        "tool_calls": rows,
        "count": rows.len(),
    })));
}

// ── Router ─────────────────────────────────────────────────────────────

pub fn query_router(db: DbConn) -> Router {
    Router::new()
        .push(
            Router::with_path("api/overview")
                .hoop(affix_state::inject(db.clone()))
                .get(overview),
        )
        .push(
            Router::with_path("api/sessions")
                .hoop(affix_state::inject(db.clone()))
                .get(list_sessions),
        )
        .push(
            Router::with_path("api/tool-calls")
                .hoop(affix_state::inject(db))
                .get(list_tool_calls),
        )
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use salvo::test::{ResponseExt, TestClient};
    use sidecar_database::schema::run_migrations;

    fn test_db() -> DbConn {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        Arc::new(Mutex::new(conn))
    }

    fn test_router(db: DbConn) -> Router {
        Router::new().push(query_router(db))
    }

    /// Seed a session with the given properties.
    fn seed_session(
        conn: &Connection,
        session_id: &str,
        project_path: &str,
        model: &str,
        total_tokens: i64,
        total_cost_usd: f64,
        deleted: bool,
    ) {
        let deleted_at = if deleted {
            Some("2025-06-01 12:00:00")
        } else {
            None
        };
        conn.execute(
            r#"
            INSERT OR REPLACE INTO sessions (
                session_id, project_path, model,
                total_tokens, total_cost_usd,
                deleted, deleted_at,
                first_event_at, last_event_at,
                tool_call_count
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            rusqlite::params![
                session_id,
                project_path,
                model,
                total_tokens,
                total_cost_usd,
                deleted,
                deleted_at,
                "2025-06-01 00:00:00",
                "2025-06-01 12:00:00",
                0i64,
            ],
        )
        .expect("seed session");
    }

    /// Seed a tool call row.
    fn seed_tool_call(
        conn: &Connection,
        tool_name: &str,
        session_id: &str,
        status: &str,
        started_at: &str,
        completed_at: Option<&str>,
    ) {
        conn.execute(
            r#"
            INSERT INTO tool_calls (tool_name, session_id, status, started_at, completed_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
            rusqlite::params![tool_name, session_id, status, started_at, completed_at],
        )
        .expect("seed tool call");
    }

    // ── /api/overview ────────────────────────────────────────────────

    #[tokio::test]
    async fn overview_empty_db_returns_zeros() {
        let router = test_router(test_db());

        let mut res = TestClient::get("http://127.0.0.1:3000/api/overview")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["total_sessions"], 0);
        assert_eq!(body["deleted_sessions"], 0);
        assert_eq!(body["total_tokens"], 0);
        assert_eq!(body["total_cost_usd"], 0.0);
    }

    #[tokio::test]
    async fn overview_counts_active_and_deleted_sessions() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_001", "/tmp/a", "model-a", 1000, 0.005, false);
            seed_session(&conn, "ses_002", "/tmp/b", "model-b", 2500, 0.0125, true);
            seed_session(&conn, "ses_003", "/tmp/c", "model-c", 500, 0.002, false);
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/overview")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["total_sessions"], 3, "should count all sessions");
        assert_eq!(body["deleted_sessions"], 1, "should count deleted sessions");
        assert_eq!(body["total_tokens"], 4000, "should sum all tokens (1000+2500+500)");
        let cost = body["total_cost_usd"].as_f64().unwrap();
        assert!(
            (cost - 0.0195).abs() < f64::EPSILON,
            "should sum all costs (0.005+0.0125+0.002), got {}",
            cost
        );
    }

    #[tokio::test]
    async fn overview_includes_deleted_in_total() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_del_001", "/tmp/d", "model-d", 3000, 0.015, true);
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/overview")
            .send(router)
            .await;

        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["total_sessions"], 1, "deleted session counts toward total");
        assert_eq!(body["deleted_sessions"], 1);
        assert_eq!(body["total_tokens"], 3000);
    }

    // ── /api/sessions ────────────────────────────────────────────────

    #[tokio::test]
    async fn sessions_excludes_deleted_by_default() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_a001", "/tmp/a", "m1", 100, 0.001, false);
            seed_session(&conn, "ses_a002", "/tmp/b", "m2", 200, 0.002, true);
            seed_session(&conn, "ses_a003", "/tmp/c", "m3", 300, 0.003, false);
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/sessions")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 2, "should exclude deleted sessions");

        let sessions = body["sessions"].as_array().unwrap();
        for s in sessions {
            assert_eq!(s["deleted"], false, "all returned sessions should be non-deleted");
        }
    }

    #[tokio::test]
    async fn sessions_include_deleted_when_flag_set() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_b001", "/tmp/a", "m1", 100, 0.001, false);
            seed_session(&conn, "ses_b002", "/tmp/b", "m2", 200, 0.002, true);
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/sessions?include_deleted=true")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 2, "should include deleted sessions");

        let sessions = body["sessions"].as_array().unwrap();
        let has_deleted = sessions.iter().any(|s| s["deleted"] == true);
        assert!(has_deleted, "should contain the deleted session");
    }

    #[tokio::test]
    async fn sessions_empty_db_returns_empty_list() {
        let router = test_router(test_db());
        let mut res = TestClient::get("http://127.0.0.1:3000/api/sessions")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 0);
        assert_eq!(body["sessions"].as_array().unwrap().len(), 0);
    }

    // ── /api/tool-calls ──────────────────────────────────────────────

    #[tokio::test]
    async fn tool_calls_returns_all_when_no_filter() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_t001", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
            seed_tool_call(&conn, "read", "ses_t001", "started", "2025-06-01 00:02:00", None);
            seed_tool_call(&conn, "bash", "ses_t002", "completed", "2025-06-01 01:00:00", Some("2025-06-01 01:01:00"));
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/tool-calls")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 3, "should return all tool calls");
    }

    #[tokio::test]
    async fn tool_calls_filtered_by_session_id() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_f001", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
            seed_tool_call(&conn, "read", "ses_f001", "started", "2025-06-01 00:02:00", None);
            seed_tool_call(&conn, "bash", "ses_f002", "completed", "2025-06-01 01:00:00", Some("2025-06-01 01:01:00"));
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/tool-calls?session_id=ses_f001")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 2, "should return only ses_f001 tool calls");

        let calls = body["tool_calls"].as_array().unwrap();
        for tc in calls {
            assert_eq!(tc["session_id"], "ses_f001");
        }
    }

    #[tokio::test]
    async fn tool_calls_empty_filter_returns_empty() {
        let router = test_router(test_db());
        let mut res = TestClient::get("http://127.0.0.1:3000/api/tool-calls?session_id=nonexistent")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 0);
    }

    #[tokio::test]
    async fn tool_calls_does_not_expose_full_input_output() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_priv01", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/tool-calls?session_id=ses_priv01")
            .send(router)
            .await;

        let body_str = res.take_string().await.unwrap();
        assert!(!body_str.contains("tool_input"), "must not expose tool_input");
        assert!(!body_str.contains("tool_output"), "must not expose tool_output");
    }
}
