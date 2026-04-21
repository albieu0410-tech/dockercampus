ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_token TEXT;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_reset_token
    ON users(password_reset_token)
    WHERE password_reset_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_email
    ON users(email);
