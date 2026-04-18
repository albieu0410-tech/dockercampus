use axum::{
    Router,
    routing::get,
    extract::State,
    Json,
};
use std::sync::Arc;
use crate::state::AppState;
use crate::errors::Result;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/stats", get(get_stats))
        .route("/health", get(health_check))
}

async fn get_stats(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>> {
    let system_stats = state.docker.get_system_stats().await?;

    let db_containers = sqlx::query!(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE status = 'running') as running,
            COUNT(*) FILTER (WHERE status = 'stopped') as stopped,
            COUNT(*) as total
        FROM containers
        "#
    )
    .fetch_one(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "docker": {
            "version": system_stats.docker_version,
            "total_containers": system_stats.total_containers,
            "running_containers": system_stats.running_containers,
        },
        "database": {
            "total_students": db_containers.total,
            "running_containers": db_containers.running,
            "stopped_containers": db_containers.stopped,
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