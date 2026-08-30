-- Migration: 20230830_add_trust_tables.sql
-- Adds tables for Trust & Safety subsystem
-- Run with feature flag `trustEnabled` off; tables are backward compatible.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- ensure UUID generation

-- 1. Reports from users
CREATE TABLE IF NOT EXISTS trust_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL,
    content_type TEXT NOT NULL, -- e.g., 'job', 'proposal', 'message', 'profile'
    content_id UUID NOT NULL,
    category TEXT NOT NULL,   -- enum like 'scam', 'harassment', etc.
    details JSONB,            -- optional structured info from UI
    status TEXT NOT NULL DEFAULT 'open', -- open, in_review, resolved, dismissed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trust_reports_content ON trust_reports(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_trust_reports_reporter ON trust_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_trust_reports_status ON trust_reports(status);

-- 2. Automated classification logs
CREATE TABLE IF NOT EXISTS trust_classification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_type TEXT NOT NULL,
    content_id UUID NOT NULL,
    model_version TEXT NOT NULL,
    engine TEXT NOT NULL, -- 'ml' or 'rule'
    scores JSONB NOT NULL, -- e.g., {"spam":0.92,"abuse":0.34}
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trust_class_log_content ON trust_classification_logs(content_type, content_id);

-- 3. Moderation actions (human decisions)
CREATE TABLE IF NOT EXISTS trust_moderation_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id UUID REFERENCES trust_reports(id) ON DELETE CASCADE,
    moderator_id UUID NOT NULL,
    decision TEXT NOT NULL, -- e.g., 'accept', 'reject', 'escalate'
    rationale TEXT,
    action_taken TEXT NOT NULL, -- e.g., 'warning', 'remove_listing'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trust_mod_actions_report ON trust_moderation_actions(report_id);

-- 4. Enforcement decisions (ladder steps)
CREATE TABLE IF NOT EXISTS trust_enforcement_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id UUID NOT NULL,
    ladder_step TEXT NOT NULL, -- e.g., 'warning', 'restriction', 'suspension', 'ban'
    effective_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    escrow_handled BOOLEAN NOT NULL DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trust_enf_account ON trust_enforcement_decisions(account_id);

-- 5. Appeals workflow
CREATE TABLE IF NOT EXISTS trust_appeals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    decision_id UUID REFERENCES trust_enforcement_decisions(id) ON DELETE CASCADE,
    appellant_id UUID NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- open, under_review, upheld, denied, closed
    reviewer_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trust_appeals_decision ON trust_appeals(decision_id);

-- 6. Collusion rings (graph analysis output)
CREATE TABLE IF NOT EXISTS trust_collusion_rings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ring_hash TEXT NOT NULL UNIQUE,
    member_account_ids JSONB NOT NULL, -- array of UUIDs
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    severity TEXT NOT NULL -- low, medium, high, critical
);
CREATE INDEX IF NOT EXISTS idx_trust_collusion_ring_hash ON trust_collusion_rings(ring_hash);

-- 7. Enforcement ladder lookup (static data)
CREATE TABLE IF NOT EXISTS trust_enforcement_ladder (
    step TEXT PRIMARY KEY,
    order_index INT NOT NULL,
    description TEXT NOT NULL
);
-- Insert default ladder steps (if not present)
INSERT INTO trust_enforcement_ladder (step, order_index, description) VALUES
    ('warning', 1, 'Send a formal warning to the user'),
    ('restriction', 2, 'Restrict certain features (e.g., messaging)'),
    ('listing_removal', 3, 'Remove listed items or proposals'),
    ('suspension', 4, 'Temporarily suspend account'),
    ('ban', 5, 'Permanently ban account')
ON CONFLICT (step) DO NOTHING;

-- Trigger to auto‑update updated_at on trust_reports
CREATE OR REPLACE FUNCTION trust_reports_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_trust_reports ON trust_reports;
CREATE TRIGGER set_timestamp_trust_reports
BEFORE UPDATE ON trust_reports
FOR EACH ROW EXECUTE FUNCTION trust_reports_set_timestamp();

-- End of migration
