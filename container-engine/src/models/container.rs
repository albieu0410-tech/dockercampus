use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Type, Clone, PartialEq)]
#[sqlx(type_name = "container_status", rename_all = "lowercase")]
pub enum ContainerStatus {
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Container {
    pub id: Uuid,
    pub user_id: Uuid,
    pub docker_container_id: Option<String>,
    pub port: i32,
    pub status: ContainerStatus,
    pub cpu_limit: f64,
    pub memory_limit_mb: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateContainer {
    pub user_id: Uuid,
    pub port: i32,
    pub cpu_limit: Option<f64>,
    pub memory_limit_mb: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub docker_container_id: Option<String>,
    pub port: i32,
    pub status: ContainerStatus,
    pub cpu_limit: f64,
    pub memory_limit_mb: i32,
    pub editor_url: String,
    pub created_at: DateTime<Utc>,
}

impl ContainerResponse {
    pub fn from_container(container: Container, base_url: &str) -> Self {
        let editor_url = format!("{}/student/{}", base_url, container.user_id);
        Self {
            id: container.id,
            user_id: container.user_id,
            docker_container_id: container.docker_container_id,
            port: container.port,
            status: container.status,
            cpu_limit: container.cpu_limit,
            memory_limit_mb: container.memory_limit_mb,
            editor_url,
            created_at: container.created_at,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerStats {
    pub container_id: String,
    pub cpu_usage_percent: f64,
    pub memory_usage_mb: f64,
    pub memory_limit_mb: f64,
    pub status: ContainerStatus,
}
