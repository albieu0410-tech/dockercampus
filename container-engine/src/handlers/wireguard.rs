use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use utoipa::ToSchema;

use crate::{
    errors::{AppError, Result},
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
    wireguard::{self, WireGuardManager},
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/status", get(get_status))
        .route("/peers", get(list_peers).post(upsert_peer))
        .route("/peers/:node_id", put(update_peer))
        .route("/peers/:node_id/handshake", post(record_handshake))
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct WireGuardStatusOut {
    enabled: bool,
    configured: bool,
    interface: String,
    network_cidr: String,
    listen_port: u16,
    has_private_key: bool,
    has_public_key: bool,
}

#[utoipa::path(
    get,
    path = "/wireguard/status",
    tag = "wireguard",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "WireGuard interface configuration status", body = WireGuardStatusOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn get_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<WireGuardStatusOut>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let status = WireGuardManager::from_env().status();
    Ok(Json(WireGuardStatusOut {
        enabled: status.enabled,
        configured: status.configured,
        interface: status.interface,
        network_cidr: status.network_cidr,
        listen_port: status.listen_port,
        has_private_key: status.has_private_key,
        has_public_key: status.has_public_key,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct WireGuardPeerOut {
    id: String,
    node_id: String,
    public_key: String,
    preshared_key: Option<String>,
    allowed_ips: String,
    endpoint: Option<String>,
    is_active: bool,
    last_handshake: Option<String>,
    updated_at: String,
}

#[utoipa::path(
    get,
    path = "/wireguard/peers",
    tag = "wireguard",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "List of WireGuard peers", body = [WireGuardPeerOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_peers(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<WireGuardPeerOut>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let rows = sqlx::query(
        r#"
        SELECT id, node_id, public_key, preshared_key, allowed_ips, endpoint, is_active, last_handshake, updated_at
        FROM wireguard_peers
        ORDER BY is_active DESC, updated_at DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let peers = rows
        .into_iter()
        .map(|row| {
            let last_handshake: Option<DateTime<Utc>> = row.try_get("last_handshake")?;
            let updated_at: DateTime<Utc> = row.try_get("updated_at")?;
            Ok(WireGuardPeerOut {
                id: row.try_get("id")?,
                node_id: row.try_get("node_id")?,
                public_key: row.try_get("public_key")?,
                preshared_key: row.try_get("preshared_key")?,
                allowed_ips: row.try_get("allowed_ips")?,
                endpoint: row.try_get("endpoint")?,
                is_active: row.try_get("is_active")?,
                last_handshake: last_handshake.map(|v| v.to_rfc3339()),
                updated_at: updated_at.to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(Json(peers))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpsertPeerRequest {
    node_id: String,
    public_key: Option<String>,
    preshared_key: Option<String>,
    allowed_ips: Option<String>,
    endpoint: Option<String>,
    is_active: Option<bool>,
}

#[utoipa::path(
    post,
    path = "/wireguard/peers",
    tag = "wireguard",
    request_body = UpsertPeerRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Peer created or updated", body = WireGuardPeerOut),
        (status = 400, description = "Invalid node_id, key, or allowed_ips", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn upsert_peer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<UpsertPeerRequest>,
) -> Result<(StatusCode, Json<WireGuardPeerOut>)> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let node_id = payload.node_id.trim();
    if node_id.is_empty() {
        return Err(AppError::BadRequest("node_id is required".to_string()));
    }

    let public_key = payload
        .public_key
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::BadRequest("public_key is required".to_string()))?;
    if !wireguard::is_valid_key(&public_key) {
        return Err(AppError::BadRequest(
            "public_key must be a valid base64 WireGuard key".to_string(),
        ));
    }

    let preshared_key = Some(
        payload
            .preshared_key
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(WireGuardManager::generate_preshared_key),
    );

    let allowed_ips = payload
        .allowed_ips
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "0.0.0.0/0".to_string());
    if !valid_allowed_ips(&allowed_ips) {
        return Err(AppError::BadRequest(
            "allowed_ips must be a comma-separated CIDR list".to_string(),
        ));
    }

    let endpoint = payload.endpoint.map(|v| v.trim().to_string());
    let is_active = payload.is_active.unwrap_or(true);

    let row = sqlx::query(
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
        RETURNING id, node_id, public_key, preshared_key, allowed_ips, endpoint, is_active, last_handshake, updated_at
        "#,
    )
    .bind(node_id)
    .bind(&public_key)
    .bind(preshared_key)
    .bind(allowed_ips)
    .bind(endpoint)
    .bind(is_active)
    .fetch_one(&state.db)
    .await
    .map_err(map_peer_sql_error)?;

    Ok((StatusCode::OK, Json(peer_from_row(&row)?)))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdatePeerRequest {
    public_key: Option<String>,
    preshared_key: Option<String>,
    allowed_ips: Option<String>,
    endpoint: Option<String>,
    is_active: Option<bool>,
}

#[utoipa::path(
    put,
    path = "/wireguard/peers/{node_id}",
    tag = "wireguard",
    params(("node_id" = String, Path, description = "Hive node ID")),
    request_body = UpdatePeerRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Peer updated", body = WireGuardPeerOut),
        (status = 400, description = "Invalid node_id, key, allowed_ips, or no fields provided", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse),
        (status = 404, description = "WireGuard peer not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn update_peer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(node_id): Path<String>,
    Json(payload): Json<UpdatePeerRequest>,
) -> Result<Json<WireGuardPeerOut>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    if node_id.trim().is_empty() {
        return Err(AppError::BadRequest("node_id is required".to_string()));
    }

    if payload.public_key.is_none()
        && payload.preshared_key.is_none()
        && payload.allowed_ips.is_none()
        && payload.endpoint.is_none()
        && payload.is_active.is_none()
    {
        return Err(AppError::BadRequest(
            "At least one field must be provided".to_string(),
        ));
    }

    let public_key = payload
        .public_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);
    let preshared_key = payload
        .preshared_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);
    let allowed_ips = payload
        .allowed_ips
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);
    let endpoint = payload
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToString::to_string);

    if let Some(public_key) = &public_key {
        if !wireguard::is_valid_key(public_key) {
            return Err(AppError::BadRequest(
                "public_key must be a valid base64 WireGuard key".to_string(),
            ));
        }
    }
    if let Some(preshared_key) = &preshared_key {
        if !wireguard::is_valid_key(preshared_key) {
            return Err(AppError::BadRequest(
                "preshared_key must be a valid base64 WireGuard key".to_string(),
            ));
        }
    }
    if let Some(allowed_ips) = &allowed_ips {
        if !valid_allowed_ips(allowed_ips) {
            return Err(AppError::BadRequest(
                "allowed_ips must be a comma-separated CIDR list".to_string(),
            ));
        }
    }

    let row = sqlx::query(
        r#"
        UPDATE wireguard_peers
        SET public_key = COALESCE($1, public_key),
            preshared_key = COALESCE($2, preshared_key),
            allowed_ips = COALESCE($3, allowed_ips),
            endpoint = COALESCE($4, endpoint),
            is_active = COALESCE($5, is_active),
            updated_at = NOW()
        WHERE node_id = $6
        RETURNING id, node_id, public_key, preshared_key, allowed_ips, endpoint, is_active, last_handshake, updated_at
        "#,
    )
    .bind(public_key)
    .bind(preshared_key)
    .bind(allowed_ips)
    .bind(endpoint)
    .bind(payload.is_active)
    .bind(node_id.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("WireGuard peer not found".to_string()))?;

    Ok(Json(peer_from_row(&row)?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct HandshakeRequest {
    at: Option<DateTime<Utc>>,
}

#[utoipa::path(
    post,
    path = "/wireguard/peers/{node_id}/handshake",
    tag = "wireguard",
    params(("node_id" = String, Path, description = "Hive node ID")),
    request_body = HandshakeRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Handshake timestamp recorded"),
        (status = 400, description = "node_id is required", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "WireGuard peer not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn record_handshake(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(node_id): Path<String>,
    Json(payload): Json<HandshakeRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    if node_id.trim().is_empty() {
        return Err(AppError::BadRequest("node_id is required".to_string()));
    }

    let row = sqlx::query(
        r#"
        UPDATE wireguard_peers
        SET last_handshake = COALESCE($1, NOW()),
            updated_at = NOW()
        WHERE node_id = $2
        RETURNING last_handshake
        "#,
    )
    .bind(payload.at)
    .bind(node_id.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("WireGuard peer not found".to_string()))?;

    let handshake: DateTime<Utc> = row.try_get("last_handshake")?;
    Ok(Json(serde_json::json!({
        "ok": true,
        "node_id": node_id,
        "last_handshake": handshake.to_rfc3339(),
    })))
}

fn peer_from_row(row: &sqlx::postgres::PgRow) -> Result<WireGuardPeerOut> {
    let last_handshake: Option<DateTime<Utc>> = row.try_get("last_handshake")?;
    let updated_at: DateTime<Utc> = row.try_get("updated_at")?;

    Ok(WireGuardPeerOut {
        id: row.try_get("id")?,
        node_id: row.try_get("node_id")?,
        public_key: row.try_get("public_key")?,
        preshared_key: row.try_get("preshared_key")?,
        allowed_ips: row.try_get("allowed_ips")?,
        endpoint: row.try_get("endpoint")?,
        is_active: row.try_get("is_active")?,
        last_handshake: last_handshake.map(|v| v.to_rfc3339()),
        updated_at: updated_at.to_rfc3339(),
    })
}

fn map_peer_sql_error(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db_err) = &err {
        let message = db_err.message().to_lowercase();
        if message.contains("foreign key") {
            return AppError::BadRequest(
                "node_id must reference a registered hive node".to_string(),
            );
        }
    }

    AppError::Database(err)
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
