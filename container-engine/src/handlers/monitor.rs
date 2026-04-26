use crate::errors::Result;
use crate::state::AppState;
use axum::{extract::State, routing::get, Json, Router};
use sqlx::Row;
use std::sync::Arc;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats", get(get_stats))
        .route("/health", get(health_check))
}

async fn get_stats(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>> {
    let system_stats = state.docker.get_system_stats().await?;

    let db_containers = sqlx::query(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE status = 'running') as running,
            COUNT(*) FILTER (WHERE status = 'stopped') as stopped,
            COUNT(*) as total
        FROM containers
        "#,
    )
    .fetch_one(&state.db)
    .await?;

    let running: i64 = db_containers.try_get("running")?;
    let stopped: i64 = db_containers.try_get("stopped")?;
    let total: i64 = db_containers.try_get("total")?;

    Ok(Json(serde_json::json!({
        "docker": {
            "version": system_stats.docker_version,
            "total_containers": system_stats.total_containers,
            "running_containers": system_stats.running_containers,
        },
        "database": {
            "total_students": total,
            "running_containers": running,
            "stopped_containers": stopped,
        }
    })))
}

async fn health_check() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "container-engine",
        "version": env!("CARGO_PKG_VERSION")
    }))
}
