use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    errors::{AppError, Result},
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
    wireguard,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/nodes", get(list_nodes))
        .route("/join-info", get(join_info))
        .route("/join", post(join_hive))
        .route("/heartbeat", post(heartbeat))
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct HiveNodeOut {
    id: String,
    role: String,
    host: String,
    ip: String,
    ram_used: f64,
    ram_total: f64,
    cpu: f64,
    disk_used: f64,
    disk_total: f64,
    deployments: i32,
    last: String,
    online: bool,
}

#[utoipa::path(
    get,
    path = "/hive/nodes",
    tag = "hive",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "List of hive nodes with their current metrics", body = [HiveNodeOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_nodes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<HiveNodeOut>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let rows = sqlx::query(
        r#"
        SELECT node_id, role, host, ip,
               ram_used_gb, ram_total_gb, cpu_percent, disk_used_gb, disk_total_gb,
               deployments, last_heartbeat
        FROM hive_nodes
        ORDER BY role DESC, last_heartbeat DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let now = Utc::now();
    let nodes = rows
        .into_iter()
        .map(|row| {
            let hb: DateTime<Utc> = row.try_get("last_heartbeat")?;
            Ok(HiveNodeOut {
                id: row.try_get("node_id")?,
                role: row.try_get("role")?,
                host: row.try_get("host")?,
                ip: row.try_get("ip")?,
                ram_used: row.try_get("ram_used_gb")?,
                ram_total: row.try_get("ram_total_gb")?,
                cpu: row.try_get("cpu_percent")?,
                disk_used: row.try_get("disk_used_gb")?,
                disk_total: row.try_get("disk_total_gb")?,
                deployments: row.try_get("deployments")?,
                last: hb.to_rfc3339(),
                online: hb > now - Duration::seconds(60),
            })
        })
        .collect::<Result<Vec<HiveNodeOut>>>()?;

    Ok(Json(nodes))
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct JoinInfoOut {
    join_token: String,
    join_command: String,
}

#[utoipa::path(
    get,
    path = "/hive/join-info",
    tag = "hive",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Join token and ready-to-run join command for a new worker node", body = JoinInfoOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn join_info(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<JoinInfoOut>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let token = hive_join_token()?;
    let engine_url = std::env::var("CONTAINER_ENGINE_PUBLIC_URL")
        .or_else(|_| std::env::var("CONTAINER_ENGINE_URL"))
        .unwrap_or_else(|_| "http://container-engine:8001".to_string());

    let join_command = format!(
        "dockcampus-node join --endpoint {}/hive/join --token {}",
        engine_url.trim_end_matches('/'),
        token
    );

    Ok(Json(JoinInfoOut {
        join_token: token,
        join_command,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct JoinRequest {
    token: String,
    node_id: String,
    role: Option<String>,
    host: String,
    ip: String,
    ram_used: Option<f64>,
    ram_total: Option<f64>,
    cpu: Option<f64>,
    disk_used: Option<f64>,
    disk_total: Option<f64>,
    deployments: Option<i32>,
    wireguard_public_key: Option<String>,
    wireguard_preshared_key: Option<String>,
    wireguard_allowed_ips: Option<String>,
    wireguard_endpoint: Option<String>,
    wireguard_active: Option<bool>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct JoinResponse {
    node_uuid: Uuid,
    node_id: String,
    accepted: bool,
}

#[utoipa::path(
    post,
    path = "/hive/join",
    tag = "hive",
    request_body = JoinRequest,
    responses(
        (status = 200, description = "Node registered or updated in the hive", body = JoinResponse),
        (status = 400, description = "Invalid join token, node identity, or WireGuard key", body = crate::errors::ErrorResponse),
        (status = 401, description = "Invalid join token", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn join_hive(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<JoinRequest>,
) -> Result<(StatusCode, Json<JoinResponse>)> {
    validate_node_token(&payload.token)?;
    validate_node_identity(&payload.node_id, &payload.host, &payload.ip)?;
    let role = normalize_role(payload.role.as_deref().unwrap_or("worker"))?;

    let row = sqlx::query(
        r#"
        INSERT INTO hive_nodes (
            node_id, role, host, ip,
            ram_used_gb, ram_total_gb, cpu_percent, disk_used_gb, disk_total_gb, deployments, last_heartbeat
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (node_id) DO UPDATE
        SET role = EXCLUDED.role,
            host = EXCLUDED.host,
            ip = EXCLUDED.ip,
            ram_used_gb = EXCLUDED.ram_used_gb,
            ram_total_gb = EXCLUDED.ram_total_gb,
            cpu_percent = EXCLUDED.cpu_percent,
            disk_used_gb = EXCLUDED.disk_used_gb,
            disk_total_gb = EXCLUDED.disk_total_gb,
            deployments = EXCLUDED.deployments,
            last_heartbeat = NOW()
        RETURNING id, node_id
        "#,
    )
    .bind(payload.node_id.trim())
    .bind(role)
    .bind(payload.host.trim())
    .bind(payload.ip.trim())
    .bind(payload.ram_used.unwrap_or(0.0))
    .bind(payload.ram_total.unwrap_or(0.0))
    .bind(payload.cpu.unwrap_or(0.0))
    .bind(payload.disk_used.unwrap_or(0.0))
    .bind(payload.disk_total.unwrap_or(0.0))
    .bind(payload.deployments.unwrap_or(0))
    .fetch_one(&state.db)
    .await?;

    if let Some(public_key) = payload
        .wireguard_public_key
        .as_ref()
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        if !wireguard::is_valid_key(public_key) {
            return Err(AppError::BadRequest(
                "wireguard_public_key must be a valid base64 WireGuard key".to_string(),
            ));
        }

        let allowed_ips = payload
            .wireguard_allowed_ips
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| format!("{}/32", payload.ip.trim()));
        if !valid_allowed_ips(&allowed_ips) {
            return Err(AppError::BadRequest(
                "wireguard_allowed_ips must be a comma-separated CIDR list".to_string(),
            ));
        }

        let preshared_key = payload
            .wireguard_preshared_key
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        if let Some(preshared_key) = &preshared_key {
            if !wireguard::is_valid_key(preshared_key) {
                return Err(AppError::BadRequest(
                    "wireguard_preshared_key must be a valid base64 WireGuard key".to_string(),
                ));
            }
        }

        let endpoint = payload
            .wireguard_endpoint
            .as_ref()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        sqlx::query(
            r#"
            INSERT INTO wireguard_peers (node_id, public_key, preshared_key, allowed_ips, endpoint, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (node_id) DO UPDATE
            SET public_key = EXCLUDED.public_key,
                preshared_key = EXCLUDED.preshared_key,
                allowed_ips = EXCLUDED.allowed_ips,
                endpoint = EXCLUDED.endpoint,
                is_active = EXCLUDED.is_active,
                updated_at = NOW()
            "#,
        )
        .bind(payload.node_id.trim())
        .bind(public_key)
        .bind(preshared_key)
        .bind(allowed_ips)
        .bind(endpoint)
        .bind(payload.wireguard_active.unwrap_or(true))
        .execute(&state.db)
        .await?;
    }

    Ok((
        StatusCode::OK,
        Json(JoinResponse {
            node_uuid: row.try_get("id")?,
            node_id: row.try_get("node_id")?,
            accepted: true,
        }),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct HeartbeatRequest {
    token: String,
    node_id: String,
    ram_used: Option<f64>,
    ram_total: Option<f64>,
    cpu: Option<f64>,
    disk_used: Option<f64>,
    disk_total: Option<f64>,
    deployments: Option<i32>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct HeartbeatResponse {
    accepted: bool,
    last_heartbeat: String,
}

#[utoipa::path(
    post,
    path = "/hive/heartbeat",
    tag = "hive",
    request_body = HeartbeatRequest,
    responses(
        (status = 200, description = "Heartbeat recorded", body = HeartbeatResponse),
        (status = 400, description = "Invalid join token or node_id", body = crate::errors::ErrorResponse),
        (status = 401, description = "Invalid join token", body = crate::errors::ErrorResponse),
        (status = 404, description = "Node not registered", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn heartbeat(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<HeartbeatRequest>,
) -> Result<Json<HeartbeatResponse>> {
    validate_node_token(&payload.token)?;
    if payload.node_id.trim().is_empty() {
        return Err(AppError::BadRequest("node_id is required".to_string()));
    }

    let result = sqlx::query(
        r#"
        UPDATE hive_nodes
        SET ram_used_gb = COALESCE($1, ram_used_gb),
            ram_total_gb = COALESCE($2, ram_total_gb),
            cpu_percent = COALESCE($3, cpu_percent),
            disk_used_gb = COALESCE($4, disk_used_gb),
            disk_total_gb = COALESCE($5, disk_total_gb),
            deployments = COALESCE($6, deployments),
            last_heartbeat = NOW()
        WHERE node_id = $7
        RETURNING last_heartbeat
        "#,
    )
    .bind(payload.ram_used)
    .bind(payload.ram_total)
    .bind(payload.cpu)
    .bind(payload.disk_used)
    .bind(payload.disk_total)
    .bind(payload.deployments)
    .bind(payload.node_id.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Node not registered".to_string()))?;

    let hb: DateTime<Utc> = result.try_get("last_heartbeat")?;
    Ok(Json(HeartbeatResponse {
        accepted: true,
        last_heartbeat: hb.to_rfc3339(),
    }))
}

fn hive_join_token() -> Result<String> {
    let token = std::env::var("HIVE_JOIN_TOKEN")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("HIVE_JOIN_TOKEN is required")))?;
    if token.trim().is_empty() {
        return Err(AppError::Internal(anyhow::anyhow!(
            "HIVE_JOIN_TOKEN cannot be empty"
        )));
    }
    Ok(token)
}

fn validate_node_token(token: &str) -> Result<()> {
    let expected = hive_join_token()?;
    if token == expected {
        Ok(())
    } else {
        Err(AppError::Unauthorized("Invalid join token".to_string()))
    }
}

fn validate_node_identity(node_id: &str, host: &str, ip: &str) -> Result<()> {
    if node_id.trim().is_empty() {
        return Err(AppError::BadRequest("node_id is required".to_string()));
    }
    if host.trim().is_empty() {
        return Err(AppError::BadRequest("host is required".to_string()));
    }
    if ip.trim().is_empty() {
        return Err(AppError::BadRequest("ip is required".to_string()));
    }
    Ok(())
}

fn normalize_role(role: &str) -> Result<&'static str> {
    match role.to_lowercase().as_str() {
        "queen" => Ok("queen"),
        "worker" => Ok("worker"),
        _ => Err(AppError::BadRequest(
            "role must be either 'queen' or 'worker'".to_string(),
        )),
    }
}

fn valid_allowed_ips(raw: &str) -> bool {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .all(valid_cidr)
}

fn valid_cidr(raw: &str) -> bool {
    let mut parts = raw.split('/');
    let Some(ip) = parts.next() else {
        return false;
    };
    let Some(prefix) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }

    let Ok(prefix_len) = prefix.parse::<u8>() else {
        return false;
    };

    if ip.parse::<std::net::Ipv4Addr>().is_ok() {
        return prefix_len <= 32;
    }
    if ip.parse::<std::net::Ipv6Addr>().is_ok() {
        return prefix_len <= 128;
    }
    false
}
