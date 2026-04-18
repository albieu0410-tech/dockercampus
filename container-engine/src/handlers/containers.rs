use axum::{
    Router,
    routing::{get, post, delete},
    extract::{Path, State},
    Json,
};
use std::sync::Arc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::state::AppState;
use crate::errors::{AppError, Result};
use crate::db;
use crate::models::container::{ContainerStatus, ContainerResponse};

#[derive(Deserialize)]
pub struct CreateContainerRequest {
    pub user_id: Uuid,
    pub memory_limit_mb: Option<i32>,
    pub cpu_limit: Option<f64>,
}

#[derive(Serialize)]
pub struct CreateContainerResponse {
    pub container_id: String,
    pub port: i32,
    pub editor_url: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_containers))
        .route("/create", post(create_container))
        .route("/:user_id/start", post(start_container))
        .route("/:user_id/stop", post(stop_container))
        .route("/:user_id/delete", delete(delete_container))
        .route("/:user_id/stats", get(get_container_stats))
}

async fn list_containers(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>> {
    let containers = sqlx::query!(
        r#"
        SELECT c.id, c.user_id, c.docker_container_id,
               c.port, c.status as "status: String",
               c.cpu_limit, c.memory_limit_mb, c.created_at
        FROM containers c
        ORDER BY c.created_at DESC
        "#
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "containers": containers.len() })))
}

async fn create_container(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateContainerRequest>,
) -> Result<Json<CreateContainerResponse>> {
    let memory_limit_mb = payload.memory_limit_mb.unwrap_or(512);
    let cpu_limit = payload.cpu_limit.unwrap_or(0.5);
    let user_id = payload.user_id.to_string();

    let ram_check = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM containers WHERE status = 'running'"
    )
    .fetch_one(&state.db)
    .await?
    .unwrap_or(0);

    if ram_check >= 8 {
        return Err(AppError::ResourceLimitExceeded);
    }

    let port = db::get_available_port(&state.db).await?;

    let docker_id = state.docker
        .create_container(&user_id, port, memory_limit_mb, cpu_limit)
        .await?;

    state.docker.start_container(&docker_id).await?;

    sqlx::query!(
        r#"
        INSERT INTO containers (user_id, docker_container_id, port, status, cpu_limit, memory_limit_mb)
        VALUES ($1, $2, $3, 'running', $4, $5)
        "#,
        payload.user_id,
        docker_id,
        port,
        cpu_limit,
        memory_limit_mb
    )
    .execute(&state.db)
    .await?;

    let editor_url = format!(
        "https://dockcampus.sudelca.com/student/{}",
        user_id
    );

    Ok(Json(CreateContainerResponse {
        container_id: docker_id,
        port,
        editor_url,
    }))
}

async fn start_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query!(
        "SELECT docker_container_id FROM containers WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container.docker_container_id
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    state.docker.start_container(&docker_id).await?;

    sqlx::query!(
        "UPDATE containers SET status = 'running' WHERE user_id = $1",
        user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "message": "Container started successfully",
        "user_id": user_id
    })))
}

async fn stop_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query!(
        "SELECT docker_container_id FROM containers WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container.docker_container_id
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    state.docker.stop_container(&docker_id).await?;

    sqlx::query!(
        "UPDATE containers SET status = 'stopped' WHERE user_id = $1",
        user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "message": "Container stopped successfully",
        "user_id": user_id
    })))
}

async fn delete_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query!(
        "SELECT docker_container_id, port FROM containers WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    if let Some(docker_id) = container.docker_container_id.as_deref() {
        state.docker.remove_container(&docker_id).await?;
    }

    db::release_port(&state.db, container.port).await?;

    sqlx::query!(
        "DELETE FROM containers WHERE user_id = $1",
        user_id
    )
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "message": "Container deleted successfully",
        "user_id": user_id
    })))
}

async fn get_container_stats(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query!(
        "SELECT docker_container_id FROM containers WHERE user_id = $1",
        user_id
    )
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container.docker_container_id
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    let stats = state.docker.get_container_stats(&docker_id).await?;

    Ok(Json(serde_json::json!({
        "cpu_usage_percent": stats.cpu_usage_percent,
        "memory_usage_mb": stats.memory_usage_mb,
        "memory_limit_mb": stats.memory_limit_mb,
        "status": format!("{:?}", stats.status)
    })))
}
