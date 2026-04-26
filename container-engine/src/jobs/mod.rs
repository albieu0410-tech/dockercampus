use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::errors::Result;

pub const JOB_PENDING: &str = "pending";
pub const JOB_RUNNING: &str = "running";
pub const JOB_DONE: &str = "done";
pub const JOB_FAILED: &str = "failed";
pub const JOB_CANCELLED: &str = "cancelled";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRecord {
    pub id: Uuid,
    pub job_type: String,
    pub payload: serde_json::Value,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,
    pub retries: i32,
    pub max_retries: i32,
}

pub async fn list_jobs(
    db: &sqlx::PgPool,
    limit: i64,
    status: Option<&str>,
) -> Result<Vec<JobRecord>> {
    let rows = if let Some(status) = status {
        sqlx::query(
            r#"
            SELECT id, type, payload, status, created_at, started_at, completed_at, error, retries, max_retries
            FROM jobs
            WHERE status = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(status)
        .bind(limit)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT id, type, payload, status, created_at, started_at, completed_at, error, retries, max_retries
            FROM jobs
            ORDER BY created_at DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(db)
        .await?
    };

    rows.into_iter()
        .map(job_from_row)
        .collect::<Result<Vec<_>>>()
}

pub async fn enqueue_job(
    db: &sqlx::PgPool,
    job_type: &str,
    payload: &serde_json::Value,
    max_retries: i32,
) -> Result<JobRecord> {
    let row = sqlx::query(
        r#"
        INSERT INTO jobs (type, payload, status, max_retries)
        VALUES ($1, $2, $3, $4)
        RETURNING id, type, payload, status, created_at, started_at, completed_at, error, retries, max_retries
        "#,
    )
    .bind(job_type)
    .bind(payload)
    .bind(JOB_PENDING)
    .bind(max_retries)
    .fetch_one(db)
    .await?;

    job_from_row(row)
}

pub async fn retry_job(db: &sqlx::PgPool, id: Uuid) -> Result<Option<JobRecord>> {
    let row = sqlx::query(
        r#"
        UPDATE jobs
        SET status = $1,
            started_at = NULL,
            completed_at = NULL,
            error = NULL,
            retries = retries + 1
        WHERE id = $2
          AND retries < max_retries
        RETURNING id, type, payload, status, created_at, started_at, completed_at, error, retries, max_retries
        "#,
    )
    .bind(JOB_PENDING)
    .bind(id)
    .fetch_optional(db)
    .await?;

    row.map(job_from_row).transpose()
}

pub async fn cancel_job(db: &sqlx::PgPool, id: Uuid) -> Result<Option<JobRecord>> {
    let row = sqlx::query(
        r#"
        UPDATE jobs
        SET status = $1,
            completed_at = NOW()
        WHERE id = $2
          AND status IN ($3, $4)
        RETURNING id, type, payload, status, created_at, started_at, completed_at, error, retries, max_retries
        "#,
    )
    .bind(JOB_CANCELLED)
    .bind(id)
    .bind(JOB_PENDING)
    .bind(JOB_RUNNING)
    .fetch_optional(db)
    .await?;

    row.map(job_from_row).transpose()
}

fn job_from_row(row: sqlx::postgres::PgRow) -> Result<JobRecord> {
    Ok(JobRecord {
        id: row.try_get("id")?,
        job_type: row.try_get("type")?,
        payload: row.try_get("payload")?,
        status: row.try_get("status")?,
        created_at: row.try_get("created_at")?,
        started_at: row.try_get("started_at")?,
        completed_at: row.try_get("completed_at")?,
        error: row.try_get("error")?,
        retries: row.try_get("retries")?,
        max_retries: row.try_get("max_retries")?,
    })
}
