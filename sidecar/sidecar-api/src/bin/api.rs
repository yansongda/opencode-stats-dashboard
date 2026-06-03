use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use salvo::prelude::*;
use sidecar_api::api::{UpdateBroadcaster, events_router, export_router, ingest_router, query_router};
use sidecar_database::schema::run_migrations;

#[derive(Clone, Debug)]
struct StaticRoot(PathBuf);

#[handler]
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": "dev"
    }))
}

#[handler]
async fn serve_static(req: &mut Request, res: &mut Response, depot: &mut Depot) {
    let root = depot.obtain::<StaticRoot>().unwrap().0.clone();
    let path = req.uri().path().trim_start_matches('/');
    let file_path = root.join(path);

    let serve = if file_path.is_file() {
        std::fs::read_to_string(&file_path)
    } else {
        std::fs::read_to_string(root.join("index.html"))
    };

    match serve {
        Ok(content) => { res.render(Text::Html(content)); }
        Err(_) => { res.status_code(StatusCode::NOT_FOUND); }
    }
}

fn detect_static_root() -> PathBuf {
    // 1. 环境变量优先
    if let Ok(dir) = std::env::var("SIDECAR_STATIC_DIR") {
        return PathBuf::from(dir);
    }
    // 2. 可执行文件同级目录下的 static/
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let candidate = exe_dir.join("static");
            if candidate.is_dir() {
                return candidate;
            }
        }
    }
    // 3. 回退到 CWD/static
    PathBuf::from("static")
}

pub fn app_router(db: Arc<Mutex<Connection>>, broadcaster: UpdateBroadcaster) -> Router {
    Router::new()
        .push(Router::with_path("health").get(health))
        .push(ingest_router(db.clone(), broadcaster.clone()))
        .push(query_router(db.clone()))
        .push(events_router(db.clone(), broadcaster))
        .push(export_router(db))
        .push(
            Router::with_path("{*path}")
                .hoop(affix_state::inject(StaticRoot(detect_static_root())))
                .get(serve_static),
        )
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let conn = Connection::open_in_memory().expect("failed to open database");
    run_migrations(&conn).expect("failed to run migrations");
    let db = Arc::new(Mutex::new(conn));
    let broadcaster = UpdateBroadcaster::new(256);

    let router = app_router(db, broadcaster);

    let acceptor = TcpListener::new("127.0.0.1:0").bind().await;
    tracing::info!("Listening on {:?}", acceptor.local_addr());

    Server::new(acceptor).serve(router).await;
}

#[cfg(test)]
mod tests {
    use salvo::test::{TestClient, ResponseExt};
    use std::fs;

    fn setup_static_dir(dir: &std::path::Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("index.html"), "<html><body>dashboard</body></html>").unwrap();
        fs::write(dir.join("test.txt"), "hello world").unwrap();
        let assets = dir.join("assets");
        fs::create_dir_all(&assets).unwrap();
        fs::write(assets.join("app.js"), "console.log('app')").unwrap();
    }

    fn router_with_static(tmp: &std::path::Path) -> super::Router {
        super::Router::new()
            .push(super::Router::with_path("health").get(super::health))
            .push(
                super::Router::with_path("{*path}")
                    .hoop(super::affix_state::inject(super::StaticRoot(tmp.to_path_buf())))
                    .get(super::serve_static),
            )
    }

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let router = super::Router::new()
            .push(super::Router::with_path("health").get(super::health));

        let res = TestClient::get("http://127.0.0.1:3000/health")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
    }

    #[tokio::test]
    async fn static_serves_index_html_on_root() {
        let tmp = tempfile::tempdir().unwrap();
        setup_static_dir(tmp.path());

        let router = router_with_static(tmp.path());

        let mut res = TestClient::get("http://127.0.0.1:3000/")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
        let body = res.take_string().await.unwrap();
        assert!(body.contains("dashboard"));
    }

    #[tokio::test]
    async fn static_serves_specific_file() {
        let tmp = tempfile::tempdir().unwrap();
        setup_static_dir(tmp.path());

        let router = router_with_static(tmp.path());

        let mut res = TestClient::get("http://127.0.0.1:3000/test.txt")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
        let body = res.take_string().await.unwrap();
        assert_eq!(body, "hello world");
    }

    #[tokio::test]
    async fn static_serves_nested_assets() {
        let tmp = tempfile::tempdir().unwrap();
        setup_static_dir(tmp.path());

        let router = router_with_static(tmp.path());

        let mut res = TestClient::get("http://127.0.0.1:3000/assets/app.js")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
        let body = res.take_string().await.unwrap();
        assert_eq!(body, "console.log('app')");
    }

    #[tokio::test]
    async fn static_spa_fallback_for_unknown_routes() {
        let tmp = tempfile::tempdir().unwrap();
        setup_static_dir(tmp.path());

        let router = router_with_static(tmp.path());

        let mut res = TestClient::get("http://127.0.0.1:3000/sessions")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
        let body = res.take_string().await.unwrap();
        assert!(body.contains("dashboard"));
    }

    #[tokio::test]
    async fn api_routes_still_work_with_static() {
        use std::sync::{Arc, Mutex};
        use rusqlite::Connection;
        use sidecar_api::api::UpdateBroadcaster;
        use sidecar_database::schema::run_migrations;

        let tmp = tempfile::tempdir().unwrap();
        setup_static_dir(tmp.path());

        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let db = Arc::new(Mutex::new(conn));
        let broadcaster = UpdateBroadcaster::new(256);

        let router = super::app_router(db, broadcaster);

        let res = TestClient::get("http://127.0.0.1:3000/health")
            .send(router)
            .await;

        assert_eq!(res.status_code, Some(super::StatusCode::OK));
    }
}
