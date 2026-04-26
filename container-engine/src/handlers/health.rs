use std::sync::{Arc, OnceLock};
use std::time::Instant;

use axum::{extract::State, routing::get, Json, Router};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/", get(health))
}

fn start_time() -> Instant {
    static START: OnceLock<Instant> = OnceLock::new();
    *START.get_or_init(Instant::now)
}

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let started = start_time();
    let db_started = Instant::now();
    let db_result = sqlx::query("SELECT 1").fetch_one(&state.db).await;
    let db_latency = ((db_started.elapsed().as_secs_f64()) * 1000.0 * 100.0).round() / 100.0;

    let (db_status, db_latency_ms) = match db_result {
        Ok(_) => ("ok".to_string(), Some(db_latency)),
        Err(e) => (format!("error: {e}"), None),
    };

    let uptime_seconds = started.elapsed().as_secs();
    let overall = if db_status == "ok" { "ok" } else { "degraded" };

    Json(serde_json::json!({
        "status": overall,
        "uptime_seconds": uptime_seconds,
        "services": {
            "api": { "status": "ok" },
            "database": {
                "status": db_status,
                "latency_ms": db_latency_ms,
            }
        }
    }))
}
