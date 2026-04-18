use anyhow::Result;
use bollard::Docker;
use bollard::container::{
    CreateContainerOptions, Config, StartContainerOptions,
    StopContainerOptions, RemoveContainerOptions, Stats, StatsOptions,
};
use bollard::models::{
    HostConfig, Resources, PortBinding, RestartPolicy, RestartPolicyNameEnum,
};
use futures_util::StreamExt;
use std::collections::HashMap;
use tracing::info;
use crate::models::container::ContainerStats;
use crate::models::container::ContainerStatus;

pub struct DockerManager {
    pub client: Docker,
}

impl DockerManager {
    pub async fn new() -> Result<Self> {
        let client = Docker::connect_with_local_defaults()?;
        client.ping().await?;
        Ok(Self { client })
    }

    pub async fn create_container(
        &self,
        user_id: &str,
        port: i32,
        memory_limit_mb: i32,
        cpu_limit: f64,
    ) -> Result<String> {
        let container_name = format!("dockcampus-student-{}", user_id);
        let port_str = format!("{}/tcp", port);
        let host_port = port.to_string();

        let mut port_bindings: HashMap<String, Option<Vec<PortBinding>>> = HashMap::new();
        port_bindings.insert(
            port_str.clone(),
            Some(vec![PortBinding {
                host_ip: Some("0.0.0.0".to_string()),
                host_port: Some(host_port),
            }]),
        );

        let mut exposed_ports: HashMap<&str, HashMap<(), ()>> = HashMap::new();
        exposed_ports.insert(Box::leak(port_str.into_boxed_str()), HashMap::new());

        let memory_bytes = (memory_limit_mb as i64) * 1024 * 1024;
        let cpu_quota = (cpu_limit * 100_000.0) as i64;

        let host_config = HostConfig {
            port_bindings: Some(port_bindings),
            memory: Some(memory_bytes),
            cpu_period: Some(100_000),
            cpu_quota: Some(cpu_quota),
            restart_policy: Some(RestartPolicy {
                name: Some(RestartPolicyNameEnum::UNLESS_STOPPED),
                maximum_retry_count: None,
            }),
            binds: Some(vec![
                format!("dockcampus-workspace-{}:/home/coder/workspace", user_id)
            ]),
            ..Default::default()
        };

        let config = Config {
            image: Some("dockcampus-student"),
            env: Some(vec![
                Box::leak(format!("CODER_USER_ID={}", user_id).into_boxed_str()),
            ]),
            host_config: Some(host_config),
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: container_name.as_str(),
            platform: None,
        };

        let response = self.client
            .create_container(Some(options), config)
            .await?;

        info!("Created container {} for user {}", response.id, user_id);

        Ok(response.id)
    }

    pub async fn start_container(&self, container_id: &str) -> Result<()> {
        self.client
            .start_container(container_id, None::<StartContainerOptions<String>>)
            .await?;

        info!("Started container {}", container_id);
        Ok(())
    }

    pub async fn stop_container(&self, container_id: &str) -> Result<()> {
        self.client
            .stop_container(
                container_id,
                Some(StopContainerOptions { t: 10 }),
            )
            .await?;

        info!("Stopped container {}", container_id);
        Ok(())
    }

    pub async fn remove_container(&self, container_id: &str) -> Result<()> {
        self.client
            .remove_container(
                container_id,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await?;

        info!("Removed container {}", container_id);
        Ok(())
    }

    pub async fn get_container_stats(&self, container_id: &str) -> Result<ContainerStats> {
        let mut stream = self.client.stats(
            container_id,
            Some(StatsOptions { stream: false, one_shot: true }),
        );

        let stats = stream
            .next()
            .await
            .ok_or_else(|| anyhow::anyhow!("No stats returned"))??;

        let cpu_usage = calculate_cpu_percent(&stats);
        let memory_usage_mb = stats.memory_stats
            .usage
            .unwrap_or(0) as f64 / 1024.0 / 1024.0;
        let memory_limit_mb = stats.memory_stats
            .limit
            .unwrap_or(0) as f64 / 1024.0 / 1024.0;

        Ok(ContainerStats {
            container_id: container_id.to_string(),
            cpu_usage_percent: cpu_usage,
            memory_usage_mb,
            memory_limit_mb,
            status: ContainerStatus::Running,
        })
    }

    pub async fn get_system_stats(&self) -> Result<SystemStats> {
        let info = self.client.info().await?;
        let containers = self.client
            .list_containers::<String>(None)
            .await?;

        Ok(SystemStats {
            total_containers: containers.len() as i32,
            running_containers: containers
                .iter()
                .filter(|c| c.state.as_deref() == Some("running"))
                .count() as i32,
            docker_version: info.server_version.unwrap_or_default(),
        })
    }
}

fn calculate_cpu_percent(stats: &Stats) -> f64 {
    let cpu_delta = stats.cpu_stats.cpu_usage.total_usage as f64
        - stats.precpu_stats.cpu_usage.total_usage as f64;

    let system_delta = stats.cpu_stats.system_cpu_usage.unwrap_or(0) as f64
        - stats.precpu_stats.system_cpu_usage.unwrap_or(0) as f64;

    let num_cpus = stats.cpu_stats.online_cpus.unwrap_or(1) as f64;

    if system_delta > 0.0 {
        (cpu_delta / system_delta) * num_cpus * 100.0
    } else {
        0.0
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SystemStats {
    pub total_containers: i32,
    pub running_containers: i32,
    pub docker_version: String,
}