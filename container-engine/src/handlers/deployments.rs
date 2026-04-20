use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use bollard::container::{Config, CreateContainerOptions, RemoveContainerOptions, StartContainerOptions, StopContainerOptions};
use bollard::image::BuildImageOptions;
use bollard::models::{HostConfig, PortBinding};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;

use crate::errors::Result;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct BuildRequest {
    pub user_id: String,
    pub image_tag: String,
    pub container_name: String,
}

#[derive(Serialize)]
pub struct BuildResponse {
    pub success: bool,
    pub output: String,
}

#[derive(Deserialize)]
pub struct RunRequest {
    pub image_tag: String,
    pub container_name: String,
    pub port: i32,
}

#[derive(Serialize)]
pub struct RunResponse {
    pub success: bool,
    pub output: String,
    pub container_id: Option<String>,
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/build", post(build_image))
        .route("/run", post(run_container))
}

async fn build_image(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<BuildRequest>,
) -> Result<Json<BuildResponse>> {
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
        return Ok(Json(BuildResponse {
            success: false,
            output: format!(
                "Failed to copy from container: {}",
                String::from_utf8_lossy(&copy_output.stderr)
            ),
        }));
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
        return Ok(Json(BuildResponse {
            success: false,
            output: format!(
                "Failed to create build context: {}",
                String::from_utf8_lossy(&tar_output.stderr)
            ),
        }));
    }

    let options = BuildImageOptions::<String> {
        t: payload.image_tag.clone(),
        rm: true,
        ..Default::default()
    };

    let mut build_stream = state
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

    Ok(Json(BuildResponse {
        success,
        output: output_lines.join("\n"),
    }))
}

async fn run_container(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RunRequest>,
) -> Result<Json<RunResponse>> {
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

    Ok(Json(RunResponse {
        success: true,
        output: format!("Container started: {}", container.id),
        container_id: Some(container.id),
    }))
}
