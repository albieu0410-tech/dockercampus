CREATE TABLE IF NOT EXISTS routing_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    strategy TEXT NOT NULL DEFAULT 'rr',
    canary_active BOOLEAN NOT NULL DEFAULT FALSE,
    canary_percent INTEGER NOT NULL DEFAULT 0,
    rr_cursor BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO routing_config (id, strategy, canary_active, canary_percent, rr_cursor)
VALUES (1, 'rr', FALSE, 0, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS routing_node_metrics (
    node_id TEXT PRIMARY KEY REFERENCES hive_nodes(node_id) ON DELETE CASCADE,
    weight INTEGER NOT NULL DEFAULT 100,
    active_connections INTEGER NOT NULL DEFAULT 0,
    avg_response_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
    error_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    circuit_state TEXT NOT NULL DEFAULT 'closed',
    failure_count INTEGER NOT NULL DEFAULT 0,
    requests_total BIGINT NOT NULL DEFAULT 0,
    is_canary BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_routing_config_updated_at'
    ) THEN
        CREATE TRIGGER update_routing_config_updated_at
            BEFORE UPDATE ON routing_config
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_routing_node_metrics_updated_at'
    ) THEN
        CREATE TRIGGER update_routing_node_metrics_updated_at
            BEFORE UPDATE ON routing_node_metrics
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_routing_node_metrics_circuit_state
    ON routing_node_metrics(circuit_state);
