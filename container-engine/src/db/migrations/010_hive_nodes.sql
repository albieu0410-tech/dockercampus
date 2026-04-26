CREATE TABLE IF NOT EXISTS hive_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'worker',
    host TEXT NOT NULL,
    ip TEXT NOT NULL,
    ram_used_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    ram_total_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    cpu_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    disk_used_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    disk_total_gb DOUBLE PRECISION NOT NULL DEFAULT 0,
    deployments INTEGER NOT NULL DEFAULT 0,
    last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_hive_nodes_updated_at'
    ) THEN
        CREATE TRIGGER update_hive_nodes_updated_at
            BEFORE UPDATE ON hive_nodes
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_hive_nodes_last_heartbeat
    ON hive_nodes(last_heartbeat DESC);
