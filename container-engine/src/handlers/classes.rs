use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    errors::{AppError, Result},
    middleware::auth::{current_user, require_role},
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/", post(create_class).get(list_classes))
        .route(
            "/:class_id",
            get(get_class).patch(update_class).delete(delete_class),
        )
        .route(
            "/:class_id/students",
            get(list_class_students).post(add_student_to_class),
        )
        .route(
            "/:class_id/students/:user_id",
            delete(remove_student_from_class),
        )
}

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ClassCreate {
    name: String,
    description: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ClassOut {
    id: Uuid,
    name: String,
    description: Option<String>,
    professor_id: Uuid,
    created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub(crate) struct Pagination {
    page: Option<i64>,
    limit: Option<i64>,
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

#[derive(Debug, Deserialize, ToSchema)]
pub(crate) struct ClassMembershipCreate {
    user_id: Uuid,
}

#[derive(Debug, Serialize, ToSchema)]
pub(crate) struct ClassMembershipOut {
    id: Uuid,
    class_id: Uuid,
    user_id: Uuid,
    joined_at: DateTime<Utc>,
}

#[utoipa::path(
    post,
    path = "/classes",
    tag = "classes",
    request_body = ClassCreate,
    security(("bearerAuth" = [])),
    responses(
        (status = 201, description = "Class created", body = ClassOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn create_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<ClassCreate>,
) -> Result<(StatusCode, Json<ClassOut>)> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let row = sqlx::query(
        r#"
        INSERT INTO classes (name, description, professor_id)
        VALUES ($1, $2, $3)
        RETURNING id, name, description, professor_id, created_at
        "#,
    )
    .bind(payload.name.trim())
    .bind(payload.description.as_deref())
    .bind(me.id)
    .fetch_one(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ClassOut {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            professor_id: row.try_get("professor_id")?,
            created_at: row.try_get("created_at")?,
        }),
    ))
}

#[utoipa::path(
    get,
    path = "/classes",
    tag = "classes",
    params(Pagination),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Paginated list of classes (professor's own classes, or enrolled classes for students)", body = [ClassOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_classes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(paging): Query<Pagination>,
) -> Result<Json<Vec<ClassOut>>> {
    let me = current_user(&state, &headers).await?;
    let page = paging.page.unwrap_or(1).max(1);
    let limit = paging.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = if me.role == "professor" || me.role == "admin" {
        sqlx::query(
            r#"
            SELECT id, name, description, professor_id, created_at
            FROM classes
            WHERE professor_id = $1
            ORDER BY created_at DESC
            OFFSET $2 LIMIT $3
            "#,
        )
        .bind(me.id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT c.id, c.name, c.description, c.professor_id, c.created_at
            FROM classes c
            JOIN class_memberships cm ON cm.class_id = c.id
            WHERE cm.user_id = $1
            ORDER BY c.created_at DESC
            OFFSET $2 LIMIT $3
            "#,
        )
        .bind(me.id)
        .bind(offset)
        .bind(limit)
        .fetch_all(&state.db)
        .await?
    };

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(ClassOut {
            id: row.try_get("id")?,
            name: row.try_get("name")?,
            description: row.try_get("description")?,
            professor_id: row.try_get("professor_id")?,
            created_at: row.try_get("created_at")?,
        });
    }
    Ok(Json(out))
}

#[utoipa::path(
    get,
    path = "/classes/{class_id}",
    tag = "classes",
    params(("class_id" = Uuid, Path, description = "Class ID")),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Class details", body = ClassOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Not your class", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn get_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<Uuid>,
) -> Result<Json<ClassOut>> {
    let me = current_user(&state, &headers).await?;
    let row = sqlx::query(
        "SELECT id, name, description, professor_id, created_at FROM classes WHERE id = $1",
    )
    .bind(class_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("Class not found".to_string()))?;

    let professor_id: Uuid = row.try_get("professor_id")?;
    if me.role == "professor" && professor_id != me.id {
        return Err(AppError::Forbidden("Not your class".to_string()));
    }

    Ok(Json(ClassOut {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        professor_id,
        created_at: row.try_get("created_at")?,
    }))
}

#[utoipa::path(
    patch,
    path = "/classes/{class_id}",
    tag = "classes",
    params(("class_id" = Uuid, Path, description = "Class ID")),
    request_body = ClassCreate,
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Updated class", body = ClassOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn update_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<Uuid>,
    Json(payload): Json<ClassCreate>,
) -> Result<Json<ClassOut>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let exists = sqlx::query("SELECT 1 FROM classes WHERE id = $1 AND professor_id = $2")
        .bind(class_id)
        .bind(me.id)
        .fetch_optional(&state.db)
        .await?;
    if exists.is_none() {
        return Err(AppError::NotFound("Class not found".to_string()));
    }

    let row = sqlx::query(
        r#"
        UPDATE classes
        SET name = $1, description = $2
        WHERE id = $3
        RETURNING id, name, description, professor_id, created_at
        "#,
    )
    .bind(payload.name.trim())
    .bind(payload.description.as_deref())
    .bind(class_id)
    .fetch_one(&state.db)
    .await?;

    Ok(Json(ClassOut {
        id: row.try_get("id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        professor_id: row.try_get("professor_id")?,
        created_at: row.try_get("created_at")?,
    }))
}

#[utoipa::path(
    delete,
    path = "/classes/{class_id}",
    tag = "classes",
    params(("class_id" = Uuid, Path, description = "Class ID")),
    security(("bearerAuth" = [])),
    responses(
        (status = 204, description = "Class deleted"),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn delete_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<Uuid>,
) -> Result<StatusCode> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let result = sqlx::query("DELETE FROM classes WHERE id = $1 AND professor_id = $2")
        .bind(class_id)
        .bind(me.id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Class not found".to_string()));
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/classes/{class_id}/students",
    tag = "classes",
    params(("class_id" = Uuid, Path, description = "Class ID"), Pagination),
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "Paginated list of students in the class", body = [UserOut]),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn list_class_students(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<Uuid>,
    Query(paging): Query<Pagination>,
) -> Result<Json<Vec<UserOut>>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let class_exists = sqlx::query("SELECT 1 FROM classes WHERE id = $1 AND professor_id = $2")
        .bind(class_id)
        .bind(me.id)
        .fetch_optional(&state.db)
        .await?;
    if class_exists.is_none() {
        return Err(AppError::NotFound("Class not found".to_string()));
    }

    let page = paging.page.unwrap_or(1).max(1);
    let limit = paging.limit.unwrap_or(20).clamp(1, 100);
    let offset = (page - 1) * limit;

    let rows = sqlx::query(
        r#"
        SELECT u.id, u.email, u.full_name, u.role::text as role, u.is_active,
               COALESCE(u.is_verified, false) as is_verified, u.created_at
        FROM users u
        JOIN class_memberships cm ON cm.user_id = u.id
        WHERE cm.class_id = $1
        ORDER BY u.created_at DESC
        OFFSET $2 LIMIT $3
        "#,
    )
    .bind(class_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(UserOut {
            id: row.try_get("id")?,
            email: row.try_get("email")?,
            full_name: row.try_get("full_name")?,
            role: row.try_get("role")?,
            is_active: row.try_get("is_active")?,
            is_verified: row.try_get("is_verified")?,
            created_at: row.try_get("created_at")?,
        });
    }
    Ok(Json(out))
}

#[utoipa::path(
    post,
    path = "/classes/{class_id}/students",
    tag = "classes",
    params(("class_id" = Uuid, Path, description = "Class ID")),
    request_body = ClassMembershipCreate,
    security(("bearerAuth" = [])),
    responses(
        (status = 201, description = "Student added to class", body = ClassMembershipOut),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class or user not found", body = crate::errors::ErrorResponse),
        (status = 409, description = "User already in this class", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn add_student_to_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path(class_id): Path<Uuid>,
    Json(payload): Json<ClassMembershipCreate>,
) -> Result<(StatusCode, Json<ClassMembershipOut>)> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let class_exists = sqlx::query("SELECT 1 FROM classes WHERE id = $1 AND professor_id = $2")
        .bind(class_id)
        .bind(me.id)
        .fetch_optional(&state.db)
        .await?;
    if class_exists.is_none() {
        return Err(AppError::NotFound("Class not found".to_string()));
    }

    let user_exists = sqlx::query("SELECT 1 FROM users WHERE id = $1")
        .bind(payload.user_id)
        .fetch_optional(&state.db)
        .await?;
    if user_exists.is_none() {
        return Err(AppError::NotFound("User not found".to_string()));
    }

    let existing =
        sqlx::query("SELECT 1 FROM class_memberships WHERE class_id = $1 AND user_id = $2")
            .bind(class_id)
            .bind(payload.user_id)
            .fetch_optional(&state.db)
            .await?;
    if existing.is_some() {
        return Err(AppError::Conflict("User already in this class".to_string()));
    }

    let row = sqlx::query(
        r#"
        INSERT INTO class_memberships (class_id, user_id)
        VALUES ($1, $2)
        RETURNING id, class_id, user_id, joined_at
        "#,
    )
    .bind(class_id)
    .bind(payload.user_id)
    .fetch_one(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(ClassMembershipOut {
            id: row.try_get("id")?,
            class_id: row.try_get("class_id")?,
            user_id: row.try_get("user_id")?,
            joined_at: row.try_get("joined_at")?,
        }),
    ))
}

#[utoipa::path(
    delete,
    path = "/classes/{class_id}/students/{user_id}",
    tag = "classes",
    params(
        ("class_id" = Uuid, Path, description = "Class ID"),
        ("user_id" = Uuid, Path, description = "Student user ID")
    ),
    security(("bearerAuth" = [])),
    responses(
        (status = 204, description = "Student removed from class"),
        (status = 401, description = "Missing or invalid token", body = crate::errors::ErrorResponse),
        (status = 403, description = "Requires professor role", body = crate::errors::ErrorResponse),
        (status = 404, description = "Class not found or student not in this class", body = crate::errors::ErrorResponse)
    )
)]
pub(crate) async fn remove_student_from_class(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Path((class_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "professor")?;

    let class_exists = sqlx::query("SELECT 1 FROM classes WHERE id = $1 AND professor_id = $2")
        .bind(class_id)
        .bind(me.id)
        .fetch_optional(&state.db)
        .await?;
    if class_exists.is_none() {
        return Err(AppError::NotFound("Class not found".to_string()));
    }

    let result = sqlx::query("DELETE FROM class_memberships WHERE class_id = $1 AND user_id = $2")
        .bind(class_id)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Student not in this class".to_string()));
    }

    Ok(StatusCode::NO_CONTENT)
}
