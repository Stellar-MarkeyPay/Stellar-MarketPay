-- V20__recurring_retainers.up.sql
-- Recurring retainers and subscription billing (Issue #321).
-- See docs/ADR-012-recurring-retainers.md for the full design, data
-- model rationale and migration plan.
--
-- Data model summary:
--
--   retainer_proposals     Commercial surface (distinct from job
--                          applications): proposed terms awaiting the
--                          counterparty's accept/decline.
--   retainers              The live agreement: current terms, funded
--                          balance, lifecycle status.
--   retainer_periods       One row per billing cycle; the unit the
--                          scheduler releases against.
--   retainer_amendments    Every proposed change to a live retainer
--                          (price, terms, pause/resume, renewal),
--                          requiring the counterparty's explicit accept.
--   retainer_funding_events Append-only ledger of client top-ups —
--                          source of truth for retainers.balance_xlm.
--   retainer_statements    Per-period reconciling document (logged vs.
--                          approved vs. disputed vs. forfeited hours,
--                          amount due vs. released).
--
-- time_entries is altered (not duplicated) so retainer work reuses the
-- same logging path as job work: job_id becomes nullable, and
-- retainer_id / retainer_period_id / approval columns are added, guarded
-- by a CHECK so every row still belongs to exactly one billing construct.

-- ─────────────────────────────────────────
-- retainer_proposals
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_proposals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_address      TEXT        NOT NULL REFERENCES profiles(public_key),
  counterparty_address  TEXT        NOT NULL REFERENCES profiles(public_key),
  proposer_role         TEXT        NOT NULL CHECK (proposer_role IN ('client', 'freelancer')),
  title                 TEXT        NOT NULL,
  description           TEXT,
  period_type           TEXT        NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  billing_model         TEXT        NOT NULL CHECK (billing_model IN ('fixed', 'capped_hourly')),
  amount_xlm            NUMERIC(20,7) NOT NULL CHECK (amount_xlm > 0),
  hourly_rate_xlm       NUMERIC(20,7) CHECK (hourly_rate_xlm IS NULL OR hourly_rate_xlm > 0),
  cap_hours             NUMERIC(7,2)  CHECK (cap_hours IS NULL OR cap_hours > 0),
  auto_renew            BOOLEAN     NOT NULL DEFAULT true,
  notice_period_days    INTEGER     NOT NULL DEFAULT 14 CHECK (notice_period_days >= 0),
  rollover_policy       TEXT        NOT NULL DEFAULT 'forfeit' CHECK (rollover_policy IN ('forfeit', 'rollover')),
  proposed_start_date   DATE,
  status                TEXT        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
  decline_reason        TEXT,
  retainer_id           UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at            TIMESTAMPTZ,
  CHECK (proposer_address <> counterparty_address),
  CHECK (billing_model = 'fixed' OR (hourly_rate_xlm IS NOT NULL AND cap_hours IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS retainer_proposals_counterparty_idx ON retainer_proposals(counterparty_address, status);
CREATE INDEX IF NOT EXISTS retainer_proposals_proposer_idx     ON retainer_proposals(proposer_address, status);

-- ─────────────────────────────────────────
-- retainers
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id           UUID        REFERENCES retainer_proposals(id),
  client_address        TEXT        NOT NULL REFERENCES profiles(public_key),
  freelancer_address    TEXT        NOT NULL REFERENCES profiles(public_key),
  title                 TEXT        NOT NULL,
  description           TEXT,
  period_type           TEXT        NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
  billing_model         TEXT        NOT NULL CHECK (billing_model IN ('fixed', 'capped_hourly')),
  amount_xlm            NUMERIC(20,7) NOT NULL CHECK (amount_xlm > 0),
  hourly_rate_xlm       NUMERIC(20,7) CHECK (hourly_rate_xlm IS NULL OR hourly_rate_xlm > 0),
  cap_hours             NUMERIC(7,2)  CHECK (cap_hours IS NULL OR cap_hours > 0),
  auto_renew            BOOLEAN     NOT NULL DEFAULT true,
  notice_period_days    INTEGER     NOT NULL DEFAULT 14 CHECK (notice_period_days >= 0),
  rollover_policy       TEXT        NOT NULL DEFAULT 'forfeit' CHECK (rollover_policy IN ('forfeit', 'rollover')),
  status                TEXT        NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active', 'paused', 'pending_cancellation', 'cancelled')),
  balance_xlm           NUMERIC(20,7) NOT NULL DEFAULT 0 CHECK (balance_xlm >= 0),
  pending_amendment_id  UUID,
  cancel_requested_by   TEXT        REFERENCES profiles(public_key),
  cancel_reason         TEXT,
  cancel_effective_at   TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  paused_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (client_address <> freelancer_address),
  CHECK (billing_model = 'fixed' OR (hourly_rate_xlm IS NOT NULL AND cap_hours IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS retainers_client_idx     ON retainers(client_address, status);
CREATE INDEX IF NOT EXISTS retainers_freelancer_idx ON retainers(freelancer_address, status);
CREATE INDEX IF NOT EXISTS retainers_status_idx      ON retainers(status);

ALTER TABLE retainer_proposals
  ADD CONSTRAINT retainer_proposals_retainer_id_fkey
  FOREIGN KEY (retainer_id) REFERENCES retainers(id);

-- ─────────────────────────────────────────
-- retainer_periods
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_periods (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retainer_id             UUID        NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  period_index            INTEGER     NOT NULL CHECK (period_index >= 0),
  period_start            TIMESTAMPTZ NOT NULL,
  period_end              TIMESTAMPTZ NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'open'
                                       CHECK (status IN ('open', 'released', 'underfunded', 'held_paused', 'settled_prorata', 'cancelled')),
  -- Terms are snapshotted onto the period at creation time so a price/terms
  -- amendment accepted mid-period only takes effect for the *next* period
  -- (see ADR-012's "Lifecycle" section) — the currently-open period always
  -- bills against what was true when it opened.
  billing_model           TEXT        NOT NULL CHECK (billing_model IN ('fixed', 'capped_hourly')),
  amount_xlm              NUMERIC(20,7) NOT NULL,
  hourly_rate_xlm         NUMERIC(20,7),
  cap_hours               NUMERIC(7,2),
  rollover_hours_in       NUMERIC(7,2) NOT NULL DEFAULT 0,
  rollover_hours_out      NUMERIC(7,2) NOT NULL DEFAULT 0,
  forfeited_hours         NUMERIC(7,2) NOT NULL DEFAULT 0,
  logged_hours            NUMERIC(9,2) NOT NULL DEFAULT 0,
  approved_hours          NUMERIC(9,2) NOT NULL DEFAULT 0,
  disputed_hours          NUMERIC(9,2) NOT NULL DEFAULT 0,
  amount_due_xlm          NUMERIC(20,7),
  amount_released_xlm     NUMERIC(20,7) NOT NULL DEFAULT 0,
  shortfall_xlm           NUMERIC(20,7) NOT NULL DEFAULT 0,
  underfunding_warned_at  TIMESTAMPTZ,
  upcoming_notice_sent_at TIMESTAMPTZ,
  released_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (retainer_id, period_index),
  CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS retainer_periods_retainer_idx     ON retainer_periods(retainer_id);
CREATE INDEX IF NOT EXISTS retainer_periods_status_end_idx   ON retainer_periods(status, period_end);

-- ─────────────────────────────────────────
-- retainer_amendments
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_amendments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retainer_id   UUID        NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  type          TEXT        NOT NULL
                             CHECK (type IN ('price_change', 'terms_change', 'pause', 'resume', 'renewal_terms', 'cancellation_notice')),
  proposed_by   TEXT        NOT NULL REFERENCES profiles(public_key),
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  status        TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS retainer_amendments_retainer_idx ON retainer_amendments(retainer_id, status);

ALTER TABLE retainers
  ADD CONSTRAINT retainers_pending_amendment_id_fkey
  FOREIGN KEY (pending_amendment_id) REFERENCES retainer_amendments(id);

-- ─────────────────────────────────────────
-- retainer_funding_events
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_funding_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retainer_id       UUID        NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  funded_by         TEXT        NOT NULL REFERENCES profiles(public_key),
  amount_xlm        NUMERIC(20,7) NOT NULL CHECK (amount_xlm > 0),
  contract_tx_hash  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retainer_funding_events_retainer_idx ON retainer_funding_events(retainer_id);

-- ─────────────────────────────────────────
-- retainer_statements
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retainer_statements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retainer_id           UUID        NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
  period_id             UUID        NOT NULL UNIQUE REFERENCES retainer_periods(id) ON DELETE CASCADE,
  invoice_number        TEXT        NOT NULL UNIQUE,
  freelancer_address    TEXT        NOT NULL REFERENCES profiles(public_key),
  client_address        TEXT        NOT NULL REFERENCES profiles(public_key),
  logged_hours          NUMERIC(9,2) NOT NULL DEFAULT 0,
  approved_hours        NUMERIC(9,2) NOT NULL DEFAULT 0,
  disputed_hours        NUMERIC(9,2) NOT NULL DEFAULT 0,
  forfeited_hours       NUMERIC(7,2) NOT NULL DEFAULT 0,
  rollover_hours        NUMERIC(7,2) NOT NULL DEFAULT 0,
  amount_due_xlm        NUMERIC(20,7) NOT NULL,
  amount_released_xlm   NUMERIC(20,7) NOT NULL,
  shortfall_xlm         NUMERIC(20,7) NOT NULL DEFAULT 0,
  status                TEXT        NOT NULL DEFAULT 'issued'
                                     CHECK (status IN ('issued', 'underfunded', 'settled_prorata')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retainer_statements_retainer_idx ON retainer_statements(retainer_id);

-- ─────────────────────────────────────────
-- time_entries: connect existing time tracking to retainer billing
-- ─────────────────────────────────────────
ALTER TABLE time_entries ALTER COLUMN job_id DROP NOT NULL;

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS retainer_id        UUID REFERENCES retainers(id) ON DELETE CASCADE;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS retainer_period_id UUID REFERENCES retainer_periods(id) ON DELETE CASCADE;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approval_status    TEXT
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'disputed', 'rejected'));
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approved_by        TEXT REFERENCES profiles(public_key);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS approved_at        TIMESTAMPTZ;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS dispute_reason     TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS resolved_by        TEXT REFERENCES profiles(public_key);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS resolved_at        TIMESTAMPTZ;

ALTER TABLE time_entries
  ADD CONSTRAINT time_entries_billing_construct_chk
  CHECK (job_id IS NOT NULL OR (retainer_id IS NOT NULL AND retainer_period_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS time_entries_retainer_idx        ON time_entries(retainer_id);
CREATE INDEX IF NOT EXISTS time_entries_retainer_period_idx ON time_entries(retainer_period_id);
