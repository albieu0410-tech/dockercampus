use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::{
    errors::Result,
    middleware::auth::{current_user, require_any_role, require_role},
    sleep,
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(status))
        .route("/run", post(run_once))
        .route("/candidates", get(candidates))
}

#[utoipa::path(
    get,
    path = "/sleep/status",
    tag = "sleep",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Current sleep manager configuration and container counts", body = sleep::SleepStatus),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<sleep::SleepStatus>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    Ok(Json(sleep::get_status(&state).await?))
}

#[utoipa::path(
    post,
    path = "/sleep/run",
    tag = "sleep",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Sleep sweep report", body = sleep::SleepReport),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn run_once(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<sleep::SleepReport>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    Ok(Json(sleep::run_once(&state).await?))
}

#[derive(Debug, Deserialize, IntoParams)]
pub(crate) struct CandidateQuery {
    limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/sleep/candidates",
    tag = "sleep",
    params(CandidateQuery),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Containers idle-eligible for sleep", body = [sleep::SleepCandidate]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn candidates(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<CandidateQuery>,
) -> Result<Json<Vec<sleep::SleepCandidate>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    Ok(Json(sleep::list_idle_candidates(&state, limit).await?))
}
