use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use utoipa::IntoParams;
use uuid::Uuid;

use crate::{
    errors::{AppError, Result},
    jobs,
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_jobs).post(create_job))
        .route("/:job_id/retry", post(retry_job))
        .route("/:job_id/cancel", post(cancel_job))
}

#[derive(Debug, Deserialize, IntoParams)]
pub(crate) struct JobQuery {
    status: Option<String>,
    limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/jobs",
    tag = "jobs",
    params(JobQuery),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "List of background jobs", body = [jobs::JobRecord]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_jobs(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<JobQuery>,
) -> Result<Json<Vec<jobs::JobRecord>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let status = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let out = jobs::list_jobs(&state.db, limit, status).await?;
    Ok(Json(out))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub(crate) struct CreateJobRequest {
    job_type: String,
    payload: Option<serde_json::Value>,
    max_retries: Option<i32>,
}

#[utoipa::path(
    post,
    path = "/jobs",
    tag = "jobs",
    request_body = CreateJobRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 201, description = "Job created", body = jobs::JobRecord),
        (status = 400, description = "job_type is required", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn create_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CreateJobRequest>,
) -> Result<(StatusCode, Json<jobs::JobRecord>)> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let job_type = payload.job_type.trim();
    if job_type.is_empty() {
        return Err(AppError::BadRequest("job_type is required".to_string()));
    }

    let max_retries = payload.max_retries.unwrap_or(3).clamp(0, 20);
    let payload_json = payload.payload.unwrap_or_else(|| serde_json::json!({}));

    let job = jobs::enqueue_job(&state.db, job_type, &payload_json, max_retries).await?;
    Ok((StatusCode::CREATED, Json(job)))
}

#[utoipa::path(
    post,
    path = "/jobs/{job_id}/retry",
    tag = "jobs",
    params(("job_id" = Uuid, Path, description = "Job ID")),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Job scheduled for retry", body = jobs::JobRecord),
        (status = 400, description = "Job not retryable or not found", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn retry_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<jobs::JobRecord>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let job = jobs::retry_job(&state.db, job_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("Job not retryable or not found".to_string()))?;

    Ok(Json(job))
}

#[utoipa::path(
    post,
    path = "/jobs/{job_id}/cancel",
    tag = "jobs",
    params(("job_id" = Uuid, Path, description = "Job ID")),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Job cancelled", body = jobs::JobRecord),
        (status = 400, description = "Job not cancellable or not found", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn cancel_job(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(job_id): Path<Uuid>,
) -> Result<Json<jobs::JobRecord>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let job = jobs::cancel_job(&state.db, job_id)
        .await?
        .ok_or_else(|| AppError::BadRequest("Job not cancellable or not found".to_string()))?;

    Ok(Json(job))
}
