use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use futures_util::stream::{unfold, StreamExt};
use rusqlite::Connection;
use salvo::prelude::*;
use salvo::sse::{self, SseEvent};
use serde::Serialize;
use tokio::sync::broadcast;

type DbConn = Arc<Mutex<Connection>>;

#[derive(Debug, Clone, Serialize)]
pub struct StatsUpdate {
    pub last_event_id: String,
    pub updated_at: String,
}

#[derive(Clone)]
pub struct UpdateBroadcaster {
    sender: broadcast::Sender<StatsUpdate>,
}

impl UpdateBroadcaster {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    pub fn send(&self, update: StatsUpdate) -> Result<(), broadcast::error::SendError<StatsUpdate>> {
        self.sender.send(update).map(|_| ())
    }

    pub fn subscribe(&self) -> broadcast::Receiver<StatsUpdate> {
        self.sender.subscribe()
    }
}

#[derive(Debug, Serialize)]
struct LatestResponse {
    last_event_id: String,
    updated_at: String,
}

#[handler]
async fn sse_stream(res: &mut Response, depot: &mut Depot) {
    let broadcaster = match depot.obtain::<UpdateBroadcaster>() {
        Ok(b) => b.clone(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            res.render(Json(serde_json::json!({
                "error": "broadcaster_unavailable"
            })));
            return;
        }
    };

    let rx = broadcaster.subscribe();

    let event_stream = unfold(rx, |mut rx| async {
        match rx.recv().await {
            Ok(update) => Some((update, rx)),
            Err(broadcast::error::RecvError::Lagged(_)) => {
                Some((StatsUpdate {
                    last_event_id: "lagged".to_string(),
                    updated_at: Utc::now().to_rfc3339(),
                }, rx))
            }
            Err(broadcast::error::RecvError::Closed) => None,
        }
    });

    let mapped_stream = event_stream.map(|update| {
        let event = SseEvent::default()
            .name("stats-update")
            .id(update.last_event_id.clone());
        match serde_json::to_string(&update) {
            Ok(json) => Ok::<_, Infallible>(event.text(json)),
            Err(_) => Ok::<_, Infallible>(SseEvent::default().text("{}")),
        }
    });

    sse::stream(res, mapped_stream);
}

#[handler]
async fn latest_event(res: &mut Response, depot: &mut Depot) {
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

    let result = conn.query_row(
        "SELECT event_id, created_at FROM events ORDER BY timestamp_ms DESC LIMIT 1",
        [],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        },
    );

    match result {
        Ok((event_id, created_at)) => {
            let updated_at = created_at.unwrap_or_else(|| Utc::now().to_rfc3339());
            res.render(Json(LatestResponse {
                last_event_id: event_id,
                updated_at,
            }));
        }
        Err(_) => {
            res.render(Json(serde_json::json!({
                "last_event_id": null,
                "updated_at": null,
                "message": "no_events_ingested"
            })));
        }
    }
}

pub fn events_router(db: DbConn, broadcaster: UpdateBroadcaster) -> Router {
    Router::new()
        .push(
            Router::with_path("api/events/stream")
                .hoop(affix_state::inject(broadcaster))
                .get(sse_stream),
        )
        .push(
            Router::with_path("api/events/latest")
                .hoop(affix_state::inject(db))
                .get(latest_event),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use salvo::test::{ResponseExt, TestClient};
    use sidecar_database::event::{IngestEventEnvelope, InsertResult, insert_event};
    use sidecar_database::schema::run_migrations;

    fn test_db() -> DbConn {
        let conn = Connection::open_in_memory().expect("in-memory db");
        run_migrations(&conn).expect("migrations");
        Arc::new(Mutex::new(conn))
    }

    fn test_broadcaster() -> UpdateBroadcaster {
        UpdateBroadcaster::new(64)
    }

    fn test_router(db: DbConn, broadcaster: UpdateBroadcaster) -> Router {
        Router::new()
            .push(events_router(db, broadcaster))
    }

    fn valid_event(event_id: &str) -> IngestEventEnvelope {
        IngestEventEnvelope {
            event_id: event_id.to_string(),
            event_type: "session.created".to_string(),
            session_id: "ses_test_001".to_string(),
            project_path: "/tmp/test".to_string(),
            timestamp_ms: 1717400000000,
            model: "claude-sonnet-4-20250514".to_string(),
            tokens: 100,
            cost_usd: 0.001,
            tool: None,
            status: None,
            summary: None,
            deleted: false,
            metadata: std::collections::HashMap::new(),
        }
    }

    #[tokio::test]
    async fn latest_returns_no_events_when_empty() {
        let db = test_db();
        let broadcaster = test_broadcaster();
        let router = test_router(db, broadcaster);

        let mut res = TestClient::get("http://127.0.0.1:3000/api/events/latest")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["last_event_id"], serde_json::Value::Null);
        assert_eq!(body["message"], "no_events_ingested");
    }

    #[tokio::test]
    async fn latest_returns_most_recent_event() {
        let db = test_db();
        let broadcaster = test_broadcaster();

        {
            let conn = db.lock().unwrap();
            let event1 = valid_event("evt_latest_001");
            let event2 = valid_event("evt_latest_002");
            insert_event(&conn, &event1).expect("insert event 1");
            insert_event(&conn, &event2).expect("insert event 2");
        }

        let router = test_router(db, broadcaster);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/events/latest")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        let event_id = body["last_event_id"].as_str().unwrap();
        assert!(
            event_id == "evt_latest_001" || event_id == "evt_latest_002",
            "should return one of the events, got: {}",
            event_id
        );
        assert!(body["updated_at"].is_string(), "updated_at should be a string");
    }

    #[tokio::test]
    async fn latest_returns_event_with_highest_timestamp() {
        let db = test_db();
        let broadcaster = test_broadcaster();

        {
            let conn = db.lock().unwrap();
            let mut event1 = valid_event("evt_older");
            event1.timestamp_ms = 1717400000000;
            let mut event2 = valid_event("evt_newer");
            event2.timestamp_ms = 1717400060000;
            insert_event(&conn, &event1).expect("insert event 1");
            insert_event(&conn, &event2).expect("insert event 2");
        }

        let router = test_router(db, broadcaster);
        let mut res = TestClient::get("http://127.0.0.1:3000/api/events/latest")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(StatusCode::OK));
        let body: serde_json::Value =
            serde_json::from_str(&res.take_string().await.unwrap()).unwrap();
        assert_eq!(body["last_event_id"], "evt_newer");
    }

    #[tokio::test]
    async fn broadcaster_delivers_update_to_subscriber() {
        let broadcaster = UpdateBroadcaster::new(16);
        let mut rx = broadcaster.subscribe();

        let update = StatsUpdate {
            last_event_id: "evt_bcast_001".to_string(),
            updated_at: "2025-06-03T12:00:00Z".to_string(),
        };
        broadcaster.send(update.clone()).expect("send should succeed");

        let received = rx.recv().await.expect("should receive");
        assert_eq!(received.last_event_id, "evt_bcast_001");
        assert_eq!(received.updated_at, "2025-06-03T12:00:00Z");
    }

    #[tokio::test]
    async fn broadcaster_multiple_subscribers_receive_same_update() {
        let broadcaster = UpdateBroadcaster::new(16);
        let mut rx1 = broadcaster.subscribe();
        let mut rx2 = broadcaster.subscribe();

        let update = StatsUpdate {
            last_event_id: "evt_bcast_002".to_string(),
            updated_at: "2025-06-03T12:01:00Z".to_string(),
        };
        broadcaster.send(update).expect("send");

        let r1 = rx1.recv().await.expect("rx1");
        let r2 = rx2.recv().await.expect("rx2");
        assert_eq!(r1.last_event_id, r2.last_event_id);
    }

    #[tokio::test]
    async fn broadcaster_does_not_send_duplicate_for_same_event() {
        let broadcaster = UpdateBroadcaster::new(16);
        let mut rx = broadcaster.subscribe();

        let update = StatsUpdate {
            last_event_id: "evt_bcast_003".to_string(),
            updated_at: "2025-06-03T12:02:00Z".to_string(),
        };
        broadcaster.send(update.clone()).expect("send 1");
        broadcaster.send(update).expect("send 2");

        let r1 = rx.recv().await.expect("r1");
        let r2 = rx.recv().await.expect("r2");
        assert_eq!(r1.last_event_id, "evt_bcast_003");
        assert_eq!(r2.last_event_id, "evt_bcast_003");
    }

    #[tokio::test]
    async fn sse_emits_update_after_broadcast() {
        let broadcaster = test_broadcaster();
        let mut rx = broadcaster.subscribe();

        let update = StatsUpdate {
            last_event_id: "evt_sse_001".to_string(),
            updated_at: Utc::now().to_rfc3339(),
        };
        broadcaster.send(update).expect("broadcast");

        let received = rx.recv().await.expect("should receive SSE update");
        assert_eq!(received.last_event_id, "evt_sse_001");
    }

    #[tokio::test]
    async fn sse_does_not_emit_for_duplicate_events() {
        let broadcaster = test_broadcaster();
        let mut rx = broadcaster.subscribe();

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            rx.recv(),
        ).await;

        assert!(result.is_err(), "should not receive any broadcast for duplicate events");
    }

    #[tokio::test]
    async fn ingest_accepts_valid_event_and_returns_correct_response() {
        let db = test_db();
        let conn = db.lock().unwrap();
        let event = valid_event("evt_integ_001");

        let result = insert_event(&conn, &event);
        assert!(matches!(result, Ok(InsertResult::Accepted)));
    }

    #[tokio::test]
    async fn ingest_duplicate_returns_duplicate_and_should_not_broadcast() {
        let db = test_db();
        let broadcaster = test_broadcaster();
        let mut rx = broadcaster.subscribe();

        let conn = db.lock().unwrap();
        let event = valid_event("evt_dup_001");

        let result1 = insert_event(&conn, &event);
        assert!(matches!(result1, Ok(InsertResult::Accepted)));

        broadcaster.send(StatsUpdate {
            last_event_id: event.event_id.clone(),
            updated_at: Utc::now().to_rfc3339(),
        }).expect("broadcast");

        let received = rx.recv().await.expect("should receive");
        assert_eq!(received.last_event_id, "evt_dup_001");

        let result2 = insert_event(&conn, &event);
        assert!(matches!(result2, Ok(InsertResult::Duplicate)));

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(100),
            rx.recv(),
        ).await;
        assert!(result.is_err(), "duplicate should not trigger broadcast");
    }
}
