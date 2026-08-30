-- V17__zk_reputation.up.sql
-- Zero-knowledge reputation with selective disclosure (Issue #319).
--
-- Data model summary (see docs/ADR-010-zk-reputation.md for the full design):
--
--   reputation_commitments  One row per rating, holding Pedersen commitments
--                            to (score, amount, dispute-flag) instead of the
--                            plaintext being exposed to other users. The
--                            platform still computes these from plaintext at
--                            issuance time (same trust boundary as today's
--                            public `ratings` row) and stores the openings so
--                            it can optionally act as a proving service.
--   reputation_epochs       Append-only history of per-subject Merkle roots
--                            over their commitment leaves. A new epoch is
--                            appended whenever a rating is issued *or*
--                            revoked for that subject. Proofs are bound to
--                            one epoch's root, so routine new-rating arrivals
--                            never invalidate outstanding proofs bound to an
--                            earlier epoch.
--   reputation_revocations  Records when a previously-issued rating is
--                            overturned on appeal. Any proof bound to an
--                            epoch >= the epoch that first included the
--                            revoked rating is thereafter invalid — enforced
--                            both off-chain (reputationService) and on-chain
--                            (the Soroban contract's `earliest_invalidated_epoch`).
--   job_reputation_requirements
--                            A client's optional verifiable requirement on a
--                            job posting ("apply only if you can prove X").
--   application_reputation_proofs
--                            A freelancer's proof attached to one application,
--                            recording the statement, its public parameters,
--                            and the verification outcome — never the
--                            underlying ratings.

CREATE TABLE IF NOT EXISTS reputation_commitments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rating_id          UUID NOT NULL UNIQUE REFERENCES ratings(id) ON DELETE CASCADE,
  subject_address    TEXT NOT NULL REFERENCES profiles(public_key),
  leaf_index         INTEGER NOT NULL,
  score_commitment   BYTEA NOT NULL CHECK (octet_length(score_commitment) = 96),
  amount_commitment  BYTEA NOT NULL CHECK (octet_length(amount_commitment) = 96),
  dispute_commitment BYTEA NOT NULL CHECK (octet_length(dispute_commitment) = 96),
  -- Openings. The platform computed these from plaintext it already had
  -- (the `stars` value on the `ratings` row, the job's bid amount, and
  -- whether the job was ever disputed) — storing them changes nothing about
  -- what the *platform* knows, only what other users see by default. A
  -- subject can fetch their own openings via GET /api/reputation/:key/openings
  -- to prove client-side without trusting the platform as a prover.
  score_value        BIGINT NOT NULL,
  score_blinding     BYTEA NOT NULL CHECK (octet_length(score_blinding) = 32),
  amount_value       BIGINT NOT NULL,
  amount_blinding    BYTEA NOT NULL CHECK (octet_length(amount_blinding) = 32),
  dispute_value      SMALLINT NOT NULL CHECK (dispute_value IN (0, 1)),
  dispute_blinding   BYTEA NOT NULL CHECK (octet_length(dispute_blinding) = 32),
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT,
  revoked_by         TEXT REFERENCES profiles(public_key),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_address, leaf_index)
);

CREATE INDEX IF NOT EXISTS reputation_commitments_subject_idx
  ON reputation_commitments(subject_address, leaf_index);

CREATE TABLE IF NOT EXISTS reputation_epochs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_address TEXT NOT NULL REFERENCES profiles(public_key),
  epoch           INTEGER NOT NULL,
  root            BYTEA NOT NULL CHECK (octet_length(root) = 32),
  leaf_count      INTEGER NOT NULL,
  reason          TEXT NOT NULL CHECK (reason IN ('issued', 'revoked')),
  -- Set once the root has been anchored on-chain via the Soroban contract's
  -- anchor_reputation_root(); NULL means "anchored off-chain only so far".
  anchor_tx_hash  TEXT,
  anchored_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (subject_address, epoch)
);

CREATE INDEX IF NOT EXISTS reputation_epochs_subject_latest_idx
  ON reputation_epochs(subject_address, epoch DESC);

CREATE TABLE IF NOT EXISTS reputation_revocations (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_address          TEXT NOT NULL REFERENCES profiles(public_key),
  reputation_commitment_id UUID NOT NULL REFERENCES reputation_commitments(id),
  -- The epoch at which the now-revoked rating was first included. Every
  -- epoch >= this value is invalid from this point on (see
  -- reputationService.isEpochValid and the contract's identical rule).
  invalidates_from_epoch  INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  revoked_by              TEXT NOT NULL REFERENCES profiles(public_key),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reputation_revocations_subject_idx
  ON reputation_revocations(subject_address);

CREATE TABLE IF NOT EXISTS job_reputation_requirements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  statement_kind   TEXT NOT NULL
                     CHECK (statement_kind IN
                       ('rating_threshold', 'completion_count', 'earnings_band', 'dispute_free')),
  statement_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  required         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_reputation_requirements_job_idx
  ON job_reputation_requirements(job_id);

CREATE TABLE IF NOT EXISTS application_reputation_proofs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  freelancer_address TEXT NOT NULL REFERENCES profiles(public_key),
  statement_kind    TEXT NOT NULL
                      CHECK (statement_kind IN
                        ('rating_threshold', 'completion_count', 'earnings_band', 'dispute_free')),
  public_params     JSONB NOT NULL,
  epoch             INTEGER NOT NULL,
  root              BYTEA NOT NULL CHECK (octet_length(root) = 32),
  proof             JSONB NOT NULL,
  verified          BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at       TIMESTAMPTZ,
  verification_reason TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (application_id, statement_kind)
);

CREATE INDEX IF NOT EXISTS application_reputation_proofs_application_idx
  ON application_reputation_proofs(application_id);

-- Per-subject reputation display preference (Issue #319: "keep the existing
-- public reputation available for those who prefer it; this is an option,
-- not a replacement"). Default stays 'public' — nothing changes for a
-- freelancer who does not opt in.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS reputation_visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (reputation_visibility IN ('public', 'selective'));
