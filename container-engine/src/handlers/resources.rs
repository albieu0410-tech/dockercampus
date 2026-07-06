use std::sync::Arc;

use axum::{
    extract::State,
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use tokio::process::Command;

use crate::{
    errors::Result,
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/storage", get(get_storage_breakdown))
        .route("/cleanup", post(cleanup_resources))
}

#[utoipa::path(
    get,
    path = "/resources/storage",
    tag = "resources",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Disk, Docker, and log storage breakdown"),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn get_storage_breakdown(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let docker = parse_docker_df().await;
    let disk = get_disk_usage().await;
    let logs_size = get_log_size().await;

    Ok(Json(serde_json::json!({
        "disk": disk,
        "docker": docker,
        "logs_size": logs_size,
    })))
}

#[utoipa::path(
    post,
    path = "/resources/cleanup",
    tag = "resources",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Docker image and build cache cleanup summary"),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn cleanup_resources(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let mut details = Vec::<String>::new();

    let image_prune = Command::new("docker")
        .args(["image", "prune", "-f"])
        .output()
        .await;
    match image_prune {
        Ok(out) => details.push(format!(
            "Images: {}",
            String::from_utf8_lossy(&out.stdout).trim()
        )),
        Err(e) => details.push(format!("Image prune failed: {e}")),
    }

    let builder_prune = Command::new("docker")
        .args(["builder", "prune", "-f", "--keep-storage", "2GB"])
        .output()
        .await;
    match builder_prune {
        Ok(out) => details.push(format!(
            "Build cache: {}",
            String::from_utf8_lossy(&out.stdout).trim()
        )),
        Err(e) => details.push(format!("Builder prune failed: {e}")),
    }

    Ok(Json(serde_json::json!({
        "message": "Cleanup complete",
        "details": details,
    })))
}

async fn parse_docker_df() -> serde_json::Value {
    match Command::new("docker").args(["system", "df"]).output().await {
        Ok(out) => serde_json::json!({
            "raw": String::from_utf8_lossy(&out.stdout),
            "error": serde_json::Value::Null,
        }),
        Err(e) => serde_json::json!({
            "raw": "",
            "error": e.to_string(),
        }),
    }
}

async fn get_disk_usage() -> serde_json::Value {
    let out = Command::new("df").args(["-B1", "/"]).output().await;
    let Ok(out) = out else {
        return serde_json::json!({ "error": "failed to read disk usage" });
    };

    let stdout = String::from_utf8_lossy(&out.stdout);
    let line = stdout.lines().nth(1).unwrap_or_default();
    let cols = line.split_whitespace().collect::<Vec<_>>();
    if cols.len() < 5 {
        return serde_json::json!({ "error": "unexpected df output" });
    }

    let total = cols[1].parse::<f64>().unwrap_or(0.0);
    let used = cols[2].parse::<f64>().unwrap_or(0.0);
    let free = cols[3].parse::<f64>().unwrap_or(0.0);
    let percent = if total > 0.0 {
        ((used / total) * 1000.0).round() / 10.0
    } else {
        0.0
    };
    let gb = 1024.0 * 1024.0 * 1024.0;

    serde_json::json!({
        "total_gb": ((total / gb) * 100.0).round() / 100.0,
        "used_gb": ((used / gb) * 100.0).round() / 100.0,
        "free_gb": ((free / gb) * 100.0).round() / 100.0,
        "percent": percent,
    })
}

async fn get_log_size() -> String {
    match Command::new("du").args(["-sh", "/var/log"]).output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout)
            .split_whitespace()
            .next()
            .unwrap_or("unknown")
            .to_string(),
        Err(_) => "unknown".to_string(),
    }
}
