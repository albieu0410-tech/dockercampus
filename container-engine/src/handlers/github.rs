use std::sync::Arc;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::Redirect,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::jwt,
    errors::{AppError, Result},
    middleware::auth::current_user,
    state::AppState,
};

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/login", get(github_login))
        .route("/callback", get(github_callback))
        .route("/status", get(github_status))
        .route("/repos", get(list_repos))
        .route("/tree", get(get_repo_tree))
        .route("/file", get(get_file_content))
}

#[derive(Debug, Deserialize)]
struct LoginQuery {
    token: String,
}

async fn github_login(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LoginQuery>,
) -> Result<Redirect> {
    let claims = jwt::decode_token(&query.token, &state.config.secret_key)
        .map_err(|_| AppError::Unauthorized("Invalid token".to_string()))?;

    let github_client_id = std::env::var("GITHUB_CLIENT_ID")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Missing GITHUB_CLIENT_ID")))?;
    let github_redirect_uri = std::env::var("GITHUB_REDIRECT_URI")
        .unwrap_or_else(|_| "https://api.sudelca.com/auth/github/callback".to_string());

    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=repo,read:user&state={}",
        github_client_id, github_redirect_uri, claims.sub
    );
    Ok(Redirect::temporary(&url))
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: String,
    state: String,
}

async fn github_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallbackQuery>,
) -> Result<Redirect> {
    let github_client_id = std::env::var("GITHUB_CLIENT_ID")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Missing GITHUB_CLIENT_ID")))?;
    let github_client_secret = std::env::var("GITHUB_CLIENT_SECRET")
        .map_err(|_| AppError::Internal(anyhow::anyhow!("Missing GITHUB_CLIENT_SECRET")))?;
    let github_redirect_uri = std::env::var("GITHUB_REDIRECT_URI")
        .unwrap_or_else(|_| "https://api.sudelca.com/auth/github/callback".to_string());
    let frontend_url = std::env::var("FRONTEND_URL")
        .unwrap_or_else(|_| "https://dockcampus.sudelca.com".to_string());

    let token_resp = state
        .http_client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": github_client_id,
            "client_secret": github_client_secret,
            "code": query.code,
            "redirect_uri": github_redirect_uri,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let token_data: serde_json::Value = token_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let access_token = token_data
        .get("access_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Failed to get GitHub access token".to_string()))?;

    let user_resp = state
        .http_client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "dockcampus")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    let github_user: serde_json::Value = user_resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let github_username = github_user
        .get("login")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::BadRequest("Failed to resolve GitHub username".to_string()))?;

    let user_id = Uuid::parse_str(&query.state)
        .map_err(|_| AppError::BadRequest("Invalid OAuth state".to_string()))?;

    let existing = sqlx::query("SELECT id FROM github_connections WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;

    if existing.is_some() {
        sqlx::query(
            "UPDATE github_connections SET github_access_token = $1, github_username = $2 WHERE user_id = $3",
        )
        .bind(access_token)
        .bind(github_username)
        .bind(user_id)
        .execute(&state.db)
        .await?;
    } else {
        sqlx::query(
            "INSERT INTO github_connections (user_id, github_username, github_access_token) VALUES ($1, $2, $3)",
        )
        .bind(user_id)
        .bind(github_username)
        .bind(access_token)
        .execute(&state.db)
        .await?;
    }

    Ok(Redirect::temporary(&format!(
        "{frontend_url}/dashboard?github=connected"
    )))
}

#[derive(Debug, Serialize)]
struct GithubConnectionOut {
    id: Uuid,
    github_username: String,
    created_at: chrono::DateTime<chrono::Utc>,
}

async fn github_status(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Option<GithubConnectionOut>>> {
    let me = current_user(&state, &headers).await?;
    let row = sqlx::query(
        "SELECT id, github_username, created_at FROM github_connections WHERE user_id = $1",
    )
    .bind(me.id)
    .fetch_optional(&state.db)
    .await?;

    let out = match row {
        Some(r) => Some(GithubConnectionOut {
            id: r.try_get("id")?,
            github_username: r.try_get("github_username")?,
            created_at: r.try_get("created_at")?,
        }),
        None => None,
    };

    Ok(Json(out))
}

#[derive(Debug, Serialize)]
struct RepoOut {
    name: String,
    full_name: String,
    url: String,
    private: bool,
    description: Option<String>,
    updated_at: String,
}

async fn list_repos(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<RepoOut>>> {
    let me = current_user(&state, &headers).await?;
    let token = github_token_for_user(&state, me.id).await?;

    let resp = state
        .http_client
        .get("https://api.github.com/user/repos?sort=updated&per_page=30")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .header("User-Agent", "dockcampus")
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    if !resp.status().is_success() {
        return Err(AppError::BadRequest(
            "Failed to fetch repositories".to_string(),
        ));
    }

    let repos: Vec<serde_json::Value> = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let out = repos
        .into_iter()
        .map(|r| RepoOut {
            name: r
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            full_name: r
                .get("full_name")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            url: r
                .get("clone_url")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            private: r.get("private").and_then(|v| v.as_bool()).unwrap_or(false),
            description: r
                .get("description")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
            updated_at: r
                .get("updated_at")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        })
        .collect();

    Ok(Json(out))
}

#[derive(Debug, Deserialize)]
struct TreeQuery {
    repo: String,
    #[serde(rename = "ref")]
    ref_: Option<String>,
}

#[derive(Debug, Serialize)]
struct TreeItem {
    path: String,
    r#type: String,
    size: Option<i64>,
}

async fn get_repo_tree(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<TreeQuery>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    let maybe_token = github_token_for_user_optional(&state, me.id).await?;
    let ref_name = query.ref_.unwrap_or_else(|| "HEAD".to_string());

    let url = format!(
        "https://api.github.com/repos/{}/git/trees/{}?recursive=1",
        query.repo, ref_name
    );
    let mut req = state
        .http_client
        .get(url)
        .header("Accept", "application/json")
        .header("User-Agent", "dockcampus");
    if let Some(token) = maybe_token {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(AppError::NotFound("Repo not found or private".to_string()));
    }
    if !resp.status().is_success() {
        return Err(AppError::BadRequest("GitHub error".to_string()));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    let tree = data
        .get("tree")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let path = item.get("path").and_then(|v| v.as_str())?.to_string();
            if path.starts_with(".git") {
                return None;
            }
            Some(TreeItem {
                path,
                r#type: item
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string(),
                size: item.get("size").and_then(|v| v.as_i64()),
            })
        })
        .collect::<Vec<_>>();

    Ok(Json(serde_json::json!({
        "tree": tree,
        "truncated": data.get("truncated").and_then(|v| v.as_bool()).unwrap_or(false),
    })))
}

#[derive(Debug, Deserialize)]
struct FileQuery {
    repo: String,
    path: String,
    #[serde(rename = "ref")]
    ref_: Option<String>,
}

async fn get_file_content(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<FileQuery>,
) -> Result<Json<serde_json::Value>> {
    let me = current_user(&state, &headers).await?;
    let maybe_token = github_token_for_user_optional(&state, me.id).await?;
    let ref_name = query.ref_.unwrap_or_else(|| "HEAD".to_string());

    let mut req = state
        .http_client
        .get(format!(
            "https://api.github.com/repos/{}/contents/{}",
            query.repo, query.path
        ))
        .query(&[("ref", ref_name)])
        .header("Accept", "application/vnd.github.raw")
        .header("User-Agent", "dockcampus");
    if let Some(token) = maybe_token {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    if !resp.status().is_success() {
        return Err(AppError::NotFound("File not found".to_string()));
    }

    let content = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
    Ok(Json(serde_json::json!({
        "content": content,
        "path": query.path
    })))
}

async fn github_token_for_user(state: &AppState, user_id: Uuid) -> Result<String> {
    github_token_for_user_optional(state, user_id)
        .await?
        .ok_or_else(|| AppError::NotFound("GitHub not connected".to_string()))
}

async fn github_token_for_user_optional(state: &AppState, user_id: Uuid) -> Result<Option<String>> {
    let row = sqlx::query("SELECT github_access_token FROM github_connections WHERE user_id = $1")
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?;
    Ok(row.and_then(|r| r.try_get::<String, _>("github_access_token").ok()))
}
