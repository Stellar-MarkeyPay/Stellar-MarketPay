-- Rollback for the additive, pre-enforcement federation foundation.
-- RESTRICT relationships make accidental removal visible if a later phase has
-- already populated dependent records; in that case deploy forward instead.

DROP TABLE IF EXISTS organisation_authentication_events;
DROP TABLE IF EXISTS federated_signing_bindings;
DROP TABLE IF EXISTS federation_replay_keys;
DROP TABLE IF EXISTS federation_auth_transactions;
DROP TABLE IF EXISTS federated_identities;
DROP TABLE IF EXISTS organisation_identity_providers;
DROP TABLE IF EXISTS organisation_memberships;
DROP TABLE IF EXISTS organisations;
