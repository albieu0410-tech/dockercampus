use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::Row;
use uuid::Uuid;

use crate::{errors::Result, state::AppState};

#[derive(Debug, Clone, Serialize)]
pub struct SleepConfig {
    pub enabled: bool,
    pub idle_sleep_minutes: i64,
    pub scan_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SleepCandidate {
    pub user_id: Uuid,
    pub docker_container_id: Option<String>,
    pub last_activity: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SleepReport {
    pub scanned: usize,
    pub slept: usize,
    pub failed: usize,
    pub skipped: usize,
    pub idle_minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SleepStatus {
    pub config: SleepConfig,
    pub running: i64,
    pub sleeping: i64,
    pub stopped: i64,
    pub idle_candidates: i64,
}

pub fn config_from_env() -> SleepConfig {
    SleepConfig {
        enabled: parse_bool_env("SLEEP_MANAGER_ENABLED", true),
        idle_sleep_minutes: std::env::var("IDLE_SLEEP_MINUTES")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .unwrap_or(10)
            .clamp(1, 60 * 24),
        scan_interval_seconds: std::env::var("SLEEP_SCAN_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(60)
            .clamp(5, 3600),
    }
}

pub async fn get_status(state: &AppState) -> Result<SleepStatus> {
    let cfg = config_from_env();

    let counts = sqlx::query(
        r#"
        SELECT
            COUNT(*) FILTER (WHERE status::text = 'running') as running,
            COUNT(*) FILTER (WHERE status::text = 'sleeping') as sleeping,
            COUNT(*) FILTER (WHERE status::text = 'stopped') as stopped
        FROM containers
        "#,
    )
    .fetch_one(&state.db)
    .await?;

    let candidates = sqlx::query_scalar::<_, i64>(
        r#"
        SELECT COUNT(*)
        FROM containers
        WHERE status::text = 'running'
          AND last_activity IS NOT NULL
          AND last_activity < NOW() - make_interval(mins => $1)
        "#,
    )
    .bind(cfg.idle_sleep_minutes as i32)
    .fetch_one(&state.db)
    .await?;

    Ok(SleepStatus {
        config: cfg,
        running: counts.try_get("running")?,
        sleeping: counts.try_get("sleeping")?,
        stopped: counts.try_get("stopped")?,
        idle_candidates: candidates,
    })
}

pub async fn list_idle_candidates(state: &AppState, limit: i64) -> Result<Vec<SleepCandidate>> {
    let cfg = config_from_env();

    let rows = sqlx::query(
        r#"
        SELECT user_id, docker_container_id, last_activity
        FROM containers
        WHERE status::text = 'running'
          AND last_activity IS NOT NULL
          AND last_activity < NOW() - make_interval(mins => $1)
        ORDER BY last_activity ASC
        LIMIT $2
        "#,
    )
    .bind(cfg.idle_sleep_minutes as i32)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    rows.into_iter()
        .map(|row| {
            let last_activity: DateTime<Utc> = row.try_get("last_activity")?;
            let user_id: Uuid = row.try_get("user_id")?;
            Ok(SleepCandidate {
                user_id,
                docker_container_id: row.try_get("docker_container_id")?,
                last_activity: last_activity.to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>>>()
}

pub async fn run_once(state: &AppState) -> Result<SleepReport> {
    let cfg = config_from_env();
    if !cfg.enabled {
        return Ok(SleepReport {
            scanned: 0,
            slept: 0,
            failed: 0,
            skipped: 0,
            idle_minutes: cfg.idle_sleep_minutes,
        });
    }

    let candidates = list_idle_candidates(state, 200).await?;

    let mut slept = 0usize;
    let mut failed = 0usize;
    let mut skipped = 0usize;

    for candidate in &candidates {
        let Some(container_id) = candidate.docker_container_id.as_deref() else {
            skipped += 1;
            continue;
        };

        match state.docker.stop_container(container_id).await {
            Ok(_) => {
                sqlx::query(
                    "UPDATE containers SET status = 'sleeping' WHERE user_id = $1 AND status::text = 'running'",
                )
                .bind(&candidate.user_id)
                .execute(&state.db)
                .await?;

                slept += 1;
            }
            Err(e) => {
                tracing::warn!(
                    user_id = %candidate.user_id,
                    container_id = %container_id,
                    error = %e,
                    "Sleep manager failed to stop container"
                );
                failed += 1;
            }
        }
    }

    Ok(SleepReport {
        scanned: candidates.len(),
        slept,
        failed,
        skipped,
        idle_minutes: cfg.idle_sleep_minutes,
    })
}

pub fn spawn_manager(state: std::sync::Arc<AppState>) {
    let cfg = config_from_env();
    if !cfg.enabled {
        tracing::info!("Sleep manager disabled by SLEEP_MANAGER_ENABLED=false");
        return;
    }

    tokio::spawn(async move {
        let mut ticker =
            tokio::time::interval(std::time::Duration::from_secs(cfg.scan_interval_seconds));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        tracing::info!(
            idle_minutes = cfg.idle_sleep_minutes,
            scan_interval_seconds = cfg.scan_interval_seconds,
            "Sleep manager started"
        );

        loop {
            ticker.tick().await;

            match run_once(&state).await {
                Ok(report) => {
                    if report.scanned > 0 || report.failed > 0 {
                        tracing::info!(
                            scanned = report.scanned,
                            slept = report.slept,
                            failed = report.failed,
                            skipped = report.skipped,
                            "Sleep manager run finished"
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(error = %e, "Sleep manager run failed");
                }
            }
        }
    });
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    match std::env::var(key) {
        Ok(v) => {
            let v = v.trim().to_lowercase();
            matches!(v.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => default,
    }
}
