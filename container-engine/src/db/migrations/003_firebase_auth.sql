-- Add Firebase fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR UNIQUE;

-- Invite codes table
CREATE TABLE IF NOT EXISTS invite_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR UNIQUE NOT NULL,
    role VARCHAR NOT NULL DEFAULT 'student',
    created_by UUID REFERENCES users(id),
    used_by UUID REFERENCES users(id),
    is_used BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- OTP sessions table
CREATE TABLE IF NOT EXISTS otp_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    firebase_session_info VARCHAR NOT NULL,
    attempts INTEGER DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
