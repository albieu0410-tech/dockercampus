use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, patch, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    auth::password,
    errors::{AppError, Result},
    middleware::auth::{current_user, require_any_role, require_role},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route(
            "/me",
            get(get_me).patch(update_profile).delete(delete_account),
        )
        .route("/me/change-password", post(change_password))
        .route("/", get(list_users))
        .route("/students", get(list_students))
        .route("/:user_id", patch(update_user))
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct UserOut {
    id: Uuid,
    email: String,
    full_name: String,
    role: String,
    is_active: bool,
    is_verified: bool,
    created_at: DateTime<Utc>,
}

#[utoipa::path(
    get,
    path = "/users/me",
    tag = "users",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Current authenticated user", body = UserOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn get_me(State(state): State<Arc<AppState>>, headers: HeaderMap) -> Result<Json<UserOut>> {
    let me = current_user(&state, &headers).await?;
    let row = sqlx::query(
        r#"
        SELECT id, email, full_name, role::text as role, is_active,
               COALESCE(is_verified, false) as is_verified, created_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(me.id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserOut {
        id: row.try_get("id")?,
        email: row.try_get("email")?,
        full_name: row.try_get("full_name")?,
        role: row.try_get("role")?,
        is_active: row.try_get("is_active")?,
        is_verified: row.try_get("is_verified")?,
        created_at: row.try_get("created_at")?,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdateProfileRequest {
    full_name: Option<String>,
}

#[utoipa::path(
    patch,
    path = "/users/me",
    tag = "users",
    request_body = UpdateProfileRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Updated user profile", body = UserOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn update_profile(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<UpdateProfileRequest>,
) -> Result<Json<UserOut>> {
    let me = current_user(&state, &headers).await?;

    if let Some(full_name) = payload.full_name {
        sqlx::query("UPDATE users SET full_name = $1 WHERE id = $2")
            .bind(full_name.trim())
            .bind(me.id)
            .execute(&state.db)
            .await?;
    }

    get_me(State(state), headers).await
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ChangePasswordRequest {
    current_password: String,
    new_password: String,
}

#[utoipa::path(
    post,
    path = "/users/me/change-password",
    tag = "users",
    request_body = ChangePasswordRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Password updated successfully"),
        (status = 400, description = "New password does not meet strength requirements", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing token or incorrect current password", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn change_password(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ChangePasswordRequest>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;

    let row = sqlx::query("SELECT hashed_password FROM users WHERE id = $1")
        .bind(me.id)
        .fetch_one(&state.db)
        .await?;
    let hashed_password: String = row.try_get("hashed_password")?;

    if !password::verify_password(&payload.current_password, &hashed_password)? {
        return Err(AppError::Unauthorized(
            "Current password is incorrect".to_string(),
        ));
    }

    validate_password_strength(&payload.new_password)?;
    let new_hash = password::hash_password(&payload.new_password)?;
    sqlx::query("UPDATE users SET hashed_password = $1 WHERE id = $2")
        .bind(new_hash)
        .bind(me.id)
        .execute(&state.db)
        .await?;

    Ok(Json(
        serde_json::json!({ "message": "Password updated successfully" }),
    ))
}

#[utoipa::path(
    delete,
    path = "/users/me",
    tag = "users",
    security(("bearerAuth" = [])),
    responses(
        (status = 204, description = "Account deleted"),
        (status = 400, description = "Admin accounts cannot be self-deleted", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn delete_account(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<StatusCode> {
    let me = current_user(&state, &headers).await?;
    if me.role == "admin" {
        return Err(AppError::BadRequest(
            "Admin accounts cannot be self-deleted".to_string(),
        ));
    }

    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(me.id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, IntoParams)]
pub(crate) struct Paging {
    page: Option<i64>,
    limit: Option<i64>,
}

#[utoipa::path(
    get,
    path = "/users",
    tag = "users",
    params(Paging),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Paginated list of users", body = [UserOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin or professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_users(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(paging): Query<Paging>,
) -> Result<Json<Vec<UserOut>>> {
    let me = current_user(&state, &headers).await?;
    require_any_role(&me, &["admin", "professor"])?;

    let page = paging.page.unwrap_or(1).max(1);
    let limit = paging.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = sqlx::query(
        r#"
        SELECT id, email, full_name, role::text as role, is_active,
               COALESCE(is_verified, false) as is_verified, created_at
        FROM users
        ORDER BY created_at DESC
        OFFSET $1
        LIMIT $2
        "#,
    )
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rows_to_users(rows)?))
}

#[derive(Debug, Deserialize, IntoParams)]
pub(crate) struct StudentsQuery {
    page: Option<i64>,
    limit: Option<i64>,
    class_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/users/students",
    tag = "users",
    params(StudentsQuery),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Paginated list of students", body = [UserOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<StudentsQuery>,
) -> Result<Json<Vec<UserOut>>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = if let Some(class_id) = query.class_id {
        let class_exists = sqlx::query("SELECT 1 FROM classes WHERE id = $1 AND professor_id = $2")
            .bind(class_id)
            .bind(me.id)
            .fetch_optional(&state.db)
            .await?;
        if class_exists.is_none() {
            return Err(AppError::NotFound("Class not found".to_string()));
        }

        sqlx::query(
            r#"
            SELECT u.id, u.email, u.full_name, u.role::text as role, u.is_active,
                   COALESCE(u.is_verified, false) as is_verified, u.created_at
            FROM users u
            JOIN class_memberships cm ON cm.user_id = u.id
            WHERE cm.class_id = $1
            ORDER BY u.created_at DESC
            OFFSET $2
            LIMIT $3
            "#,
        )
        .bind(class_id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT DISTINCT u.id, u.email, u.full_name, u.role::text as role, u.is_active,
                            COALESCE(u.is_verified, false) as is_verified, u.created_at
            FROM users u
            JOIN class_memberships cm ON cm.user_id = u.id
            JOIN classes c ON c.id = cm.class_id
            WHERE c.professor_id = $1
              AND u.role::text = 'student'
            ORDER BY u.created_at DESC
            OFFSET $2
            LIMIT $3
            "#,
        )
        .bind(me.id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    Ok(Json(rows_to_users(rows)?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct UpdateUserRequest {
    full_name: Option<String>,
    role: Option<String>,
    is_active: Option<bool>,
}

#[utoipa::path(
    patch,
    path = "/users/{user_id}",
    tag = "users",
    params(("user_id" = Uuid, Path, description = "User ID")),
    request_body = UpdateUserRequest,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Updated user", body = UserOut),
        (status = 400, description = "Invalid role", body = crate::errors::ErrorResponse),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires admin role", body = crate::errors::ErrorResponse),
        (status = 404, description = "User not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn update_user(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<UpdateUserRequest>,
) -> Result<Json<UserOut>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let target = sqlx::query("SELECT id FROM users WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    if target.is_none() {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    if let Some(full_name) = payload.full_name {
        sqlx::query("UPDATE users SET full_name = $1 WHERE id = $2")
            .bind(full_name.trim())
            .bind(user_id)
            .execute(&state.db)
            .await?;
    }

    if let Some(role) = payload.role {
        if role != "student" && role != "professor" && role != "admin" {
            return Err(AppError::BadRequest("Invalid role".to_string()));
        }
        sqlx::query("UPDATE users SET role = $1::user_role WHERE id = $2")
            .bind(role)
            .bind(user_id)
            .execute(&state.db)
            .await?;
    }

    if let Some(is_active) = payload.is_active {
        sqlx::query("UPDATE users SET is_active = $1 WHERE id = $2")
            .bind(is_active)
            .bind(user_id)
            .execute(&state.db)
            .await?;
    }

    let row = sqlx::query(
        r#"
        SELECT id, email, full_name, role::text as role, is_active,
               COALESCE(is_verified, false) as is_verified, created_at
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(UserOut {
        id: row.try_get("id")?,
        email: row.try_get("email")?,
        full_name: row.try_get("full_name")?,
        role: row.try_get("role")?,
        is_active: row.try_get("is_active")?,
        is_verified: row.try_get("is_verified")?,
        created_at: row.try_get("created_at")?,
    }))
}

fn rows_to_users(rows: Vec<sqlx::postgres::PgRow>) -> Result<Vec<UserOut>> {
    let mut users = Vec::with_capacity(rows.len());
    for row in rows {
        users.push(UserOut {
            id: row.try_get("id")?,
            email: row.try_get("email")?,
            full_name: row.try_get("full_name")?,
            role: row.try_get("role")?,
            is_active: row.try_get("is_active")?,
            is_verified: row.try_get("is_verified")?,
            created_at: row.try_get("created_at")?,
        });
    }
    Ok(users)
}

fn validate_password_strength(password: &str) -> Result<()> {
    let re =
        Regex::new(r#"^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};:'\",.<>?/\\|`~]).{8,}$"#)
            .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    if re.is_match(password) {
        Ok(())
    } else {
        Err(AppError::BadRequest(
            "Password must be at least 8 characters and include an uppercase letter, a number, and a special character.".to_string(),
        ))
    }
}
