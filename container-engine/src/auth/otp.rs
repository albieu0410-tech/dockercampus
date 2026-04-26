use chrono::{DateTime, Duration, Utc};
use rand::{thread_rng, Rng};

pub const OTP_TTL_MINUTES: i64 = 10;

pub fn generate_otp() -> String {
    let value: u32 = thread_rng().gen_range(0..1_000_000);
    format!("{value:06}")
}

pub fn expires_at(ttl_minutes: i64) -> DateTime<Utc> {
    Utc::now() + Duration::minutes(ttl_minutes)
}

pub fn default_expires_at() -> DateTime<Utc> {
    expires_at(OTP_TTL_MINUTES)
}
