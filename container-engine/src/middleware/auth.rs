use axum::http::HeaderMap;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::jwt,
    errors::{AppError, Result},
    state::AppState,
};

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub is_active: bool,
    pub is_verified: bool,
}

pub async fn current_user(state: &AppState, headers: &HeaderMap) -> Result<AuthUser> {
    let token = bearer_token(headers)?;
    let claims = jwt::decode_token(token, &state.config.secret_key)
        .map_err(|_| AppError::Unauthorized("Invalid token".to_string()))?;
    let user_id = Uuid::parse_str(&claims.sub)
        .map_err(|_| AppError::Unauthorized("Invalid token subject".to_string()))?;

    let row = sqlx::query(
        r#"
        SELECT id, email, role::text as role, is_active, COALESCE(is_verified, false) as is_verified
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Unauthorized("User not found".to_string()))?;

    let is_active: bool = row.try_get("is_active")?;
    if !is_active {
        return Err(AppError::Unauthorized("Account is disabled".to_string()));
    }

    Ok(AuthUser {
        id: row.try_get("id")?,
        email: row.try_get("email")?,
        role: row.try_get("role")?,
        is_active,
        is_verified: row.try_get("is_verified")?,
    })
}

pub fn require_role(user: &AuthUser, role: &str) -> Result<()> {
    if user.role == role {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!("{role} only")))
    }
}

pub fn require_any_role(user: &AuthUser, roles: &[&str]) -> Result<()> {
    if roles.iter().any(|role| user.role == *role) {
        Ok(())
    } else {
        Err(AppError::Forbidden("Insufficient permissions".to_string()))
    }
}

fn bearer_token(headers: &HeaderMap) -> Result<&str> {
    let raw = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

    raw.strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
        .ok_or_else(|| AppError::Unauthorized("Invalid Authorization header".to_string()))
}
