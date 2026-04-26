CREATE TABLE IF NOT EXISTS wireguard_peers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id TEXT NOT NULL UNIQUE REFERENCES hive_nodes(node_id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    preshared_key TEXT,
    allowed_ips TEXT NOT NULL,
    endpoint TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_handshake TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_wireguard_peers_updated_at'
    ) THEN
        CREATE TRIGGER update_wireguard_peers_updated_at
            BEFORE UPDATE ON wireguard_peers
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_wireguard_peers_active
    ON wireguard_peers(is_active);
