use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    routing::{get, post, put},
    Json, Router,
};
use chrono::{Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::{
    errors::{AppError, Result},
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
};

const ONLINE_WINDOW_SECONDS: i64 = 60;
const FALLBACK_WINDOW_SECONDS: i64 = 300;
const MAX_ERROR_RATE_FOR_HEALTHY: f64 = 95.0;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/state", get(get_state))
        .route("/strategy", put(set_strategy))
        .route("/canary", put(set_canary))
        .route("/nodes/:node_id", put(update_node_metrics))
        .route("/nodes/:node_id/circuit", post(set_circuit_state))
        .route("/decide", post(decide_route))
}

#[derive(Debug, Serialize)]
struct RoutingStateOut {
    strategy: String,
    canary_active: bool,
    canary_percent: i32,
    nodes: Vec<RouteNodeOut>,
}

#[derive(Debug, Serialize)]
struct RouteNodeOut {
    id: String,
    reqs: i64,
    rt: f64,
    err: f64,
    breaker: String,
    failures: i32,
    weight: i32,
    active_connections: i32,
    is_canary: bool,
    host: String,
    ip: String,
    online: bool,
}

async fn get_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<RoutingStateOut>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    ensure_config_and_metrics(&state).await?;

    let cfg = sqlx::query(
        "SELECT strategy, canary_active, canary_percent FROM routing_config WHERE id = 1",
    )
    .fetch_one(&state.db)
    .await?;

    let nodes = fetch_nodes(&state).await?;

    Ok(Json(RoutingStateOut {
        strategy: cfg.try_get("strategy")?,
        canary_active: cfg.try_get("canary_active")?,
        canary_percent: cfg.try_get("canary_percent")?,
        nodes,
    }))
}

#[derive(Debug, Deserialize)]
struct SetStrategyRequest {
    strategy: String,
}

async fn set_strategy(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<SetStrategyRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    validate_strategy(&payload.strategy)?;

    sqlx::query("UPDATE routing_config SET strategy = $1 WHERE id = 1")
        .bind(payload.strategy)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct SetCanaryRequest {
    active: bool,
    percent: i32,
}

async fn set_canary(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<SetCanaryRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    if !(0..=100).contains(&payload.percent) {
        return Err(AppError::BadRequest(
            "percent must be between 0 and 100".to_string(),
        ));
    }

    sqlx::query("UPDATE routing_config SET canary_active = $1, canary_percent = $2 WHERE id = 1")
        .bind(payload.active)
        .bind(payload.percent)
        .execute(&state.db)
        .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct UpdateNodeRequest {
    weight: Option<i32>,
    active_connections: Option<i32>,
    avg_response_ms: Option<f64>,
    error_rate: Option<f64>,
    is_canary: Option<bool>,
}

async fn update_node_metrics(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(node_id): Path<String>,
    Json(payload): Json<UpdateNodeRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    ensure_node_metrics(&state, &node_id).await?;

    if let Some(weight) = payload.weight {
        if weight <= 0 {
            return Err(AppError::BadRequest("weight must be > 0".to_string()));
        }
    }
    if let Some(ac) = payload.active_connections {
        if ac < 0 {
            return Err(AppError::BadRequest(
                "active_connections cannot be negative".to_string(),
            ));
        }
    }
    if let Some(err) = payload.error_rate {
        if !(0.0..=100.0).contains(&err) {
            return Err(AppError::BadRequest(
                "error_rate must be between 0 and 100".to_string(),
            ));
        }
    }

    sqlx::query(
        r#"
        UPDATE routing_node_metrics
        SET weight = COALESCE($1, weight),
            active_connections = COALESCE($2, active_connections),
            avg_response_ms = COALESCE($3, avg_response_ms),
            error_rate = COALESCE($4, error_rate),
            is_canary = COALESCE($5, is_canary)
        WHERE node_id = $6
        "#,
    )
    .bind(payload.weight)
    .bind(payload.active_connections)
    .bind(payload.avg_response_ms)
    .bind(payload.error_rate)
    .bind(payload.is_canary)
    .bind(node_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct SetCircuitRequest {
    state: String,
}

async fn set_circuit_state(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(node_id): Path<String>,
    Json(payload): Json<SetCircuitRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let circuit = normalize_circuit(&payload.state)?;
    ensure_node_metrics(&state, &node_id).await?;

    let current_state: String =
        sqlx::query_scalar("SELECT circuit_state FROM routing_node_metrics WHERE node_id = $1")
            .bind(&node_id)
            .fetch_one(&state.db)
            .await?;

    if !valid_circuit_transition(&current_state, circuit) {
        return Err(AppError::BadRequest(format!(
            "Invalid circuit transition: {current_state} -> {circuit}"
        )));
    }

    sqlx::query(
        "UPDATE routing_node_metrics SET circuit_state = $1, failure_count = CASE WHEN $1 = 'closed' THEN 0 WHEN $1 = 'half' THEN LEAST(failure_count, 1) ELSE failure_count END WHERE node_id = $2",
    )
    .bind(circuit)
    .bind(node_id)
    .execute(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
struct DecideRequest {
    client_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct DecideResponse {
    node_id: String,
    host: String,
    ip: String,
    strategy: String,
    canary: bool,
}

async fn decide_route(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<DecideRequest>,
) -> Result<Json<DecideResponse>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor", "student"])?;

    ensure_config_and_metrics(&state).await?;

    let cfg = sqlx::query(
        "SELECT strategy, canary_active, canary_percent, rr_cursor FROM routing_config WHERE id = 1",
    )
    .fetch_one(&state.db)
    .await?;

    let strategy_raw: String = cfg.try_get("strategy")?;
    let strategy = if validate_strategy(&strategy_raw).is_ok() {
        strategy_raw
    } else {
        "rr".to_string()
    };
    let canary_active: bool = cfg.try_get("canary_active")?;
    let canary_percent: i32 = cfg.try_get("canary_percent")?;
    let rr_cursor: i64 = cfg.try_get("rr_cursor")?;

    let mut nodes = fetch_nodes_with_metrics(&state, ONLINE_WINDOW_SECONDS).await?;
    if nodes.is_empty() {
        // Degraded fallback: allow very recent nodes before failing closed.
        nodes = fetch_nodes_with_metrics(&state, FALLBACK_WINDOW_SECONDS).await?;
    }
    if nodes.is_empty() {
        return Err(AppError::NotFound(
            "No online routing nodes available".to_string(),
        ));
    }

    let client_key = payload
        .client_id
        .unwrap_or_else(|| format!("{}-{}", me.id, Utc::now().timestamp_millis()));

    if canary_active && canary_percent > 0 {
        let bucket = hash_to_100(&client_key);
        if bucket < canary_percent as u64 {
            let canary_pool = nodes
                .iter()
                .filter(|n| n.is_canary && n.circuit_state != "open")
                .cloned()
                .collect::<Vec<_>>();
            if !canary_pool.is_empty() {
                nodes = canary_pool;
            }
        }
    }

    nodes.retain(|n| n.circuit_state != "open");
    nodes = prefer_healthy_nodes(nodes);
    if nodes.is_empty() {
        return Err(AppError::NotFound(
            "All routing nodes are in open circuit state".to_string(),
        ));
    }

    let selected = select_node(&strategy, &client_key, rr_cursor, &nodes)?;

    sqlx::query(
        "UPDATE routing_node_metrics SET requests_total = requests_total + 1 WHERE node_id = $1",
    )
    .bind(&selected.node_id)
    .execute(&state.db)
    .await?;

    if strategy == "rr" {
        sqlx::query("UPDATE routing_config SET rr_cursor = rr_cursor + 1 WHERE id = 1")
            .execute(&state.db)
            .await?;
    }

    Ok(Json(DecideResponse {
        node_id: selected.node_id,
        host: selected.host,
        ip: selected.ip,
        strategy,
        canary: selected.is_canary,
    }))
}

#[derive(Debug, Clone)]
struct NodeMetric {
    node_id: String,
    host: String,
    ip: String,
    weight: i32,
    active_connections: i32,
    avg_response_ms: f64,
    error_rate: f64,
    circuit_state: String,
    failure_count: i32,
    requests_total: i64,
    is_canary: bool,
}

fn select_node(
    strategy: &str,
    client_key: &str,
    rr_cursor: i64,
    nodes: &[NodeMetric],
) -> Result<NodeMetric> {
    if nodes.is_empty() {
        return Err(AppError::NotFound("No nodes available".to_string()));
    }

    match strategy {
        "rr" => {
            let idx = (rr_cursor.rem_euclid(nodes.len() as i64)) as usize;
            Ok(nodes[idx].clone())
        }
        "least" => nodes
            .iter()
            .min_by_key(|n| n.active_connections)
            .cloned()
            .ok_or_else(|| AppError::NotFound("No nodes available".to_string())),
        "sticky" => {
            let idx = (hash_to_100(client_key) as usize) % nodes.len();
            Ok(nodes[idx].clone())
        }
        "weight" => weighted_pick(nodes),
        _ => Err(AppError::BadRequest(
            "Unsupported routing strategy".to_string(),
        )),
    }
}

fn weighted_pick(nodes: &[NodeMetric]) -> Result<NodeMetric> {
    let total_weight: i32 = nodes.iter().map(|n| n.weight.max(1)).sum();
    if total_weight <= 0 {
        return nodes
            .first()
            .cloned()
            .ok_or_else(|| AppError::NotFound("No nodes available".to_string()));
    }

    let mut ticket = rand::thread_rng().gen_range(0..total_weight);
    for node in nodes {
        ticket -= node.weight.max(1);
        if ticket < 0 {
            return Ok(node.clone());
        }
    }

    nodes
        .last()
        .cloned()
        .ok_or_else(|| AppError::NotFound("No nodes available".to_string()))
}

fn hash_to_100(input: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.hash(&mut hasher);
    hasher.finish() % 100
}

async fn ensure_config_and_metrics(state: &AppState) -> Result<()> {
    sqlx::query(
        "INSERT INTO routing_config (id, strategy, canary_active, canary_percent, rr_cursor) VALUES (1, 'rr', false, 0, 0) ON CONFLICT (id) DO NOTHING",
    )
    .execute(&state.db)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO routing_node_metrics (node_id)
        SELECT node_id FROM hive_nodes
        ON CONFLICT (node_id) DO NOTHING
        "#,
    )
    .execute(&state.db)
    .await?;

    Ok(())
}

async fn ensure_node_metrics(state: &AppState, node_id: &str) -> Result<()> {
    let hive_exists = sqlx::query("SELECT 1 FROM hive_nodes WHERE node_id = $1")
        .bind(node_id)
        .fetch_optional(&state.db)
        .await?;
    if hive_exists.is_none() {
        return Err(AppError::NotFound("Hive node not found".to_string()));
    }

    sqlx::query(
        "INSERT INTO routing_node_metrics (node_id) VALUES ($1) ON CONFLICT (node_id) DO NOTHING",
    )
    .bind(node_id)
    .execute(&state.db)
    .await?;

    Ok(())
}

async fn fetch_nodes(state: &AppState) -> Result<Vec<RouteNodeOut>> {
    let rows = sqlx::query(
        r#"
        SELECT h.node_id, h.host, h.ip, h.last_heartbeat,
               m.requests_total, m.avg_response_ms, m.error_rate,
               m.circuit_state, m.failure_count, m.weight, m.active_connections, m.is_canary
        FROM hive_nodes h
        LEFT JOIN routing_node_metrics m ON m.node_id = h.node_id
        ORDER BY h.last_heartbeat DESC
        "#,
    )
    .fetch_all(&state.db)
    .await?;

    let now = Utc::now();
    let out = rows
        .into_iter()
        .map(|row| {
            let hb: chrono::DateTime<Utc> = row.try_get("last_heartbeat")?;
            Ok(RouteNodeOut {
                id: row.try_get("node_id")?,
                reqs: row
                    .try_get::<Option<i64>, _>("requests_total")?
                    .unwrap_or(0),
                rt: row
                    .try_get::<Option<f64>, _>("avg_response_ms")?
                    .unwrap_or(0.0),
                err: row.try_get::<Option<f64>, _>("error_rate")?.unwrap_or(0.0),
                breaker: row
                    .try_get::<Option<String>, _>("circuit_state")?
                    .unwrap_or_else(|| "closed".to_string()),
                failures: row.try_get::<Option<i32>, _>("failure_count")?.unwrap_or(0),
                weight: row.try_get::<Option<i32>, _>("weight")?.unwrap_or(100),
                active_connections: row
                    .try_get::<Option<i32>, _>("active_connections")?
                    .unwrap_or(0),
                is_canary: row
                    .try_get::<Option<bool>, _>("is_canary")?
                    .unwrap_or(false),
                host: row.try_get("host")?,
                ip: row.try_get("ip")?,
                online: hb > now - Duration::seconds(60),
            })
        })
        .collect::<Result<Vec<RouteNodeOut>>>()?;

    Ok(out)
}

async fn fetch_nodes_with_metrics(
    state: &AppState,
    window_seconds: i64,
) -> Result<Vec<NodeMetric>> {
    let rows = sqlx::query(
        r#"
        SELECT h.node_id, h.host, h.ip,
               m.weight, m.active_connections, m.avg_response_ms, m.error_rate,
               m.circuit_state, m.failure_count, m.requests_total, m.is_canary
        FROM hive_nodes h
        JOIN routing_node_metrics m ON m.node_id = h.node_id
        WHERE h.last_heartbeat > NOW() - make_interval(secs => $1)
        "#,
    )
    .bind(window_seconds as i32)
    .fetch_all(&state.db)
    .await?;

    let mut nodes = Vec::with_capacity(rows.len());
    for row in rows {
        nodes.push(NodeMetric {
            node_id: row.try_get("node_id")?,
            host: row.try_get("host")?,
            ip: row.try_get("ip")?,
            weight: row.try_get("weight")?,
            active_connections: row.try_get("active_connections")?,
            avg_response_ms: row.try_get("avg_response_ms")?,
            error_rate: row.try_get("error_rate")?,
            circuit_state: row.try_get("circuit_state")?,
            failure_count: row.try_get("failure_count")?,
            requests_total: row.try_get("requests_total")?,
            is_canary: row.try_get("is_canary")?,
        });
    }

    Ok(nodes)
}

fn prefer_healthy_nodes(nodes: Vec<NodeMetric>) -> Vec<NodeMetric> {
    let healthy = nodes
        .iter()
        .filter(|n| n.error_rate < MAX_ERROR_RATE_FOR_HEALTHY)
        .cloned()
        .collect::<Vec<_>>();

    if healthy.is_empty() {
        nodes
    } else {
        healthy
    }
}

fn validate_strategy(strategy: &str) -> Result<()> {
    match strategy {
        "rr" | "least" | "sticky" | "weight" => Ok(()),
        _ => Err(AppError::BadRequest(
            "strategy must be one of: rr, least, sticky, weight".to_string(),
        )),
    }
}

fn normalize_circuit(value: &str) -> Result<&'static str> {
    let v = value.to_lowercase();
    match v.as_str() {
        "closed" => Ok("closed"),
        "half" | "half-open" => Ok("half"),
        "open" => Ok("open"),
        _ => Err(AppError::BadRequest(
            "circuit state must be closed, half, or open".to_string(),
        )),
    }
}

fn valid_circuit_transition(from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }

    matches!(
        (from, to),
        ("closed", "open")
            | ("closed", "half")
            | ("open", "half")
            | ("half", "open")
            | ("half", "closed")
    )
}
