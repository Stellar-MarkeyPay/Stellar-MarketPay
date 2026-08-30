-- Migration V19: Multi-Region Active-Active PostgreSQL with Conflict Resolution and Fencing
-- Implements table consistency tiers, generation-token fencing leases, CRDT PN-counters, and conflict audit logging.

-- ─────────────────────────────────────────
-- 1. replication_nodes
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replication_nodes (
  node_id           TEXT PRIMARY KEY,
  region_id         TEXT NOT NULL,
  endpoint          TEXT NOT NULL,
  is_authority      BOOLEAN NOT NULL DEFAULT false,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  last_heartbeat    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS replication_nodes_region_idx ON replication_nodes(region_id, is_active);

-- ─────────────────────────────────────────
-- 2. replication_table_policies
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replication_table_policies (
  table_name        TEXT PRIMARY KEY,
  consistency_class TEXT NOT NULL CHECK (consistency_class IN ('STRICT_CP', 'CAUSAL_RYW', 'EVENTUAL_CRDT')),
  conflict_policy   TEXT NOT NULL CHECK (conflict_policy IN ('REJECT_UNLESS_LEASE_HOLDER', 'VERSION_VECTOR_MERGE', 'CRDT_PN_COUNTER', 'LWW_TIMESTAMP_TIEBREAK', 'STATE_MACHINE_VALIDATED', 'APPEND_ONLY')),
  routing_target    TEXT NOT NULL CHECK (routing_target IN ('AUTHORITY_ONLY', 'LOCAL_WRITABLE', 'ANY_REGION')),
  description       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed policy catalog with every table in Stellar-MarketPay
INSERT INTO replication_table_policies (table_name, consistency_class, conflict_policy, routing_target, description)
VALUES
  -- Class 1: Strict Linearizability (CP) - Financial & Security
  ('escrows', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Soroban escrow state off-chain mirror; strictly linearizable on lease holder'),
  ('referral_payouts', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Referral financial payout ledger; strictly linearizable'),
  ('platform_fee_payouts', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Platform fee split payouts; strictly linearizable'),
  ('multi_level_payouts', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', '3-Tier referral tree payouts; strictly linearizable'),
  ('insurance_claims', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Decentralized storage insurance claims; strictly linearizable'),
  ('insurance_premiums_paid', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Insurance premium payment receipts; strictly linearizable'),
  ('sla_violations', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Storage SLA violation financial penalty records; strictly linearizable'),
  ('ratings', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Job rating submissions and reviews; strictly linearizable to prevent duplicate reviews'),
  ('dispute_evidence', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Dispute IPFS evidence pins; strictly linearizable'),
  ('reputation_commitments', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'ZK reputation Pedersen commitments; strictly linearizable'),
  ('reputation_revocations', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'ZK reputation revocations; strictly linearizable'),
  ('reputation_epochs', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'ZK reputation Merkle epoch roots; strictly linearizable'),
  ('frozen_wallets', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Emergency frozen wallets blacklist; strictly linearizable'),
  ('api_keys', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Developer API keys and permissions; strictly linearizable'),
  ('admin_profiles', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Admin profiles and 2FA credentials; strictly linearizable'),
  ('webauthn_credentials', 'STRICT_CP', 'REJECT_UNLESS_LEASE_HOLDER', 'AUTHORITY_ONLY', 'Passkey WebAuthn credentials; strictly linearizable'),

  -- Class 2: Causal Consistency (Read-Your-Writes) - Marketplace Core Entities
  ('jobs', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'Marketplace job listings with state-machine transition validation'),
  ('applications', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'Freelancer job proposals with unique (job_id, freelancer_address) constraint'),
  ('profiles', 'CAUSAL_RYW', 'VERSION_VECTOR_MERGE', 'LOCAL_WRITABLE', 'User profiles with field-level causal merging'),
  ('dao_proposals', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'DAO governance proposals with state transitions'),
  ('dao_votes', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'DAO governance votes; immutable unique votes'),
  ('private_messages', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'End-to-end encrypted private messages with unique nonce'),
  ('messages', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Job chat messages; immutable append-only with monotonic IDs'),
  ('progress_updates', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Job milestone progress updates; immutable append-only'),
  ('referrals', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'User referral linkages with unique (referrer, referee) pairs'),
  ('referral_tree', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'Multi-tier referral tree nodes with cycle prevention'),
  ('contract_events', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Soroban smart contract event logs; deduplicated on tx_hash + event_index'),
  ('skill_certificates', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Freelancer skill credentials; immutable append-only'),
  ('audit_logs', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Administrative audit logs; immutable append-only'),
  ('plugins', 'CAUSAL_RYW', 'VERSION_VECTOR_MERGE', 'LOCAL_WRITABLE', 'Marketplace plugin registry; version vector merged'),
  ('plugin_versions', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Plugin release manifests; immutable releases'),
  ('plugin_installations', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'User plugin installations; validated states'),
  ('assessment_skills', 'CAUSAL_RYW', 'VERSION_VECTOR_MERGE', 'LOCAL_WRITABLE', 'Assessment skill authoring definitions'),
  ('assessment_questions', 'CAUSAL_RYW', 'VERSION_VECTOR_MERGE', 'LOCAL_WRITABLE', 'Assessment questions pool with causal updates'),
  ('job_reputation_requirements', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'ZK reputation gates for job applicants'),
  ('application_reputation_proofs', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Submitted ZK proofs for job applications'),
  ('insured_files', 'CAUSAL_RYW', 'STATE_MACHINE_VALIDATED', 'LOCAL_WRITABLE', 'Decentralized storage file insurance registries'),
  ('fraud_alerts', 'CAUSAL_RYW', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Automated fraud detection alerts; append-only'),

  -- Class 3: Eventual Consistency (AP) - CRDTs, Telemetry, and Loss-Tolerant Cache
  ('crdt_pn_counters', 'EVENTUAL_CRDT', 'CRDT_PN_COUNTER', 'ANY_REGION', 'Positive-Negative counter CRDT storage for distributed metrics'),
  ('job_views', 'EVENTUAL_CRDT', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Job listing impression counts; loss-tolerant telemetry'),
  ('notifications', 'EVENTUAL_CRDT', 'LWW_TIMESTAMP_TIEBREAK', 'LOCAL_WRITABLE', 'In-app notifications; LWW on read_at status'),
  ('notification_preferences', 'EVENTUAL_CRDT', 'LWW_TIMESTAMP_TIEBREAK', 'LOCAL_WRITABLE', 'User notification delivery channel preferences'),
  ('job_drafts', 'EVENTUAL_CRDT', 'LWW_TIMESTAMP_TIEBREAK', 'LOCAL_WRITABLE', 'Client job creation drafts; LWW per client address'),
  ('saved_searches', 'EVENTUAL_CRDT', 'LWW_TIMESTAMP_TIEBREAK', 'LOCAL_WRITABLE', 'Saved search filter queries and alerts'),
  ('scope_sessions', 'EVENTUAL_CRDT', 'LWW_TIMESTAMP_TIEBREAK', 'LOCAL_WRITABLE', 'Realtime collaborative scope editing sessions'),
  ('ml_ranking_shadow_events', 'EVENTUAL_CRDT', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'ML job ranking shadow mode evaluation events'),
  ('plugin_invocation_logs', 'EVENTUAL_CRDT', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Plugin execution telemetry and metrics'),
  ('availability_check_history', 'EVENTUAL_CRDT', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'IPFS file pin availability checks history'),
  ('oracle_proofs', 'EVENTUAL_CRDT', 'APPEND_ONLY', 'LOCAL_WRITABLE', 'Storage oracle proofs and uptime attestations'),
  ('api_key_usage_daily', 'EVENTUAL_CRDT', 'CRDT_PN_COUNTER', 'ANY_REGION', 'Daily API key request counters; PN-CRDT resolved')
ON CONFLICT (table_name) DO UPDATE
SET
  consistency_class = EXCLUDED.consistency_class,
  conflict_policy   = EXCLUDED.conflict_policy,
  routing_target    = EXCLUDED.routing_target,
  description       = EXCLUDED.description,
  updated_at        = NOW();

-- ─────────────────────────────────────────
-- 3. region_fencing_leases
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS region_fencing_leases (
  lease_key         TEXT PRIMARY KEY,
  holder_region     TEXT NOT NULL,
  holder_node       TEXT NOT NULL,
  generation_token  BIGINT NOT NULL DEFAULT 1,
  expires_at        TIMESTAMPTZ NOT NULL,
  fenced_regions    TEXT[] NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default authority lease
INSERT INTO region_fencing_leases (lease_key, holder_region, holder_node, generation_token, expires_at, fenced_regions)
VALUES (
  'global_financial_authority',
  'primary-cluster',
  'node-primary-0',
  1,
  NOW() + INTERVAL '10 years',
  '{}'
)
ON CONFLICT (lease_key) DO NOTHING;

-- ─────────────────────────────────────────
-- 4. replication_conflicts
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replication_conflicts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name          TEXT NOT NULL,
  record_id           TEXT NOT NULL,
  origin_region       TEXT NOT NULL,
  conflicting_region  TEXT NOT NULL,
  local_payload       JSONB NOT NULL,
  incoming_payload    JSONB NOT NULL,
  resolution_strategy TEXT NOT NULL,
  resolution_status   TEXT NOT NULL DEFAULT 'resolved' CHECK (resolution_status IN ('resolved', 'rejected', 'pending_manual', 'escalated')),
  resolved_payload    JSONB,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS replication_conflicts_table_record_idx ON replication_conflicts(table_name, record_id);
CREATE INDEX IF NOT EXISTS replication_conflicts_status_idx ON replication_conflicts(resolution_status, detected_at DESC);

-- ─────────────────────────────────────────
-- 5. crdt_pn_counters
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crdt_pn_counters (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type       TEXT NOT NULL,
  entity_id         TEXT NOT NULL,
  counter_name      TEXT NOT NULL,
  region_id         TEXT NOT NULL,
  node_id           TEXT NOT NULL,
  positive_delta    NUMERIC(30,7) NOT NULL DEFAULT 0,
  negative_delta    NUMERIC(30,7) NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, counter_name, region_id, node_id)
);

CREATE INDEX IF NOT EXISTS crdt_pn_counters_lookup_idx ON crdt_pn_counters(entity_type, entity_id, counter_name);

-- ─────────────────────────────────────────
-- 6. replication_heartbeats
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS replication_heartbeats (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_region     TEXT NOT NULL,
  source_node       TEXT NOT NULL,
  target_region     TEXT NOT NULL,
  wal_lsn           TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_at       TIMESTAMPTZ,
  round_trip_ms     NUMERIC(10,2)
);

CREATE INDEX IF NOT EXISTS replication_heartbeats_sent_idx ON replication_heartbeats(sent_at DESC);

-- ─────────────────────────────────────────
-- 7. Stored helper procedures / functions
-- ─────────────────────────────────────────

-- Acquire or renew fencing lease
CREATE OR REPLACE FUNCTION acquire_fencing_lease(
  p_lease_key TEXT,
  p_region TEXT,
  p_node TEXT,
  p_duration_seconds INTEGER DEFAULT 6
)
RETURNS TABLE(
  granted BOOLEAN,
  generation_token BIGINT,
  expires_at TIMESTAMPTZ
) AS $$
DECLARE
  v_current_lease RECORD;
  v_new_gen BIGINT;
  v_new_expiry TIMESTAMPTZ;
BEGIN
  v_new_expiry := NOW() + (p_duration_seconds || ' seconds')::INTERVAL;

  SELECT * INTO v_current_lease
  FROM region_fencing_leases
  WHERE lease_key = p_lease_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO region_fencing_leases (lease_key, holder_region, holder_node, generation_token, expires_at)
    VALUES (p_lease_key, p_region, p_node, 1, v_new_expiry)
    RETURNING region_fencing_leases.generation_token, region_fencing_leases.expires_at
    INTO v_new_gen, v_new_expiry;

    RETURN QUERY SELECT true, v_new_gen, v_new_expiry;
    RETURN;
  END IF;

  -- If same region or lease has expired, grant renewal / takeover
  IF v_current_lease.holder_region = p_region THEN
    UPDATE region_fencing_leases
    SET holder_node = p_node,
        expires_at = v_new_expiry,
        updated_at = NOW()
    WHERE lease_key = p_lease_key;

    RETURN QUERY SELECT true, v_current_lease.generation_token, v_new_expiry;
    RETURN;
  ELSIF v_current_lease.expires_at < NOW() THEN
    -- Takeover expired lease with generation increment
    v_new_gen := v_current_lease.generation_token + 1;
    UPDATE region_fencing_leases
    SET holder_region = p_region,
        holder_node = p_node,
        generation_token = v_new_gen,
        expires_at = v_new_expiry,
        updated_at = NOW()
    WHERE lease_key = p_lease_key;

    RETURN QUERY SELECT true, v_new_gen, v_new_expiry;
    RETURN;
  ELSE
    -- Active lease held by another region; reject takeover
    RETURN QUERY SELECT false, v_current_lease.generation_token, v_current_lease.expires_at;
    RETURN;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Assert valid fencing lease before committing Class 1 financial write
CREATE OR REPLACE FUNCTION assert_valid_fencing_lease(
  p_lease_key TEXT,
  p_region TEXT,
  p_generation_token BIGINT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_lease RECORD;
BEGIN
  SELECT * INTO v_lease
  FROM region_fencing_leases
  WHERE lease_key = p_lease_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fencing lease % not found', p_lease_key USING ERRCODE = '55000';
  END IF;

  IF v_lease.holder_region <> p_region THEN
    RAISE EXCEPTION 'Region % does not hold fencing lease % (held by %)', p_region, p_lease_key, v_lease.holder_region USING ERRCODE = '55000';
  END IF;

  IF v_lease.expires_at < NOW() THEN
    RAISE EXCEPTION 'Fencing lease % expired at %', p_lease_key, v_lease.expires_at USING ERRCODE = '55000';
  END IF;

  IF p_generation_token IS NOT NULL AND v_lease.generation_token <> p_generation_token THEN
    RAISE EXCEPTION 'Stale generation token % for lease % (current: %)', p_generation_token, p_lease_key, v_lease.generation_token USING ERRCODE = '55000';
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Register PN-Counter Delta
CREATE OR REPLACE FUNCTION register_crdt_pn_delta(
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_counter_name TEXT,
  p_region TEXT,
  p_node TEXT,
  p_pos NUMERIC DEFAULT 0,
  p_neg NUMERIC DEFAULT 0
)
RETURNS NUMERIC AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  INSERT INTO crdt_pn_counters (entity_type, entity_id, counter_name, region_id, node_id, positive_delta, negative_delta, updated_at)
  VALUES (p_entity_type, p_entity_id, p_counter_name, p_region, p_node, GREATEST(p_pos, 0), GREATEST(p_neg, 0), NOW())
  ON CONFLICT (entity_type, entity_id, counter_name, region_id, node_id)
  DO UPDATE SET
    positive_delta = crdt_pn_counters.positive_delta + GREATEST(EXCLUDED.positive_delta, 0),
    negative_delta = crdt_pn_counters.negative_delta + GREATEST(EXCLUDED.negative_delta, 0),
    updated_at = NOW();

  SELECT COALESCE(SUM(positive_delta - negative_delta), 0)
  INTO v_total
  FROM crdt_pn_counters
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND counter_name = p_counter_name;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql;

-- Compute PN-Counter aggregate value
CREATE OR REPLACE FUNCTION get_crdt_pn_value(
  p_entity_type TEXT,
  p_entity_id TEXT,
  p_counter_name TEXT
)
RETURNS NUMERIC AS $$
DECLARE
  v_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(positive_delta - negative_delta), 0)
  INTO v_total
  FROM crdt_pn_counters
  WHERE entity_type = p_entity_type AND entity_id = p_entity_id AND counter_name = p_counter_name;

  RETURN v_total;
END;
$$ LANGUAGE plpgsql;
