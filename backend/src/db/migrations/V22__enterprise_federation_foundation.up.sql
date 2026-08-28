-- Enterprise federation foundation (Issue #317).
--
-- This migration is deliberately additive. Existing wallet/WebAuthn users do
-- not acquire an organisation membership and their authentication path is not
-- changed. Protocol handlers and enforced SSO are enabled by later migrations.

CREATE TABLE IF NOT EXISTS organisations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE
                       CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$'),
  name                TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 160),
  status              TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'suspended', 'archived')),
  created_by_address  TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organisation_memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  profile_public_key  TEXT REFERENCES profiles(public_key) ON DELETE RESTRICT,
  role_key            TEXT NOT NULL DEFAULT 'member'
                       CHECK (role_key ~ '^[a-z][a-z0-9_.:-]{0,63}$'),
  status              TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'active', 'suspended', 'deprovisioned')),
  provisioning_source TEXT NOT NULL DEFAULT 'manual'
                       CHECK (provisioning_source IN ('manual', 'saml', 'oidc', 'scim')),
  deprovisioned_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  CHECK ((status = 'deprovisioned') = (deprovisioned_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_memberships_profile_idx
  ON organisation_memberships(organisation_id, profile_public_key)
  WHERE profile_public_key IS NOT NULL AND status <> 'deprovisioned';
CREATE INDEX IF NOT EXISTS organisation_memberships_profile_lookup_idx
  ON organisation_memberships(profile_public_key, status)
  WHERE profile_public_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS organisation_memberships_status_idx
  ON organisation_memberships(organisation_id, status);

CREATE TABLE IF NOT EXISTS organisation_identity_providers (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id             UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  protocol                    TEXT NOT NULL CHECK (protocol IN ('saml', 'oidc')),
  display_name                TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  issuer                      TEXT NOT NULL CHECK (char_length(issuer) BETWEEN 1 AND 2048),
  status                      TEXT NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'enabled', 'disabled', 'retired')),
  is_default                  BOOLEAN NOT NULL DEFAULT FALSE,
  jit_provisioning_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  idp_initiated_login_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  public_configuration        JSONB NOT NULL DEFAULT '{}'::jsonb
                               CHECK (jsonb_typeof(public_configuration) = 'object'),
  credentials_envelope        JSONB
                               CHECK (credentials_envelope IS NULL OR jsonb_typeof(credentials_envelope) = 'object'),
  attribute_mapping           JSONB NOT NULL DEFAULT '{}'::jsonb
                               CHECK (jsonb_typeof(attribute_mapping) = 'object'),
  configuration_version       INTEGER NOT NULL DEFAULT 1 CHECK (configuration_version > 0),
  created_by_membership_id    UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, protocol, issuer),
  FOREIGN KEY (organisation_id, created_by_membership_id)
    REFERENCES organisation_memberships(organisation_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS organisation_identity_providers_default_idx
  ON organisation_identity_providers(organisation_id)
  WHERE is_default AND status <> 'retired';
CREATE INDEX IF NOT EXISTS organisation_identity_providers_enabled_idx
  ON organisation_identity_providers(organisation_id, protocol)
  WHERE status = 'enabled';

CREATE TABLE IF NOT EXISTS federated_identities (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  provider_id           UUID NOT NULL,
  membership_id         UUID NOT NULL,
  external_subject_hash TEXT NOT NULL
                         CHECK (external_subject_hash ~ '^[0-9a-f]{64}$'),
  attributes_envelope   JSONB
                         CHECK (attributes_envelope IS NULL OR jsonb_typeof(attributes_envelope) = 'object'),
  status                TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'suspended', 'deprovisioned')),
  last_authenticated_at TIMESTAMPTZ,
  deprovisioned_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, external_subject_hash),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, provider_id)
    REFERENCES organisation_identity_providers(organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, membership_id)
    REFERENCES organisation_memberships(organisation_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'deprovisioned') = (deprovisioned_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS federated_identities_membership_idx
  ON federated_identities(organisation_id, membership_id, status);

CREATE TABLE IF NOT EXISTS federation_auth_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  provider_id         UUID NOT NULL,
  flow_direction      TEXT NOT NULL CHECK (flow_direction IN ('sp_initiated', 'idp_initiated')),
  request_id_hash     TEXT CHECK (request_id_hash IS NULL OR request_id_hash ~ '^[0-9a-f]{64}$'),
  state_hash          TEXT CHECK (state_hash IS NULL OR state_hash ~ '^[0-9a-f]{64}$'),
  nonce_hash          TEXT CHECK (nonce_hash IS NULL OR nonce_hash ~ '^[0-9a-f]{64}$'),
  secret_envelope     JSONB
                       CHECK (secret_envelope IS NULL OR jsonb_typeof(secret_envelope) = 'object'),
  redirect_uri        TEXT CHECK (redirect_uri IS NULL OR char_length(redirect_uri) <= 2048),
  outcome             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (outcome IN ('pending', 'succeeded', 'failed', 'cancelled')),
  expires_at          TIMESTAMPTZ NOT NULL,
  consumed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organisation_id, provider_id)
    REFERENCES organisation_identity_providers(organisation_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((outcome = 'pending') = (consumed_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS federation_auth_request_once_idx
  ON federation_auth_transactions(provider_id, request_id_hash)
  WHERE request_id_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS federation_auth_state_once_idx
  ON federation_auth_transactions(provider_id, state_hash)
  WHERE state_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS federation_auth_expiry_idx
  ON federation_auth_transactions(expires_at)
  WHERE outcome = 'pending';

CREATE TABLE IF NOT EXISTS federation_replay_keys (
  provider_id       UUID NOT NULL REFERENCES organisation_identity_providers(id) ON DELETE RESTRICT,
  key_type          TEXT NOT NULL
                    CHECK (key_type IN ('saml_response', 'saml_assertion', 'oidc_code', 'oidc_id_token')),
  value_hash        TEXT NOT NULL CHECK (value_hash ~ '^[0-9a-f]{64}$'),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider_id, key_type, value_hash),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS federation_replay_expiry_idx
  ON federation_replay_keys(expires_at);

CREATE TABLE IF NOT EXISTS federated_signing_bindings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  membership_id             UUID NOT NULL,
  profile_public_key        TEXT NOT NULL REFERENCES profiles(public_key) ON DELETE RESTRICT,
  signing_method            TEXT NOT NULL CHECK (signing_method IN ('linked_wallet', 'passkey_account')),
  credential_reference_hash TEXT NOT NULL
                             CHECK (credential_reference_hash ~ '^[0-9a-f]{64}$'),
  status                    TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'active', 'suspended', 'revoked')),
  is_primary                BOOLEAN NOT NULL DEFAULT FALSE,
  transaction_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at               TIMESTAMPTZ,
  revoked_at                TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organisation_id, membership_id)
    REFERENCES organisation_memberships(organisation_id, id) ON DELETE RESTRICT,
  UNIQUE (membership_id, signing_method, credential_reference_hash),
  CHECK (status <> 'active' OR verified_at IS NOT NULL),
  CHECK (status <> 'revoked' OR revoked_at IS NOT NULL),
  CHECK (NOT transaction_enabled OR (status = 'active' AND verified_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS federated_signing_primary_idx
  ON federated_signing_bindings(membership_id)
  WHERE is_primary AND status = 'active';
CREATE INDEX IF NOT EXISTS federated_signing_profile_idx
  ON federated_signing_bindings(profile_public_key, status);

CREATE TABLE IF NOT EXISTS organisation_authentication_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_sequence        BIGSERIAL NOT NULL UNIQUE,
  organisation_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  provider_id           UUID,
  membership_id         UUID,
  event_type            TEXT NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
  outcome               TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied', 'observed')),
  correlation_id        TEXT NOT NULL CHECK (char_length(correlation_id) BETWEEN 1 AND 160),
  subject_hash          TEXT CHECK (subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$'),
  source_ip_hash        TEXT CHECK (source_ip_hash IS NULL OR source_ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash       TEXT CHECK (user_agent_hash IS NULL OR user_agent_hash ~ '^[0-9a-f]{64}$'),
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  previous_event_hash   TEXT CHECK (previous_event_hash IS NULL OR previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash            TEXT NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organisation_id, provider_id)
    REFERENCES organisation_identity_providers(organisation_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organisation_id, membership_id)
    REFERENCES organisation_memberships(organisation_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS organisation_authentication_events_org_idx
  ON organisation_authentication_events(organisation_id, chain_sequence DESC);
CREATE INDEX IF NOT EXISTS organisation_authentication_events_correlation_idx
  ON organisation_authentication_events(correlation_id, created_at);
