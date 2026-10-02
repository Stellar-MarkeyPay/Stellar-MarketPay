CREATE TABLE IF NOT EXISTS bridge_transfers (
    id SERIAL PRIMARY KEY,
    source_chain VARCHAR(50) NOT NULL,
    target_chain VARCHAR(50) NOT NULL,
    transfer_type VARCHAR(50) NOT NULL,
    nonce VARCHAR(255) UNIQUE NOT NULL,
    amount NUMERIC(78, 0),
    sender VARCHAR(255) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    tx_hash VARCHAR(255),
    failure_reason TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bridge_transfers_nonce ON bridge_transfers(nonce);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_status ON bridge_transfers(status);
CREATE INDEX IF NOT EXISTS idx_bridge_transfers_created_at ON bridge_transfers(created_at);
