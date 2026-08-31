-- V18__verifiable_credentials.up.sql
--
-- W3C Verifiable Credentials and DIDs for Stellar MarketPay.
-- Additive migration: no existing tables are altered.
--
-- Tables:
--   did_documents            - DID document storage with version history
--   did_key_history          - Key rotation audit trail
--   credential_status_lists  - Bitstring status lists for revocation
--   verifiable_credentials   - Issued VCs
--   credential_presentations - Created VPs
--   credential_imports       - Externally issued credentials imported by holders
--   presentation_requests    - Presentation requests from external verifiers

-- ──────────────────────────────────────────────────────────────────────────
-- DID Documents
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE did_documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did           TEXT NOT NULL UNIQUE,
    controller    TEXT NOT NULL,
    document      JSONB NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deactivated   BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_did_documents_did ON did_documents (did);
CREATE INDEX idx_did_documents_controller ON did_documents (controller);
CREATE INDEX idx_did_documents_deactivated ON did_documents (deactivated) WHERE deactivated = false;

-- ──────────────────────────────────────────────────────────────────────────
-- Key Rotation History
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE did_key_history (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    did_id                UUID NOT NULL REFERENCES did_documents(id) ON DELETE CASCADE,
    key_id                TEXT NOT NULL,
    public_key_multibase  TEXT NOT NULL,
    key_type              TEXT NOT NULL DEFAULT 'Ed25519VerificationKey2020',
    activated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at        TIMESTAMPTZ,
    rotation_reason       TEXT
);

CREATE INDEX idx_did_key_history_did_id ON did_key_history (did_id);
CREATE INDEX idx_did_key_history_active ON did_key_history (did_id) WHERE deactivated_at IS NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- Credential Status Lists (for Bitstring Status List 2021 revocation)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE credential_status_lists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer_did  TEXT NOT NULL,
    list_index  INTEGER NOT NULL,
    bitstring   BYTEA NOT NULL,
    credential  JSONB NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issuer_did, list_index)
);

CREATE INDEX idx_status_lists_issuer ON credential_status_lists (issuer_did);

-- ──────────────────────────────────────────────────────────────────────────
-- Verifiable Credentials
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE verifiable_credentials (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credential_id      TEXT NOT NULL UNIQUE,
    issuer_did         TEXT NOT NULL,
    subject_did        TEXT NOT NULL,
    type               TEXT[] NOT NULL,
    claims             JSONB NOT NULL,
    credential         JSONB NOT NULL,
    proof_value        TEXT,
    status_list_index  INTEGER,
    status_list_id     UUID REFERENCES credential_status_lists(id),
    revoked            BOOLEAN NOT NULL DEFAULT false,
    revoked_at         TIMESTAMPTZ,
    on_chain_anchored  BOOLEAN NOT NULL DEFAULT false,
    on_chain_tx_hash   TEXT,
    schema_name        TEXT NOT NULL,
    schema_version     TEXT NOT NULL DEFAULT '1.0.0',
    issued_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at         TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vc_issuer ON verifiable_credentials (issuer_did);
CREATE INDEX idx_vc_subject ON verifiable_credentials (subject_did);
CREATE INDEX idx_vc_type ON verifiable_credentials USING GIN (type);
CREATE INDEX idx_vc_status_list ON verifiable_credentials (status_list_id) WHERE status_list_id IS NOT NULL;
CREATE INDEX idx_vc_revoked ON verifiable_credentials (revoked) WHERE revoked = true;

-- ──────────────────────────────────────────────────────────────────────────
-- Credential Presentations
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE credential_presentations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_did  TEXT NOT NULL,
    presentation JSONB NOT NULL,
    requested_by TEXT,
    purpose     TEXT NOT NULL DEFAULT 'authentication',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_presentations_holder ON credential_presentations (holder_did);
CREATE INDEX idx_presentations_purpose ON credential_presentations (purpose);

-- ──────────────────────────────────────────────────────────────────────────
-- Credential Imports (from external issuers)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE credential_imports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_did          TEXT NOT NULL,
    external_issuer_did TEXT NOT NULL,
    credential          JSONB NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'unverified',
    imported_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_imports_holder ON credential_imports (holder_did);
CREATE INDEX idx_imports_issuer ON credential_imports (external_issuer_did);
CREATE INDEX idx_imports_status ON credential_imports (verification_status);

-- ──────────────────────────────────────────────────────────────────────────
-- Presentation Requests (from external verifiers)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE presentation_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    verifier_did          TEXT NOT NULL,
    callback_url          TEXT NOT NULL,
    requested_credentials JSONB NOT NULL,
    nonce                 TEXT NOT NULL UNIQUE,
    status                TEXT NOT NULL DEFAULT 'pending',
    holder_did            TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ
);

CREATE INDEX idx_pr_nonce ON presentation_requests (nonce);
CREATE INDEX idx_pr_status ON presentation_requests (status);
CREATE INDEX idx_pr_holder ON presentation_requests (holder_did) WHERE holder_did IS NOT NULL;
