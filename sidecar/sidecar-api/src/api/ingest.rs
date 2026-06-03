use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::Connection;
use salvo::prelude::*;
use sidecar_database::event::{IngestEventEnvelope, InsertResult, insert_event};

use super::events::{StatsUpdate, UpdateBroadcaster};

type DbConn = Arc<Mutex<Connection>>;

#[handler]
async fn ingest_event(
    req: &mut Request,
    res: &mut Response,
    depot: &mut Depot,
) {
    let db = match depot.obtain::<DbConn>() {
        Ok(db) => db.clone(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "accepted": false,
                "error": "database_unavailable"
            })));
            return;
        }
    };

    let broadcaster = depot.obtain::<UpdateBroadcaster>().ok().cloned();

    let body = match req.payload().await {
        Ok(b) => b,
        Err(e) => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(serde_json::json!({
                "accepted": false,
                "error": "invalid_payload",
                "detail": e.to_string()
            })));
            return;
        }
    };

    let text = match std::str::from_utf8(body) {
        Ok(t) => t,
        Err(_) => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(serde_json::json!({
                "accepted": false,
                "error": "invalid_encoding"
            })));
            return;
        }
    };

    let event: IngestEventEnvelope = match serde_json::from_str(text) {
        Ok(e) => e,
        Err(e) => {
            res.status_code(StatusCode::BAD_REQUEST);
            res.render(Json(serde_json::json!({
                "accepted": false,
                "error": "invalid_json",
                "detail": e.to_string()
            })));
            return;
        }
    };

    if let Err(detail) = event.validate_privacy() {
        res.status_code(StatusCode::BAD_REQUEST);
        res.render(Json(serde_json::json!({
            "accepted": false,
            "error": "full_payload_not_allowed",
            "detail": detail
        })));
        return;
    }

    let conn = db.lock().unwrap();
    match insert_event(&conn, &event) {
        Ok(InsertResult::Accepted) => {
            // Broadcast update for new (non-duplicate) events
            if let Some(bcast) = broadcaster {
                let _ = bcast.send(StatsUpdate {
                    last_event_id: event.event_id.clone(),
                    updated_at: Utc::now().to_rfc3339(),
                });
            }
            res.render(Json(serde_json::json!({
                "accepted": true,
                "duplicate": false
            })));
        }
        Ok(InsertResult::Duplicate) => {
            // Do NOT broadcast for duplicates
            res.render(Json(serde_json::json!({
                "accepted": true,
                "duplicate": true
            })));
        }
        Err(e) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "accepted": false,
                "error": "database_error",
                "detail": e.to_string()
            })));
        }
    }
}

pub fn ingest_router(db: DbConn, broadcaster: UpdateBroadcaster) -> Router {
    Router::with_path("ingest/event")
        .hoop(affix_state::inject(db))
        .hoop(affix_state::inject(broadcaster))
        .post(ingest_event)
}

#[cfg(test)]
mod tests {
    use super::*;
    use salvo::test::{TestClient, ResponseExt};
    use sidecar_database::schema::run_migrations;

    fn test_db() -> DbConn {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        Arc::new(Mutex::new(conn))
    }

    fn test_broadcaster() -> UpdateBroadcaster {
        UpdateBroadcaster::new(64)
    }

    fn test_router(db: DbConn) -> Router {
        Router::new().push(ingest_router(db, test_broadcaster()))
    }

    fn valid_event_json() -> serde_json::Value {
        serde_json::json!({
            "event_id": "evt_test_001",
            "event_type": "session.created",
            "session_id": "ses_test_001",
            "project_path": "/tmp/test",
            "timestamp_ms": 1717400000000u64,
            "model": "claude-sonnet-4-20250514",
            "tokens": 0u64,
            "cost_usd": 0.0,
            "tool": null,
            "status": null,
            "summary": null,
            "deleted": false,
            "metadata": {}
        })
    }

    #[tokio::test]
    async fn accepts_valid_event() {
        let router = test_router(test_db());

        let mut res = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .json(&valid_event_json())
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value = serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["accepted"], true);
        assert_eq!(body["duplicate"], false);
    }

    #[tokio::test]
    async fn duplicate_event_returns_duplicate_true() {
        let db = test_db();
        let event = valid_event_json();

        let res1 = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .json(&event)
            .send(test_router(db.clone()))
            .await;
        assert_eq!(res1.status_code, Some(StatusCode::OK));

        let mut res2 = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .json(&event)
            .send(test_router(db))
            .await;

        assert_eq!(res2.status_code, Some(StatusCode::OK));
        let body: serde_json::Value = serde_json::from_str(&res2.take_string().await.unwrap()).unwrap();
        assert_eq!(body["accepted"], true);
        assert_eq!(body["duplicate"], true);
    }

    #[tokio::test]
    async fn invalid_json_returns_400() {
        let router = test_router(test_db());

        let mut res = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .bytes(b"not valid json{{{".to_vec())
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));
        let body: serde_json::Value = serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["accepted"], false);
        assert_eq!(body["error"], "invalid_json");
    }

    #[tokio::test]
    async fn missing_required_field_returns_400() {
        let router = test_router(test_db());

        let mut res = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .json(&serde_json::json!({
                "event_id": "evt_incomplete",
                "event_type": "session.created"
            }))
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));
        let body: serde_json::Value = serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["accepted"], false);
    }

    #[tokio::test]
    async fn forbidden_metadata_returns_400() {
        let router = test_router(test_db());

        let mut event = valid_event_json();
        event["event_id"] = serde_json::json!("evt_privacy_violation");
        event["metadata"] = serde_json::json!({
            "tool_input": "rm -rf /",
            "tool_output": "forbidden"
        });

        let mut res = TestClient::post("http://127.0.0.1:3000/ingest/event")
            .json(&event)
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::BAD_REQUEST));
        let body: serde_json::Value = serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["accepted"], false);
        assert_eq!(body["error"], "full_payload_not_allowed");
    }
}
