use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub email: String,
    pub role: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn create_token(
    user_id: &str,
    email: &str,
    role: &str,
    secret_key: &str,
    ttl_minutes: i64,
) -> Result<String> {
    let now = Utc::now();
    let exp = now + Duration::minutes(ttl_minutes);
    let claims = Claims {
        sub: user_id.to_string(),
        email: email.to_string(),
        role: role.to_string(),
        iat: now.timestamp(),
        exp: exp.timestamp(),
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret_key.as_bytes()),
    )
    .map_err(|e| AppError::BadRequest(format!("failed to sign jwt: {e}")))
}

pub fn decode_token(token: &str, secret_key: &str) -> Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret_key.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::BadRequest(format!("invalid jwt: {e}")))?;

    Ok(data.claims)
}
