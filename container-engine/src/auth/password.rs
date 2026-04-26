use bcrypt::{hash, verify, BcryptError, DEFAULT_COST};

use crate::errors::{AppError, Result};

pub fn hash_password(password: &str) -> Result<String> {
    hash(password, DEFAULT_COST).map_err(map_bcrypt_error)
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<bool> {
    verify(password, password_hash).map_err(map_bcrypt_error)
}

fn map_bcrypt_error(err: BcryptError) -> AppError {
    AppError::BadRequest(format!("password operation failed: {err}"))
}
