use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;

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

async fn status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<sleep::SleepStatus>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    Ok(Json(sleep::get_status(&state).await?))
}

async fn run_once(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<sleep::SleepReport>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    Ok(Json(sleep::run_once(&state).await?))
}

#[derive(Debug, Deserialize)]
struct CandidateQuery {
    limit: Option<i64>,
}

async fn candidates(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<CandidateQuery>,
) -> Result<Json<Vec<sleep::SleepCandidate>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    Ok(Json(sleep::list_idle_candidates(&state, limit).await?))
}
