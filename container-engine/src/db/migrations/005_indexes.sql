CREATE INDEX IF NOT EXISTS idx_containers_user_id
    ON containers(user_id);

CREATE INDEX IF NOT EXISTS idx_containers_status
    ON containers(status);

CREATE INDEX IF NOT EXISTS idx_deployments_user_id
    ON deployments(user_id);

CREATE INDEX IF NOT EXISTS idx_deployments_status
    ON deployments(status);

CREATE INDEX IF NOT EXISTS idx_otp_sessions_user_id
    ON otp_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires
    ON otp_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_invite_codes_code
    ON invite_codes(code);

CREATE INDEX IF NOT EXISTS idx_invite_codes_used
    ON invite_codes(is_used);
