use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Duration, Utc};
use rand::{distributions::Alphanumeric, Rng};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::{
    auth::{jwt, otp, password},
    errors::{AppError, Result},
    middleware::auth::{current_user, require_role},
    state::AppState,
};

const MAX_OTP_ATTEMPTS: i32 = 5;
const MAX_LOGIN_ATTEMPTS: i32 = 5;
const LOCKOUT_MINUTES: i64 = 15;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/verify-otp", post(verify_otp))
        .route("/forgot-password", post(forgot_password))
        .route("/reset-password", post(reset_password))
        .route(
            "/invite-codes",
            post(create_invite_code).get(list_invite_codes),
        )
        .route("/health", get(health))
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "ok": true }))
}

#[derive(Debug, Deserialize)]
struct RegisterRequest {
    email: String,
    password: String,
    full_name: String,
    invite_code: String,
}

#[derive(Debug, Serialize)]
struct UserOut {
    id: Uuid,
    email: String,
    full_name: String,
    role: String,
    is_active: bool,
    is_verified: bool,
    created_at: DateTime<Utc>,
}

async fn register(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<UserOut>)> {
    validate_email_domain(&payload.email)?;
    validate_password_strength(&payload.password)?;

    let invite = sqlx::query(
        r#"
        SELECT id, role, expires_at
        FROM invite_codes
        WHERE code = $1 AND is_used = false
        "#,
    )
    .bind(payload.invite_code.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::BadRequest("Invalid or already-used invite code".to_string()))?;

    let invite_id: Uuid = invite.try_get("id")?;
    let invite_role: String = invite.try_get("role")?;
    let invite_expires: Option<DateTime<Utc>> = invite.try_get("expires_at")?;
    if let Some(exp) = invite_expires {
        if exp < Utc::now() {
            return Err(AppError::BadRequest("Invite code has expired".to_string()));
        }
    }

    let exists = sqlx::query("SELECT 1 FROM users WHERE email = $1")
        .bind(payload.email.trim().to_lowercase())
        .fetch_optional(&state.db)
        .await?;
    if exists.is_some() {
        return Err(AppError::Conflict("Email already registered".to_string()));
    }

    if invite_role != "student" && invite_role != "professor" {
        return Err(AppError::BadRequest(
            "Invite code role is invalid".to_string(),
        ));
    }

    let hashed = password::hash_password(&payload.password)?;

    let user = sqlx::query(
        r#"
        INSERT INTO users (email, hashed_password, full_name, role, is_verified)
        VALUES ($1, $2, $3, $4::user_role, false)
        RETURNING id, email, full_name, role::text as role, is_active,
                  COALESCE(is_verified, false) as is_verified,
                  created_at
        "#,
    )
    .bind(payload.email.trim().to_lowercase())
    .bind(hashed)
    .bind(payload.full_name.trim())
    .bind(invite_role)
    .fetch_one(&state.db)
    .await?;

    let user_id: Uuid = user.try_get("id")?;

    sqlx::query("UPDATE invite_codes SET is_used = true, used_by = $1 WHERE id = $2")
        .bind(user_id)
        .bind(invite_id)
        .execute(&state.db)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(UserOut {
            id: user_id,
            email: user.try_get("email")?,
            full_name: user.try_get("full_name")?,
            role: user.try_get("role")?,
            is_active: user.try_get("is_active")?,
            is_verified: user.try_get("is_verified")?,
            created_at: user.try_get("created_at")?,
        }),
    ))
}

#[derive(Debug, Deserialize)]
struct LoginRequest {
    email: String,
    password: String,
}

#[derive(Debug, Serialize)]
struct LoginResponse {
    access_token: Option<String>,
    otp_session_id: Option<Uuid>,
    message: Option<String>,
}

async fn login(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<LoginResponse>> {
    let user = sqlx::query(
        r#"
        SELECT id, email, hashed_password, role::text as role, is_active,
               COALESCE(is_verified, false) as is_verified,
               COALESCE(failed_login_attempts, 0) as failed_login_attempts,
               locked_until
        FROM users
        WHERE email = $1
        "#,
    )
    .bind(payload.email.trim().to_lowercase())
    .fetch_optional(&state.db)
    .await?;

    let Some(user) = user else {
        return Err(AppError::Unauthorized("Invalid credentials".to_string()));
    };

    let user_id: Uuid = user.try_get("id")?;
    let hashed_password: String = user.try_get("hashed_password")?;
    let locked_until: Option<DateTime<Utc>> = user.try_get("locked_until")?;

    if let Some(until) = locked_until {
        if until > Utc::now() {
            let remaining_minutes = (until - Utc::now()).num_minutes().max(1);
            return Err(AppError::TooManyRequests(format!(
                "Account locked. Try again in {remaining_minutes} minute(s)."
            )));
        }

        sqlx::query(
            "UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = $1",
        )
        .bind(user_id)
        .execute(&state.db)
        .await?;
    }

    if !password::verify_password(&payload.password, &hashed_password)? {
        let attempts_row = sqlx::query(
            "UPDATE users SET failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1 WHERE id = $1 RETURNING failed_login_attempts",
        )
        .bind(user_id)
        .fetch_one(&state.db)
        .await?;

        let attempts: i32 = attempts_row.try_get("failed_login_attempts")?;
        if attempts >= MAX_LOGIN_ATTEMPTS {
            sqlx::query("UPDATE users SET locked_until = $1 WHERE id = $2")
                .bind(Utc::now() + Duration::minutes(LOCKOUT_MINUTES))
                .bind(user_id)
                .execute(&state.db)
                .await?;
        }

        return Err(AppError::Unauthorized("Invalid credentials".to_string()));
    }

    let is_active: bool = user.try_get("is_active")?;
    if !is_active {
        return Err(AppError::Forbidden("Account is disabled".to_string()));
    }

    sqlx::query("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let is_verified: bool = user.try_get("is_verified")?;
    let email: String = user.try_get("email")?;
    let role: String = user.try_get("role")?;

    if is_verified || !two_factor_auth_required() {
        let token = jwt::create_token(
            &user_id.to_string(),
            &email,
            &role,
            &state.config.secret_key,
            state.config.jwt_exp_minutes,
        )?;
        return Ok(Json(LoginResponse {
            access_token: Some(token),
            otp_session_id: None,
            message: None,
        }));
    }

    let otp_code = otp::generate_otp();
    send_otp_email(&state, &email, &otp_code).await?;

    sqlx::query("DELETE FROM otp_sessions WHERE user_id = $1")
        .bind(user_id)
        .execute(&state.db)
        .await?;

    let session = sqlx::query(
        r#"
        INSERT INTO otp_sessions (user_id, otp_code, expires_at)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(otp_code)
    .bind(otp::default_expires_at())
    .fetch_one(&state.db)
    .await?;

    let session_id: Uuid = session.try_get("id")?;

    Ok(Json(LoginResponse {
        access_token: None,
        otp_session_id: Some(session_id),
        message: Some("Check your email for a 6-digit code.".to_string()),
    }))
}

fn two_factor_auth_required() -> bool {
    let environment = std::env::var("ENVIRONMENT").unwrap_or_default();
    let enabled = std::env::var("AUTH_2FA_ENABLED").ok();

    two_factor_auth_required_for(&environment, enabled.as_deref())
}

fn two_factor_auth_required_for(environment: &str, enabled: Option<&str>) -> bool {
    let environment = environment.trim().to_ascii_lowercase();
    let is_local = matches!(
        environment.as_str(),
        "local" | "development" | "dev" | "test"
    );

    if !is_local {
        return true;
    }

    enabled
        .map(|value| {
            !matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "false" | "0" | "no" | "off"
            )
        })
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::two_factor_auth_required_for;

    #[test]
    fn two_factor_auth_can_be_disabled_locally() {
        assert!(!two_factor_auth_required_for("development", Some("false")));
        assert!(!two_factor_auth_required_for("local", Some("off")));
    }

    #[test]
    fn two_factor_auth_defaults_to_enabled() {
        assert!(two_factor_auth_required_for("development", None));
        assert!(two_factor_auth_required_for("development", Some("true")));
    }

    #[test]
    fn two_factor_auth_cannot_be_disabled_in_production() {
        assert!(two_factor_auth_required_for("production", Some("false")));
        assert!(two_factor_auth_required_for("", Some("false")));
    }
}

#[derive(Debug, Deserialize)]
struct VerifyOtpRequest {
    otp_session_id: Uuid,
    otp_code: String,
}

#[derive(Debug, Serialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
}

async fn verify_otp(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<VerifyOtpRequest>,
) -> Result<Json<TokenResponse>> {
    let session = sqlx::query(
        "SELECT user_id, otp_code, attempts, expires_at FROM otp_sessions WHERE id = $1",
    )
    .bind(payload.otp_session_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("OTP session not found".to_string()))?;

    let user_id: Uuid = session.try_get("user_id")?;
    let otp_code: String = session.try_get("otp_code")?;
    let attempts: i32 = session.try_get("attempts")?;
    let expires_at: DateTime<Utc> = session.try_get("expires_at")?;

    if expires_at < Utc::now() {
        sqlx::query("DELETE FROM otp_sessions WHERE id = $1")
            .bind(payload.otp_session_id)
            .execute(&state.db)
            .await?;
        return Err(AppError::BadRequest(
            "OTP expired. Please log in again.".to_string(),
        ));
    }

    if attempts >= MAX_OTP_ATTEMPTS {
        sqlx::query("DELETE FROM otp_sessions WHERE id = $1")
            .bind(payload.otp_session_id)
            .execute(&state.db)
            .await?;
        return Err(AppError::TooManyRequests(
            "Too many attempts. Please log in again.".to_string(),
        ));
    }

    if payload.otp_code.trim() != otp_code {
        sqlx::query("UPDATE otp_sessions SET attempts = attempts + 1 WHERE id = $1")
            .bind(payload.otp_session_id)
            .execute(&state.db)
            .await?;
        let remaining = MAX_OTP_ATTEMPTS - attempts - 1;
        return Err(AppError::Unauthorized(format!(
            "Invalid code. {remaining} attempt(s) remaining."
        )));
    }

    let user = sqlx::query(
        "SELECT email, role::text as role, COALESCE(is_verified, false) as is_verified FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::NotFound("User not found".to_string()))?;

    let email: String = user.try_get("email")?;
    let role: String = user.try_get("role")?;
    let is_verified: bool = user.try_get("is_verified")?;

    if !is_verified {
        sqlx::query("UPDATE users SET is_verified = true WHERE id = $1")
            .bind(user_id)
            .execute(&state.db)
            .await?;
    }

    sqlx::query("DELETE FROM otp_sessions WHERE id = $1")
        .bind(payload.otp_session_id)
        .execute(&state.db)
        .await?;

    let token = jwt::create_token(
        &user_id.to_string(),
        &email,
        &role,
        &state.config.secret_key,
        state.config.jwt_exp_minutes,
    )?;

    Ok(Json(TokenResponse {
        access_token: token,
        token_type: "bearer".to_string(),
    }))
}

#[derive(Debug, Deserialize)]
struct ForgotPasswordRequest {
    email: String,
}

async fn forgot_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ForgotPasswordRequest>,
) -> Result<Json<serde_json::Value>> {
    let user = sqlx::query("SELECT id, is_active FROM users WHERE email = $1")
        .bind(payload.email.trim().to_lowercase())
        .fetch_optional(&state.db)
        .await?;

    if let Some(user) = user {
        let user_id: Uuid = user.try_get("id")?;
        let is_active: bool = user.try_get("is_active")?;
        if is_active {
            let token = generate_urlsafe_token(48);
            let expires_at = Utc::now() + Duration::hours(1);

            sqlx::query(
                "UPDATE users SET password_reset_token = $1, password_reset_expires = $2 WHERE id = $3",
            )
            .bind(&token)
            .bind(expires_at)
            .bind(user_id)
            .execute(&state.db)
            .await?;

            let frontend_url = std::env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "https://dockcampus.sudelca.com".to_string());
            let reset_link = format!("{frontend_url}/reset-password?token={token}");

            let _ = send_password_reset_email(&state, payload.email.trim(), &reset_link).await;
        }
    }

    Ok(Json(serde_json::json!({
        "message": "If that email exists, a reset link has been sent."
    })))
}

#[derive(Debug, Deserialize)]
struct ResetPasswordRequest {
    token: String,
    new_password: String,
}

async fn reset_password(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ResetPasswordRequest>,
) -> Result<Json<serde_json::Value>> {
    validate_password_strength(&payload.new_password)?;

    let user =
        sqlx::query("SELECT id, password_reset_expires FROM users WHERE password_reset_token = $1")
            .bind(payload.token.trim())
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| AppError::BadRequest("Invalid or expired reset token".to_string()))?;

    let user_id: Uuid = user.try_get("id")?;
    let expires_at: Option<DateTime<Utc>> = user.try_get("password_reset_expires")?;

    let Some(expires_at) = expires_at else {
        return Err(AppError::BadRequest(
            "Invalid or expired reset token".to_string(),
        ));
    };

    if expires_at < Utc::now() {
        sqlx::query(
            "UPDATE users SET password_reset_token = NULL, password_reset_expires = NULL WHERE id = $1",
        )
        .bind(user_id)
        .execute(&state.db)
        .await?;

        return Err(AppError::BadRequest(
            "Reset token has expired. Please request a new one.".to_string(),
        ));
    }

    let hashed = password::hash_password(&payload.new_password)?;
    sqlx::query(
        r#"
        UPDATE users
        SET hashed_password = $1,
            password_reset_token = NULL,
            password_reset_expires = NULL,
            failed_login_attempts = 0,
            locked_until = NULL
        WHERE id = $2
        "#,
    )
    .bind(hashed)
    .bind(user_id)
    .execute(&state.db)
    .await?;

    Ok(Json(
        serde_json::json!({ "message": "Password updated successfully" }),
    ))
}

#[derive(Debug, Deserialize)]
struct InviteCodeCreate {
    role: Option<String>,
    expires_at: Option<DateTime<Utc>>,
    class_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
struct InviteCodeOut {
    id: Uuid,
    code: String,
    role: String,
    is_used: bool,
    expires_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    class_id: Option<Uuid>,
}

async fn create_invite_code(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<InviteCodeCreate>,
) -> Result<(StatusCode, Json<InviteCodeOut>)> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let role = payload.role.unwrap_or_else(|| "student".to_string());
    if role != "student" && role != "professor" {
        return Err(AppError::BadRequest(
            "invite role must be 'student' or 'professor'".to_string(),
        ));
    }

    let code = generate_urlsafe_token(24);
    let row = sqlx::query(
        r#"
        INSERT INTO invite_codes (code, role, expires_at, class_id)
        VALUES ($1, $2, $3, $4)
        RETURNING id, code, role, is_used, expires_at, created_at, class_id
        "#,
    )
    .bind(code)
    .bind(role)
    .bind(payload.expires_at)
    .bind(payload.class_id)
    .fetch_one(&state.db)
    .await?;

    Ok((
        StatusCode::CREATED,
        Json(InviteCodeOut {
            id: row.try_get("id")?,
            code: row.try_get("code")?,
            role: row.try_get("role")?,
            is_used: row.try_get("is_used")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
            class_id: row.try_get("class_id")?,
        }),
    ))
}

async fn list_invite_codes(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<Vec<InviteCodeOut>>> {
    let me = current_user(&state, &headers).await?;
    require_role(&me, "admin")?;

    let rows = sqlx::query(
        "SELECT id, code, role, is_used, expires_at, created_at, class_id FROM invite_codes ORDER BY created_at DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(InviteCodeOut {
            id: row.try_get("id")?,
            code: row.try_get("code")?,
            role: row.try_get("role")?,
            is_used: row.try_get("is_used")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
            class_id: row.try_get("class_id")?,
        });
    }

    Ok(Json(out))
}

fn validate_email_domain(email: &str) -> Result<()> {
    let allowed = std::env::var("ALLOWED_EMAIL_DOMAINS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_lowercase())
        .collect::<Vec<_>>();

    if allowed.is_empty() {
        return Ok(());
    }

    let domain = email
        .split('@')
        .nth(1)
        .unwrap_or_default()
        .trim()
        .to_lowercase();

    if allowed.iter().any(|d| d == &domain) {
        return Ok(());
    }

    Err(AppError::BadRequest(format!(
        "Email domain not allowed. Allowed: {}",
        allowed.join(", ")
    )))
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

fn generate_urlsafe_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

async fn send_otp_email(state: &AppState, email: &str, otp_code: &str) -> Result<()> {
    let key = state
        .config
        .resend_api_key
        .as_ref()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("Missing RESEND_API_KEY")))?;

    let html = format!(
        r#"<div style=\"font-family: monospace; max-width: 400px; margin: 0 auto; padding: 40px;\">
            <h2 style=\"color: #f97316;\">DockCampus</h2>
            <p>Your login code is:</p>
            <div style=\"font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #f97316; padding: 20px; background: #18181b; border-radius: 8px; text-align: center;\">{otp_code}</div>
            <p style=\"color: #71717a; font-size: 12px; margin-top: 20px;\">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>"#,
    );

    send_resend_email(state, key, email, "Your DockCampus login code", &html).await
}

async fn send_password_reset_email(state: &AppState, email: &str, reset_link: &str) -> Result<()> {
    let Some(key) = state.config.resend_api_key.as_ref() else {
        return Ok(());
    };

    let html = format!(
        r#"<div style=\"font-family: monospace; max-width: 400px; margin: 0 auto; padding: 40px;\">
            <h2 style=\"color: #f97316;\">DockCampus</h2>
            <p>Click the link below to reset your password:</p>
            <a href=\"{reset_link}\" style=\"display: inline-block; margin: 20px 0; padding: 12px 24px; background: #f97316; color: white; text-decoration: none; border-radius: 6px;\">Reset Password</a>
            <p style=\"color: #71717a; font-size: 12px;\">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>"#,
    );

    send_resend_email(state, key, email, "Reset your DockCampus password", &html).await
}

async fn send_resend_email(
    state: &AppState,
    api_key: &str,
    email: &str,
    subject: &str,
    html: &str,
) -> Result<()> {
    let body = serde_json::json!({
        "from": "DockCampus <noreply@dockcampus.sudelca.com>",
        "to": [email],
        "subject": subject,
        "html": html,
    });

    let resp = state
        .http_client
        .post("https://api.resend.com/emails")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let msg = resp
            .text()
            .await
            .unwrap_or_else(|_| "email provider error".to_string());
        Err(AppError::Internal(anyhow::anyhow!(
            "Resend API error ({status}): {msg}"
        )))
    }
}
