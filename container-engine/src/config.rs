use anyhow::{Context, Result};
use std::env;
use validator::Validate;

#[derive(Debug, Clone, Validate)]
pub struct Config {
    #[validate(url)]
    pub database_url: String,
    #[validate(length(min = 32))]
    pub secret_key: String,
    #[validate(range(min = 1, max = 1440))]
    pub jwt_exp_minutes: i64,
    #[validate(range(min = 1, max = 65535))]
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub resend_api_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let database_url = env::var("DATABASE_URL").context("DATABASE_URL is required")?;
        let secret_key = env::var("SECRET_KEY").context("SECRET_KEY is required")?;
        let jwt_exp_minutes = get_env_parse::<i64>("JWT_EXP_MINUTES", 60)?;
        let port = get_env_parse::<u16>("PORT", 8001)?;
        let allowed_origins = env::var("ALLOWED_ORIGINS")
            .unwrap_or_else(|_| "*".to_string())
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(ToString::to_string)
            .collect::<Vec<_>>();
        let resend_api_key = env::var("RESEND_API_KEY")
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());

        let mut config = Self {
            database_url,
            secret_key,
            jwt_exp_minutes,
            port,
            allowed_origins,
            resend_api_key,
        };
        config.normalize_database_url();

        config.validate().context("Invalid configuration")?;
        Ok(config)
    }

    fn normalize_database_url(&mut self) {
        if let Some(rest) = self.database_url.strip_prefix("postgresql+asyncpg://") {
            self.database_url = format!("postgresql://{rest}");
        }
    }
}

fn get_env_parse<T>(key: &str, default: T) -> Result<T>
where
    T: std::str::FromStr,
    <T as std::str::FromStr>::Err: std::error::Error + Send + Sync + 'static,
{
    match env::var(key) {
        Ok(raw) => raw
            .parse::<T>()
            .with_context(|| format!("{key} has an invalid value")),
        Err(env::VarError::NotPresent) => Ok(default),
        Err(e) => Err(e).with_context(|| format!("{key} cannot be read")),
    }
}

pub fn public_base_url() -> String {
    let environment = env::var("ENVIRONMENT").unwrap_or_default();
    let configured = env::var("BASE_URL").ok();
    public_base_url_for(&environment, configured.as_deref())
}

fn public_base_url_for(environment: &str, configured: Option<&str>) -> String {
    let environment = environment.trim().to_ascii_lowercase();
    if matches!(
        environment.as_str(),
        "local" | "development" | "dev" | "test"
    ) {
        return "http://localhost".to_string();
    }

    configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://dockcampus.sudelca.com")
        .trim_end_matches('/')
        .to_string()
}

pub fn api_base_url() -> String {
    let environment = env::var("ENVIRONMENT").unwrap_or_default();
    let configured = env::var("API_BASE_URL").ok();
    api_base_url_for(&environment, configured.as_deref())
}

fn api_base_url_for(environment: &str, configured: Option<&str>) -> String {
    let environment = environment.trim().to_ascii_lowercase();
    if matches!(
        environment.as_str(),
        "local" | "development" | "dev" | "test"
    ) {
        return "http://localhost:8001".to_string();
    }

    configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.sudelca.com")
        .trim_end_matches('/')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{api_base_url_for, public_base_url_for};

    #[test]
    fn development_always_uses_localhost() {
        assert_eq!(
            public_base_url_for("development", Some("https://dockcampus.sudelca.com")),
            "http://localhost"
        );
    }

    #[test]
    fn production_uses_configured_base_url() {
        assert_eq!(
            public_base_url_for("production", Some("https://dockcampus.example/")),
            "https://dockcampus.example"
        );
    }

    #[test]
    fn api_base_url_defaults_to_sudelca_in_production() {
        assert_eq!(
            api_base_url_for("production", None),
            "https://api.sudelca.com"
        );
    }

    #[test]
    fn api_base_url_uses_localhost_in_development() {
        assert_eq!(
            api_base_url_for("development", Some("https://api.sudelca.com")),
            "http://localhost:8001"
        );
    }
}
