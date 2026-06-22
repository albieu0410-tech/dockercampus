use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use bollard::container::{
    Config, CreateContainerOptions, RemoveContainerOptions, StartContainerOptions,
    StopContainerOptions,
};
use bollard::image::BuildImageOptions;
use bollard::models::{HostConfig, PortBinding};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{error, info};
use uuid::Uuid;

use crate::errors::{AppError, Result};
use crate::middleware::auth::{current_user, require_any_role, require_role};
use crate::state::AppState;

#[derive(Deserialize, Clone)]
pub struct BuildRequest {
    pub user_id: String,
    pub image_tag: String,
    pub container_name: String,
}

#[derive(Serialize, Clone)]
pub struct BuildResponse {
    pub success: bool,
    pub output: String,
}

#[derive(Deserialize, Clone)]
pub struct RunRequest {
    pub image_tag: String,
    pub container_name: String,
    pub port: i32,
}

#[derive(Serialize, Clone)]
pub struct RunResponse {
    pub success: bool,
    pub output: String,
    pub container_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateDeploymentRequest {
    repo_url: String,
    custom_port: Option<i32>,
}

const STATUS_PENDING: &str = "pending";
const STATUS_CLONING: &str = "cloning";
const STATUS_DETECTING: &str = "detecting";
const STATUS_BUILDING: &str = "building";
const STATUS_STARTING: &str = "starting";
const STATUS_RUNNING: &str = "running";
const STATUS_FAILED: &str = "failed";
const STATUS_CANCELLED: &str = "cancelled";

#[derive(Serialize)]
struct DeploymentOut {
    id: Uuid,
    repo_url: String,
    detected_port: Option<i32>,
    custom_port: Option<i32>,
    status: String,
    build_logs: Option<String>,
    public_url: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct Paging {
    page: Option<i64>,
    limit: Option<i64>,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_deployment).get(list_deployments))
        .route("/:deployment_id", get(get_deployment))
        .route("/:deployment_id/cancel", post(cancel_deployment))
        .route("/build", post(build_image))
        .route("/run", post(run_container))
}

async fn create_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<CreateDeploymentRequest>,
) -> Result<(axum::http::StatusCode, Json<DeploymentOut>)> {
    let me = current_user(&state, &headers).await?;
    validate_create_deployment_request(&payload)?;

    let container = sqlx::query(
        "SELECT id, docker_container_id, port, status::text as status FROM containers WHERE user_id = $1",
    )
    .bind(me.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("No container found - create one first".to_string()))?;

    let container_status: String = container.try_get("status")?;
    if container_status != "running" {
        return Err(AppError::BadRequest("Container is not running".to_string()));
    }

    let container_id: Uuid = container.try_get("id")?;
    let docker_container_id: Option<String> = container.try_get("docker_container_id")?;
    let user_container_name =
        docker_container_id.unwrap_or_else(|| format!("dockcampus-student-{}", me.id));

    let github_token =
        sqlx::query("SELECT github_access_token FROM github_connections WHERE user_id = $1")
            .bind(me.id)
            .fetch_optional(&state.db)
            .await?
            .and_then(|r| r.try_get::<String, _>("github_access_token").ok());

    let existing_active = sqlx::query(
        r#"
        SELECT id
        FROM deployments
        WHERE user_id = $1
          AND repo_url = $2
          AND status IN ('pending','cloning','detecting','building','starting','running')
        LIMIT 1
        "#,
    )
    .bind(me.id)
    .bind(payload.repo_url.trim())
    .fetch_optional(&state.db)
    .await?;
    if existing_active.is_some() {
        return Err(AppError::Conflict(
            "Deployment already in progress or running for this repository".to_string(),
        ));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO deployments (user_id, container_id, repo_url, github_token, custom_port, status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        RETURNING id, repo_url, detected_port, custom_port, status, build_logs, public_url, created_at
        "#,
    )
    .bind(me.id)
    .bind(container_id)
    .bind(payload.repo_url.trim())
    .bind(github_token.clone())
    .bind(payload.custom_port)
    .fetch_one(&state.db)
    .await?;

    let deployment_id: Uuid = row.try_get("id")?;
    touch_container_activity(&state, me.id).await?;

    let state_for_task = state.clone();
    let repo_url = payload.repo_url.clone();
    let custom_port = payload.custom_port;
    let github_token_for_task = github_token.clone();
    let github_token_for_logs = github_token.clone();
    tokio::spawn(async move {
        let state_for_fail = state_for_task.clone();
        if let Err(e) = run_deployment_task(
            state_for_task,
            deployment_id,
            me.id,
            user_container_name,
            repo_url,
            github_token_for_task,
            custom_port,
        )
        .await
        {
            error!("deployment task failed: {e}");
            let _ = force_fail_deployment(
                &state_for_fail,
                deployment_id,
                format!(
                    "Error: {}",
                    redact_token(&e.to_string(), &github_token_for_logs)
                ),
            )
            .await;
        }
    });

    Ok((
        axum::http::StatusCode::CREATED,
        Json(DeploymentOut {
            id: deployment_id,
            repo_url: row.try_get("repo_url")?,
            detected_port: row.try_get("detected_port")?,
            custom_port: row.try_get("custom_port")?,
            status: row.try_get("status")?,
            build_logs: row.try_get("build_logs")?,
            public_url: row.try_get("public_url")?,
            created_at: row.try_get("created_at")?,
        }),
    ))
}

async fn list_deployments(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(paging): Query<Paging>,
) -> Result<Json<Vec<DeploymentOut>>> {
    let me = current_user(&state, &headers).await?;
    let page = paging.page.unwrap_or(1).max(1);
    let limit = paging.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = sqlx::query(
        r#"
        SELECT id, repo_url, detected_port, custom_port, status, build_logs, public_url, created_at
        FROM deployments
        WHERE user_id = $1
        ORDER BY created_at DESC
        OFFSET $2 LIMIT $3
        "#,
    )
    .bind(me.id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(DeploymentOut {
            id: row.try_get("id")?,
            repo_url: row.try_get("repo_url")?,
            detected_port: row.try_get("detected_port")?,
            custom_port: row.try_get("custom_port")?,
            status: row.try_get("status")?,
            build_logs: row.try_get("build_logs")?,
            public_url: row.try_get("public_url")?,
            created_at: row.try_get("created_at")?,
        });
    }

    Ok(Json(out))
}

async fn get_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(deployment_id): Path<Uuid>,
) -> Result<Json<DeploymentOut>> {
    let me = current_user(&state, &headers).await?;

    let row = sqlx::query(
        r#"
        SELECT id, repo_url, detected_port, custom_port, status, build_logs, public_url, created_at
        FROM deployments
        WHERE id = $1 AND user_id = $2
        "#,
    )
    .bind(deployment_id)
    .bind(me.id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Deployment not found".to_string()))?;

    Ok(Json(DeploymentOut {
        id: row.try_get("id")?,
        repo_url: row.try_get("repo_url")?,
        detected_port: row.try_get("detected_port")?,
        custom_port: row.try_get("custom_port")?,
        status: row.try_get("status")?,
        build_logs: row.try_get("build_logs")?,
        public_url: row.try_get("public_url")?,
        created_at: row.try_get("created_at")?,
    }))
}

async fn cancel_deployment(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(deployment_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;

    let row = sqlx::query(
        "SELECT user_id, status, COALESCE(build_logs, '') as build_logs FROM deployments WHERE id = $1",
    )
    .bind(deployment_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Deployment not found".to_string()))?;

    let owner_id: Uuid = row.try_get("user_id")?;
    if owner_id != me.id {
        require_any_role(&me, &["admin", "professor"])?;
    }

    let status: String = row.try_get("status")?;
    if status == STATUS_CANCELLED || status == STATUS_FAILED {
        return Ok(Json(serde_json::json!({
            "id": deployment_id,
            "status": status,
            "cancelled": true
        })));
    }

    let mut logs: String = row.try_get("build_logs")?;
    if !logs.is_empty() {
        logs.push('\n');
    }
    logs.push_str("[system] Deployment cancelled by user request.");

    sqlx::query("UPDATE deployments SET status = $1, build_logs = $2 WHERE id = $3")
        .bind(STATUS_CANCELLED)
        .bind(logs)
        .bind(deployment_id)
        .execute(&state.db)
        .await?;

    let deployment_container_name = format!("deployment-{}", &deployment_id.to_string()[..8]);
    let _ = state
        .docker
        .stop_container(&deployment_container_name)
        .await;
    let _ = state
        .docker
        .remove_container(&deployment_container_name)
        .await;

    Ok(Json(serde_json::json!({
        "id": deployment_id,
        "status": STATUS_CANCELLED,
        "cancelled": true
    })))
}

async fn run_deployment_task(
    state: Arc<AppState>,
    deployment_id: Uuid,
    user_id: Uuid,
    user_container_name: String,
    repo_url: String,
    github_token: Option<String>,
    custom_port: Option<i32>,
) -> Result<()> {
    let mut logs = Vec::<String>::new();
    touch_container_activity(&state, user_id).await?;
    if deployment_cancelled(&state, deployment_id).await? {
        return Ok(());
    }

    update_deployment_status(&state, deployment_id, STATUS_CLONING, None, None, None).await?;

    let clone_url = if let Some(token) = github_token.as_ref() {
        if repo_url.contains("github.com") {
            repo_url.replace("https://", &format!("https://{}@", token))
        } else {
            repo_url.clone()
        }
    } else {
        repo_url.clone()
    };

    let clone_cmd = format!(
        "rm -rf /home/coder/workspace/app && git clone {} /home/coder/workspace/app && echo 'CLONE_SUCCESS'",
        clone_url
    );
    let clone_output = state
        .docker
        .exec_command(&user_container_name, &clone_cmd)
        .await
        .unwrap_or_else(|e| format!("clone error: {e}"));
    logs.push(format!(
        "Clone: {}",
        redact_token(&clone_output, &github_token)
    ));

    if !clone_output.contains("CLONE_SUCCESS") {
        force_fail_deployment(&state, deployment_id, logs.join("\n")).await?;
        return Ok(());
    }
    touch_container_activity(&state, user_id).await?;
    if deployment_cancelled(&state, deployment_id).await? {
        return Ok(());
    }

    update_deployment_status(
        &state,
        deployment_id,
        STATUS_DETECTING,
        Some(logs.join("\n")),
        None,
        None,
    )
    .await?;

    let dockerfile_output = state
        .docker
        .exec_command(
            &user_container_name,
            "cat /home/coder/workspace/app/Dockerfile 2>/dev/null || echo 'NO_DOCKERFILE'",
        )
        .await
        .unwrap_or_else(|e| format!("dockerfile read error: {e}"));

    if dockerfile_output.contains("NO_DOCKERFILE") {
        logs.push("No Dockerfile found in repo root".to_string());
        force_fail_deployment(&state, deployment_id, logs.join("\n")).await?;
        return Ok(());
    }
    touch_container_activity(&state, user_id).await?;
    if deployment_cancelled(&state, deployment_id).await? {
        return Ok(());
    }

    let detected_port = detect_port_from_dockerfile(&dockerfile_output);
    let final_port = custom_port.or(detected_port).unwrap_or(3000);

    update_deployment_status(
        &state,
        deployment_id,
        STATUS_BUILDING,
        Some(logs.join("\n")),
        detected_port,
        None,
    )
    .await?;

    let image_tag = format!("student-app-{}", &deployment_id.to_string()[..8]);

    let build_result = build_image_inner(
        &state,
        BuildRequest {
            user_id: user_id.to_string(),
            image_tag: image_tag.clone(),
            container_name: user_container_name,
        },
    )
    .await?;
    logs.push(format!("Build: {}", build_result.output));

    if !build_result.success || build_result.output.to_lowercase().contains("error") {
        force_fail_deployment(&state, deployment_id, logs.join("\n")).await?;
        return Ok(());
    }
    touch_container_activity(&state, user_id).await?;
    if deployment_cancelled(&state, deployment_id).await? {
        return Ok(());
    }

    update_deployment_status(
        &state,
        deployment_id,
        STATUS_STARTING,
        Some(logs.join("\n")),
        detected_port,
        None,
    )
    .await?;

    let container_name = format!("deployment-{}", &deployment_id.to_string()[..8]);
    let run_result = run_container_inner(
        &state,
        RunRequest {
            image_tag,
            container_name,
            port: final_port,
        },
    )
    .await?;
    logs.push(format!("Run: {}", run_result.output));

    if !run_result.success {
        force_fail_deployment(&state, deployment_id, logs.join("\n")).await?;
        return Ok(());
    }
    touch_container_activity(&state, user_id).await?;
    if deployment_cancelled(&state, deployment_id).await? {
        return Ok(());
    }

    let base_url = crate::config::public_base_url();
    let public_url = format!("{}/app/{}/proxy/{}/", base_url, user_id, final_port);

    update_deployment_status(
        &state,
        deployment_id,
        STATUS_RUNNING,
        Some(logs.join("\n")),
        detected_port,
        Some(public_url),
    )
    .await?;

    Ok(())
}

async fn touch_container_activity(state: &AppState, user_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE containers SET last_activity = NOW() WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await?;
    Ok(())
}

async fn deployment_cancelled(state: &AppState, deployment_id: Uuid) -> Result<bool> {
    let status = sqlx::query_scalar::<_, String>("SELECT status FROM deployments WHERE id = $1")
        .bind(deployment_id)
        .fetch_optional(&state.db)
        .await?;

    Ok(matches!(status.as_deref(), Some(STATUS_CANCELLED)))
}

async fn update_deployment_status(
    state: &AppState,
    deployment_id: Uuid,
    status: &str,
    logs: Option<String>,
    detected_port: Option<i32>,
    public_url: Option<String>,
) -> Result<()> {
    let current = sqlx::query("SELECT status FROM deployments WHERE id = $1")
        .bind(deployment_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| AppError::NotFound("Deployment not found".to_string()))?;
    let from_status: String = current.try_get("status")?;
    if from_status == STATUS_CANCELLED && status != STATUS_CANCELLED {
        return Ok(());
    }
    if !can_transition(&from_status, status) {
        return Err(AppError::Conflict(format!(
            "Invalid deployment status transition: {} -> {}",
            from_status, status
        )));
    }

    sqlx::query(
        r#"
        UPDATE deployments
        SET status = $1,
            build_logs = COALESCE($2, build_logs),
            detected_port = COALESCE($3, detected_port),
            public_url = COALESCE($4, public_url)
        WHERE id = $5
        "#,
    )
    .bind(status)
    .bind(logs)
    .bind(detected_port)
    .bind(public_url)
    .bind(deployment_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

async fn force_fail_deployment(state: &AppState, deployment_id: Uuid, logs: String) -> Result<()> {
    if deployment_cancelled(state, deployment_id).await? {
        return Ok(());
    }

    sqlx::query(
        r#"
        UPDATE deployments
        SET status = $1,
            build_logs = COALESCE($2, build_logs)
        WHERE id = $3
        "#,
    )
    .bind(STATUS_FAILED)
    .bind(logs)
    .bind(deployment_id)
    .execute(&state.db)
    .await?;
    Ok(())
}

fn can_transition(from: &str, to: &str) -> bool {
    if from == STATUS_CANCELLED {
        return to == STATUS_CANCELLED;
    }
    if to == STATUS_FAILED {
        return true;
    }

    matches!(
        (from, to),
        (STATUS_PENDING, STATUS_CLONING)
            | (STATUS_CLONING, STATUS_DETECTING)
            | (STATUS_DETECTING, STATUS_BUILDING)
            | (STATUS_BUILDING, STATUS_STARTING)
            | (STATUS_STARTING, STATUS_RUNNING)
            | (STATUS_PENDING, STATUS_CANCELLED)
            | (STATUS_CLONING, STATUS_CANCELLED)
            | (STATUS_DETECTING, STATUS_CANCELLED)
            | (STATUS_BUILDING, STATUS_CANCELLED)
            | (STATUS_STARTING, STATUS_CANCELLED)
            | (STATUS_RUNNING, STATUS_CANCELLED)
    )
}

fn validate_create_deployment_request(payload: &CreateDeploymentRequest) -> Result<()> {
    let repo_url = payload.repo_url.trim();
    if repo_url.is_empty() {
        return Err(AppError::BadRequest("repo_url is required".to_string()));
    }
    if !(repo_url.starts_with("https://") || repo_url.starts_with("http://")) {
        return Err(AppError::BadRequest(
            "repo_url must start with http:// or https://".to_string(),
        ));
    }

    if let Some(port) = payload.custom_port {
        if !(1..=65535).contains(&port) {
            return Err(AppError::BadRequest(
                "custom_port must be between 1 and 65535".to_string(),
            ));
        }
    }

    Ok(())
}

fn redact_token(text: &str, token: &Option<String>) -> String {
    if let Some(token) = token {
        if !token.is_empty() {
            return text.replace(token, "***");
        }
    }
    text.to_string()
}

fn detect_port_from_dockerfile(content: &str) -> Option<i32> {
    let re = Regex::new(r"(?i)EXPOSE\\s+(\\d+)").ok()?;
    let caps = re.captures(content)?;
    caps.get(1)?.as_str().parse::<i32>().ok()
}

async fn build_image(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<BuildRequest>,
) -> Result<Json<BuildResponse>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;
    Ok(Json(build_image_inner(&state, payload).await?))
}

async fn build_image_inner(state: &AppState, payload: BuildRequest) -> Result<BuildResponse> {
    if let Ok(user_id) = Uuid::parse_str(payload.user_id.trim()) {
        let _ = touch_container_activity(state, user_id).await;
    }

    info!(
        "Building image {} from container {} for user {}",
        payload.image_tag, payload.container_name, payload.user_id
    );

    let tmp_dir = format!("/tmp/build-{}", payload.user_id);

    let _ = tokio::process::Command::new("rm")
        .args(["-rf", &tmp_dir])
        .output()
        .await;

    tokio::process::Command::new("mkdir")
        .args(["-p", &tmp_dir])
        .output()
        .await
        .map_err(anyhow::Error::from)?;

    let copy_output = tokio::process::Command::new("docker")
        .args([
            "cp",
            &format!("{}:/home/coder/workspace/app/.", &payload.container_name),
            &tmp_dir,
        ])
        .output()
        .await
        .map_err(anyhow::Error::from)?;

    if !copy_output.status.success() {
        let _ = tokio::process::Command::new("rm")
            .args(["-rf", &tmp_dir])
            .output()
            .await;
        return Ok(BuildResponse {
            success: false,
            output: format!(
                "Failed to copy from container: {}",
                String::from_utf8_lossy(&copy_output.stderr)
            ),
        });
    }

    let tar_output = tokio::process::Command::new("tar")
        .args(["-czf", "-", "-C", &tmp_dir, "."])
        .output()
        .await
        .map_err(anyhow::Error::from)?;

    if !tar_output.status.success() {
        let _ = tokio::process::Command::new("rm")
            .args(["-rf", &tmp_dir])
            .output()
            .await;
        return Ok(BuildResponse {
            success: false,
            output: format!(
                "Failed to create build context: {}",
                String::from_utf8_lossy(&tar_output.stderr)
            ),
        });
    }

    let options = BuildImageOptions::<String> {
        t: payload.image_tag.clone(),
        rm: true,
        ..Default::default()
    };

    let mut build_stream =
        state
            .docker
            .client
            .build_image(options, None, Some(tar_output.stdout.into()));

    let mut output_lines = Vec::new();
    let mut success = true;

    while let Some(msg) = build_stream.next().await {
        match msg {
            Ok(info) => {
                if let Some(stream) = info.stream {
                    let line = stream.trim().to_string();
                    if !line.is_empty() {
                        output_lines.push(line);
                    }
                }
                if let Some(err) = info.error {
                    output_lines.push(format!("ERROR: {}", err));
                    success = false;
                }
            }
            Err(e) => {
                output_lines.push(format!("Build error: {}", e));
                success = false;
            }
        }
    }

    let _ = tokio::process::Command::new("rm")
        .args(["-rf", &tmp_dir])
        .output()
        .await;

    Ok(BuildResponse {
        success,
        output: output_lines.join("\n"),
    })
}

async fn run_container(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<RunRequest>,
) -> Result<Json<RunResponse>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;
    Ok(Json(run_container_inner(&state, payload).await?))
}

async fn run_container_inner(state: &AppState, payload: RunRequest) -> Result<RunResponse> {
    info!(
        "Running container {} from image {}",
        payload.container_name, payload.image_tag
    );

    let _ = state
        .docker
        .client
        .stop_container(&payload.container_name, Some(StopContainerOptions { t: 5 }))
        .await;
    let _ = state
        .docker
        .client
        .remove_container(
            &payload.container_name,
            Some(RemoveContainerOptions {
                force: true,
                ..Default::default()
            }),
        )
        .await;

    let port_key = format!("{}/tcp", payload.port);
    let host_port = payload.port.to_string();

    let mut port_bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
    port_bindings.insert(
        port_key.clone(),
        Some(vec![PortBinding {
            host_ip: Some("0.0.0.0".to_string()),
            host_port: Some(host_port),
        }]),
    );

    let mut exposed_ports: HashMap<&str, HashMap<(), ()>> = HashMap::new();
    exposed_ports.insert(port_key.as_str(), HashMap::new());

    let host_config = HostConfig {
        port_bindings: Some(port_bindings),
        network_mode: Some("dockcampus_default".to_string()),
        ..Default::default()
    };

    let config = Config {
        image: Some(payload.image_tag.as_str()),
        host_config: Some(host_config),
        exposed_ports: Some(exposed_ports),
        ..Default::default()
    };

    let container = state
        .docker
        .client
        .create_container(
            Some(CreateContainerOptions {
                name: payload.container_name.as_str(),
                platform: None,
            }),
            config,
        )
        .await
        .map_err(anyhow::Error::from)?;

    state
        .docker
        .client
        .start_container(&container.id, None::<StartContainerOptions<String>>)
        .await
        .map_err(anyhow::Error::from)?;

    Ok(RunResponse {
        success: true,
        output: format!("Container started: {}", container.id),
        container_id: Some(container.id),
    })
}
