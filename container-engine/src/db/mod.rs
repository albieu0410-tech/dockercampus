use sqlx::PgPool;
use crate::errors::Result;

pub async fn get_available_port(pool: &PgPool) -> Result<i32> {
    let port = sqlx::query_scalar::<_, i32>(
        r#"
        UPDATE ports
        SET is_available = false
        WHERE port = (
            SELECT port FROM ports
            WHERE is_available = true
            ORDER BY port ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING port
        "#
    )
    .fetch_optional(pool)
    .await?
    .ok_or(crate::errors::AppError::NoAvailablePorts)?;

    Ok(port)
}

pub async fn release_port(pool: &PgPool, port: i32) -> Result<()> {
    sqlx::query(
        r#"
        UPDATE ports
        SET is_available = true, user_id = NULL
        WHERE port = $1
        "#
    )
    .bind(port)
    .execute(pool)
    .await?;

    Ok(())
}
