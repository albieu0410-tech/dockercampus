use crate::db;
use crate::errors::{AppError, Result};
use crate::state::AppState;
use axum::{
    body::Bytes,
    extract::{ws::WebSocketUpgrade, Path, RawQuery, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::sync::Arc;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use uuid::Uuid;

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

#[derive(Deserialize)]
pub struct ExecRequest {
    pub command: String,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", get(list_containers))
        .route("/create", post(create_container))
        .route("/app/:user_id/*path", get(proxy_or_ws_to_container_get))
        .route("/app/:user_id/*path", post(proxy_to_container_http))
        .route("/app/:user_id/*path", delete(proxy_to_container_http))
        .route("/app/:user_id/*path", axum::routing::put(proxy_to_container_http))
        .route(
            "/app/:user_id/*path",
            axum::routing::patch(proxy_to_container_http),
        )
        .route(
            "/app/:user_id/*path",
            axum::routing::options(proxy_to_container_http),
        )
        .route("/app/:user_id/*path", axum::routing::head(proxy_to_container_http))
        .route("/:user_id/exec", post(exec_in_container))
        .route("/:user_id/start", post(start_container))
        .route("/:user_id/stop", post(stop_container))
        .route("/:user_id/wake", post(wake_container))
        .route("/:user_id/delete", delete(delete_container))
        .route("/:user_id/stats", get(get_container_stats))
}

fn sanitize_command(cmd: &str) -> Result<String> {
    let blocked_patterns = [
        "rm -rf /",
        "rm -rf /*",
        "mkfs",
        "dd if=",
        "> /dev/sda",
        "> /dev/null",
        "chmod 777 /",
        "chmod -R 777 /",
        "curl | sh",
        "curl | bash",
        "wget | sh",
        "wget | bash",
        ":(){:|:&};:",
        "fork bomb",
        "shutdown",
        "reboot",
        "halt",
        "poweroff",
        "init 0",
        "init 6",
        "> /etc/passwd",
        "> /etc/shadow",
        "passwd root",
    ];

    for pattern in &blocked_patterns {
        if cmd.to_lowercase().contains(&pattern.to_lowercase()) {
            return Err(AppError::BadRequest(
                "Command contains blocked pattern and cannot be executed.".to_string(),
            ));
        }
    }

    if cmd.len() > 2048 {
        return Err(AppError::BadRequest(
            "Command exceeds maximum allowed length.".to_string(),
        ));
    }

    Ok(cmd.to_string())
}

async fn list_containers(State(state): State<Arc<AppState>>) -> Result<Json<serde_json::Value>> {
    let containers = sqlx::query(
        r#"
        SELECT c.id, c.user_id, c.docker_container_id,
               c.port, c.status::text as status,
               c.cpu_limit, c.memory_limit_mb, c.created_at
        FROM containers c
        ORDER BY c.created_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    let out = containers
        .into_iter()
        .map(|row| {
            Ok(serde_json::json!({
                "id": row.try_get::<Uuid, _>("id")?.to_string(),
                "user_id": row.try_get::<Uuid, _>("user_id")?.to_string(),
                "docker_container_id": row.try_get::<Option<String>, _>("docker_container_id")?,
                "port": row.try_get::<i32, _>("port")?,
                "status": row.try_get::<String, _>("status")?,
                "cpu_limit": row.try_get::<f64, _>("cpu_limit")?,
                "memory_limit_mb": row.try_get::<i32, _>("memory_limit_mb")?,
                "created_at": row.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at")?.to_rfc3339(),
            }))
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(Json(serde_json::Value::Array(out)))
}

async fn create_container(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateContainerRequest>,
) -> Result<Json<CreateContainerResponse>> {
    let memory_limit_mb = payload.memory_limit_mb.unwrap_or(512);
    let cpu_limit = payload.cpu_limit.unwrap_or(0.5);
    let user_id = payload.user_id.to_string();

    let ram_check: i64 =
        sqlx::query("SELECT COUNT(*) AS count FROM containers WHERE status = 'running'")
            .fetch_one(&state.db)
            .await?
            .try_get("count")?;

    let max_containers: i64 = std::env::var("MAX_CONTAINERS")
        .unwrap_or_else(|_| "8".to_string())
        .parse()
        .unwrap_or(8);

    if ram_check >= max_containers {
        return Err(AppError::ResourceLimitExceeded);
    }

    let port = db::get_available_port(&state.db).await?;

    let docker_id = state
        .docker
        .create_container(&user_id, port, memory_limit_mb, cpu_limit)
        .await?;

    state.docker.start_container(&docker_id).await?;

    sqlx::query(
        r#"
        INSERT INTO containers (
            user_id, docker_container_id, port,
            status, cpu_limit, memory_limit_mb
        )
        VALUES ($1, $2, $3, 'running', $4, $5)
        "#,
    )
    .bind(payload.user_id)
    .bind(&docker_id)
    .bind(port)
    .bind(cpu_limit)
    .bind(memory_limit_mb)
    .execute(&state.db)
    .await?;

    let editor_url = format!("https://dockcampus.sudelca.com/student/{}", user_id);

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
    let container = sqlx::query("SELECT docker_container_id FROM containers WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container
        .try_get::<Option<String>, _>("docker_container_id")?
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    state.docker.start_container(&docker_id).await?;

    sqlx::query(
        r#"
        UPDATE containers
        SET status = 'running', last_activity = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({
        "message": "Container started successfully",
        "user_id": user_id
    })))
}

async fn wake_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query(
        r#"
        SELECT docker_container_id
        FROM containers
        WHERE user_id = $1 AND status = 'sleeping'
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?;

    let Some(c) = container else {
        return Ok(Json(serde_json::json!({ "status": "not_sleeping" })));
    };

    let docker_id = c
        .try_get::<Option<String>, _>("docker_container_id")?
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    state.docker.start_container(&docker_id).await?;

    sqlx::query(
        r#"
        UPDATE containers
        SET status = 'running', last_activity = NOW()
        WHERE user_id = $1
        "#,
    )
    .bind(user_id)
    .execute(&state.db)
    .await?;

    tracing::info!("Container for user {} woke up", user_id);

    Ok(Json(serde_json::json!({ "status": "awake" })))
}

async fn stop_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let container = sqlx::query("SELECT docker_container_id FROM containers WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container
        .try_get::<Option<String>, _>("docker_container_id")?
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    state.docker.stop_container(&docker_id).await?;

    sqlx::query("UPDATE containers SET status = 'stopped' WHERE user_id = $1")
        .bind(user_id)
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
    let container =
        sqlx::query("SELECT docker_container_id, port FROM containers WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("Container for user {} not found", user_id))
            })?;

    if let Some(docker_id) = container
        .try_get::<Option<String>, _>("docker_container_id")?
        .as_deref()
    {
        state.docker.remove_container(docker_id).await?;
    }

    let port: i32 = container.try_get("port")?;
    db::release_port(&state.db, port).await?;

    sqlx::query("DELETE FROM containers WHERE user_id = $1")
        .bind(user_id)
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
    let container = sqlx::query("SELECT docker_container_id FROM containers WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container
        .try_get::<Option<String>, _>("docker_container_id")?
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    let stats = state.docker.get_container_stats(&docker_id).await?;

    Ok(Json(serde_json::json!({
        "cpu_usage_percent": stats.cpu_usage_percent,
        "memory_usage_mb": stats.memory_usage_mb,
        "memory_limit_mb": stats.memory_limit_mb,
        "status": format!("{:?}", stats.status)
    })))
}

async fn exec_in_container(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<ExecRequest>,
) -> Result<Json<serde_json::Value>> {
    let safe_command = sanitize_command(&payload.command)?;

    let container = sqlx::query("SELECT docker_container_id FROM containers WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("Container for user {} not found", user_id)))?;

    let docker_id = container
        .try_get::<Option<String>, _>("docker_container_id")?
        .ok_or_else(|| AppError::NotFound("Docker container ID not set".to_string()))?;

    sqlx::query("UPDATE containers SET last_activity = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let output = state.docker.exec_command(&docker_id, &safe_command).await?;

    Ok(Json(serde_json::json!({
        "output": output,
        "success": true
    })))
}

#[derive(Debug)]
struct ProxyTarget {
    status: String,
    port: i32,
    docker_container_id: Option<String>,
}

async fn proxy_to_container_http(
    State(state): State<Arc<AppState>>,
    Path((user_id, path)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response> {
    proxy_http_inner(
        &state,
        &user_id,
        &path,
        query,
        method,
        headers,
        Some(body),
    )
    .await
}

async fn proxy_or_ws_to_container_get(
    ws: Option<WebSocketUpgrade>,
    State(state): State<Arc<AppState>>,
    Path((user_id, path)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    headers: HeaderMap,
) -> Result<Response> {
    if let Some(ws) = ws {
        let user_id_uuid = parse_user_id(&user_id)?;
        let target = fetch_proxy_target(&state, user_id_uuid).await?;

        if target.status == "sleeping" {
            wake_sleeping_container(&state, user_id_uuid, target.docker_container_id.as_deref())
                .await?;
            return Ok((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({
                    "detail": "Container is waking up. Please try again in a few seconds."
                })),
            )
                .into_response());
        }
        if target.status != "running" {
            return Ok((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "detail": "Container is not running" })),
            )
                .into_response());
        }

        touch_last_activity(&state, user_id_uuid).await?;

        let mut target_url = format!("ws://host.docker.internal:{}/{}", target.port, path);
        if let Some(q) = query.as_deref().filter(|q| !q.is_empty()) {
            target_url.push('?');
            target_url.push_str(q);
        }

        return Ok(ws
            .on_upgrade(move |socket| bridge_websocket(socket, target_url, headers))
            .into_response());
    }

    proxy_http_inner(
        &state,
        &user_id,
        &path,
        query,
        Method::GET,
        headers,
        None,
    )
    .await
}

async fn proxy_http_inner(
    state: &AppState,
    user_id: &str,
    path: &str,
    query: Option<String>,
    method: Method,
    headers: HeaderMap,
    body: Option<Bytes>,
) -> Result<Response> {
    let user_id = parse_user_id(&user_id)?;
    let target = fetch_proxy_target(state, user_id).await?;

    if target.status == "sleeping" {
        wake_sleeping_container(state, user_id, target.docker_container_id.as_deref()).await?;
        return Ok((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({
                "detail": "Container is waking up. Please try again in a few seconds."
            })),
        )
            .into_response());
    }

    if target.status != "running" {
        return Ok((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({ "detail": "Container is not running" })),
        )
            .into_response());
    }

    touch_last_activity(state, user_id).await?;

    let mut target_url = format!("http://host.docker.internal:{}/{}", target.port, path);
    if let Some(query) = query.as_deref().filter(|q| !q.is_empty()) {
        target_url.push('?');
        target_url.push_str(query);
    }

    let reqwest_method =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).map_err(anyhow::Error::from)?;
    let mut req_builder = state.http_client.request(reqwest_method, target_url);
    for (name, value) in &headers {
        if should_skip_proxy_header(name.as_str()) {
            continue;
        }
        req_builder = req_builder.header(name, value);
    }
    if let Some(body) = body {
        req_builder = req_builder.body(body);
    }

    let upstream = req_builder.send().await.map_err(anyhow::Error::from)?;
    let status = upstream.status();
    let mut resp = axum::http::Response::builder().status(status.as_u16());
    for (name, value) in upstream.headers() {
        if !should_skip_response_header(name.as_str()) {
            resp = resp.header(name, value);
        }
    }
    let bytes = upstream.bytes().await.map_err(anyhow::Error::from)?;
    Ok(resp
        .body(axum::body::Body::from(bytes))
        .map_err(anyhow::Error::from)?
        .into_response())
}

async fn bridge_websocket(socket: axum::extract::ws::WebSocket, target_url: String, headers: HeaderMap) {
    let mut request = axum::http::Request::builder().uri(target_url);
    for (name, value) in headers.iter() {
        if should_skip_proxy_header(name.as_str()) {
            continue;
        }
        request = request.header(name, value);
    }
    let Ok(request) = request.body(()) else {
        return;
    };

    let Ok((upstream, _)) = tokio_tungstenite::connect_async(request).await else {
        return;
    };

    let (mut client_tx, mut client_rx) = socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();

    let c2u = async {
        while let Some(Ok(msg)) = client_rx.next().await {
            let mapped = match msg {
                axum::extract::ws::Message::Text(v) => WsMessage::Text(v),
                axum::extract::ws::Message::Binary(v) => WsMessage::Binary(v),
                axum::extract::ws::Message::Ping(v) => WsMessage::Ping(v),
                axum::extract::ws::Message::Pong(v) => WsMessage::Pong(v),
                axum::extract::ws::Message::Close(_) => WsMessage::Close(None),
            };
            if upstream_tx.send(mapped).await.is_err() {
                break;
            }
        }
    };

    let u2c = async {
        while let Some(Ok(msg)) = upstream_rx.next().await {
            let mapped = match msg {
                WsMessage::Text(v) => axum::extract::ws::Message::Text(v),
                WsMessage::Binary(v) => axum::extract::ws::Message::Binary(v),
                WsMessage::Ping(v) => axum::extract::ws::Message::Ping(v),
                WsMessage::Pong(v) => axum::extract::ws::Message::Pong(v),
                WsMessage::Close(_) => axum::extract::ws::Message::Close(None),
                WsMessage::Frame(_) => continue,
            };
            if client_tx.send(mapped).await.is_err() {
                break;
            }
        }
    };

    tokio::select! {
        _ = c2u => {}
        _ = u2c => {}
    }
}

fn parse_user_id(value: &str) -> Result<Uuid> {
    Uuid::parse_str(value).map_err(|_| AppError::BadRequest("Invalid user ID".to_string()))
}

async fn fetch_proxy_target(state: &AppState, user_id: Uuid) -> Result<ProxyTarget> {
    let row = sqlx::query(
        "SELECT status::text as status, port, docker_container_id FROM containers WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Container not found".to_string()))?;

    Ok(ProxyTarget {
        status: row.try_get("status")?,
        port: row.try_get("port")?,
        docker_container_id: row.try_get("docker_container_id")?,
    })
}

async fn wake_sleeping_container(
    state: &AppState,
    user_id: Uuid,
    docker_container_id: Option<&str>,
) -> Result<()> {
    if let Some(docker_id) = docker_container_id {
        state.docker.start_container(docker_id).await?;
        sqlx::query(
            "UPDATE containers SET status = 'running', last_activity = NOW() WHERE user_id = $1",
        )
        .bind(user_id)
        .execute(&state.db)
        .await?;
    }
    Ok(())
}

async fn touch_last_activity(state: &AppState, user_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE containers SET last_activity = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

fn should_skip_proxy_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "upgrade"
    )
}

fn should_skip_response_header(name: &str) -> bool {
    matches!(name.to_ascii_lowercase().as_str(), "transfer-encoding")
}
