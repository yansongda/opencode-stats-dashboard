use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use salvo::prelude::*;
use serde::Serialize;

type DbConn = Arc<Mutex<Connection>>;

// ── Response types ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct ExportSessionRow {
    session_id: String,
    project_path: Option<String>,
    model: Option<String>,
    total_tokens: i64,
    total_cost_usd: f64,
    deleted: bool,
}

#[derive(Debug, Serialize)]
struct ExportToolCallRow {
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

/// `GET /api/export/sessions.csv` — export sessions as CSV.
///
/// Returns all sessions (including deleted) with privacy-safe columns only.
#[handler]
async fn export_sessions_csv(res: &mut Response, depot: &mut Depot) {
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

    let mut stmt = match conn.prepare(
        "SELECT session_id, project_path, model, total_tokens, total_cost_usd, deleted \
         FROM sessions ORDER BY session_id",
    ) {
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

    let rows: Vec<ExportSessionRow> = stmt
        .query_map([], |row| {
            Ok(ExportSessionRow {
                session_id: row.get(0)?,
                project_path: row.get(1)?,
                model: row.get(2)?,
                total_tokens: row.get(3)?,
                total_cost_usd: row.get(4)?,
                deleted: row.get(5)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    let mut wtr = csv::Writer::from_writer(vec![]);
    // Always write header, even when rows are empty
    if let Err(e) = wtr.write_record(["session_id", "project_path", "model", "total_tokens", "total_cost_usd", "deleted"]) {
        res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        res.render(Json(serde_json::json!({
            "error": "csv_serialization_failed",
            "detail": e.to_string()
        })));
        return;
    }
    for row in &rows {
        if let Err(e) = wtr.serialize(row) {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "csv_serialization_failed",
                "detail": e.to_string()
            })));
            return;
        }
    }

    match wtr.into_inner() {
        Ok(data) => {
            res.headers_mut()
                .insert("content-type", "text/csv; charset=utf-8".parse().unwrap());
            res.body(data);
        }
        Err(e) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "csv_flush_failed",
                "detail": e.to_string()
            })));
        }
    }
}

/// `GET /api/export/tool-calls.json` — export tool calls as JSON.
///
/// Returns tool call rows without `tool_input`, `tool_output`, or `message_body`.
#[handler]
async fn export_tool_calls_json(res: &mut Response, depot: &mut Depot) {
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

    let mut stmt = match conn.prepare(
        "SELECT tool_name, session_id, status, model, tokens, cost_usd, \
         started_at, completed_at, summary \
         FROM tool_calls ORDER BY session_id, started_at",
    ) {
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

    let rows: Vec<ExportToolCallRow> = stmt
        .query_map([], |row| {
            Ok(ExportToolCallRow {
                tool_name: row.get(0)?,
                session_id: row.get(1)?,
                status: row.get(2)?,
                model: row.get(3)?,
                tokens: row.get(4)?,
                cost_usd: row.get(5)?,
                started_at: row.get(6)?,
                completed_at: row.get(7)?,
                summary: row.get(8)?,
            })
        })
        .unwrap()
        .filter_map(|r| r.ok())
        .collect();

    res.headers_mut()
        .insert("content-type", "application/json; charset=utf-8".parse().unwrap());
    res.render(Json(serde_json::json!({
        "tool_calls": rows,
        "count": rows.len(),
    })));
}

// ── Router ─────────────────────────────────────────────────────────────

pub fn export_router(db: DbConn) -> Router {
    Router::new()
        .push(
            Router::with_path("api/export/sessions.csv")
                .hoop(affix_state::inject(db.clone()))
                .get(export_sessions_csv),
        )
        .push(
            Router::with_path("api/export/tool-calls.json")
                .hoop(affix_state::inject(db))
                .get(export_tool_calls_json),
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
        Router::new().push(export_router(db))
    }

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

    // ── /api/export/sessions.csv ──────────────────────────────────────

    #[tokio::test]
    async fn sessions_csv_returns_csv_content_type() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_csv_01", "/tmp/a", "model-a", 100, 0.001, false);
        }

        let router = test_router(db);
        let res = TestClient::get("http://127.0.0.1:3000/api/export/sessions.csv")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let ct = res.headers.get("content-type").unwrap().to_str().unwrap();
        assert!(ct.contains("text/csv"), "content-type should be text/csv, got {}", ct);
    }

    #[tokio::test]
    async fn sessions_csv_contains_correct_header_columns() {
        let router = test_router(test_db());
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/sessions.csv")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body = res.take_string().await.unwrap();
        let first_line = body.lines().next().expect("CSV should have at least a header");
        assert!(first_line.contains("session_id"), "header must contain session_id");
        assert!(first_line.contains("project_path"), "header must contain project_path");
        assert!(first_line.contains("model"), "header must contain model");
        assert!(first_line.contains("total_tokens"), "header must contain total_tokens");
        assert!(first_line.contains("total_cost_usd"), "header must contain total_cost_usd");
        assert!(first_line.contains("deleted"), "header must contain deleted");
    }

    #[tokio::test]
    async fn sessions_csv_includes_all_sessions_even_deleted() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_session(&conn, "ses_all_01", "/tmp/a", "m1", 100, 0.001, false);
            seed_session(&conn, "ses_all_02", "/tmp/b", "m2", 200, 0.002, true);
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/sessions.csv")
            .send(router)
            .await;

        let body = res.take_string().await.unwrap();
        assert!(body.contains("ses_all_01"), "should include active session");
        assert!(body.contains("ses_all_02"), "should include deleted session");
    }

    #[tokio::test]
    async fn sessions_csv_empty_db_returns_header_only() {
        let router = test_router(test_db());
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/sessions.csv")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body = res.take_string().await.unwrap();
        let lines: Vec<&str> = body.lines().collect();
        assert_eq!(lines.len(), 1, "empty DB should return header only");
    }

    // ── /api/export/tool-calls.json ───────────────────────────────────

    #[tokio::test]
    async fn tool_calls_json_returns_json_content_type() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_tc01", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
        }

        let router = test_router(db);
        let res = TestClient::get("http://127.0.0.1:3000/api/export/tool-calls.json")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let ct = res.headers.get("content-type").unwrap().to_str().unwrap();
        assert!(ct.contains("application/json"), "content-type should be application/json, got {}", ct);
    }

    #[tokio::test]
    async fn tool_calls_json_returns_correct_fields() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_tc02", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/tool-calls.json")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 1);

        let tc = &body["tool_calls"][0];
        assert_eq!(tc["tool_name"], "bash");
        assert_eq!(tc["session_id"], "ses_tc02");
        assert_eq!(tc["status"], "completed");
        assert!(tc.get("started_at").is_some());
        assert!(tc.get("completed_at").is_some());
    }

    #[tokio::test]
    async fn tool_calls_json_does_not_expose_forbidden_fields() {
        let db = test_db();
        {
            let conn = db.lock().unwrap();
            seed_tool_call(&conn, "bash", "ses_priv01", "completed", "2025-06-01 00:00:00", Some("2025-06-01 00:01:00"));
        }

        let router = test_router(db);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/tool-calls.json")
            .send(router)
            .await;

        let body_str = res.take_string().await.unwrap();
        assert!(!body_str.contains("tool_input"), "must not expose tool_input");
        assert!(!body_str.contains("tool_output"), "must not expose tool_output");
        assert!(!body_str.contains("message_body"), "must not expose message_body");
    }

    #[tokio::test]
    async fn tool_calls_json_empty_returns_zero_count() {
        let router = test_router(test_db());
        let mut res = TestClient::get("http://127.0.0.1:3000/api/export/tool-calls.json")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["count"], 0);
        assert_eq!(body["tool_calls"].as_array().unwrap().len(), 0);
    }
}
