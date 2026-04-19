CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    container_id UUID NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
    repo_url VARCHAR(500) NOT NULL,
    github_token TEXT,
    detected_port INTEGER,
    custom_port INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    build_logs TEXT,
    public_url VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS github_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    github_username VARCHAR(255) NOT NULL,
    github_access_token TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
    CREATE TRIGGER update_deployments_updated_at
        BEFORE UPDATE ON deployments
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    CREATE TRIGGER update_github_connections_updated_at
        BEFORE UPDATE ON github_connections
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
