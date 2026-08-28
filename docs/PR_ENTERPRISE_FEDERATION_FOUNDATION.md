# PR: Enterprise federation foundation (phase 1 of issue #317)

## Summary

This is the first independently mergeable slice of #317. It adds the tenant,
identity-provider, federated-identity, replay, signing-binding and authentication
audit foundations without changing the existing wallet/WebAuthn login path.

## What changed

- Added reversible `V22__enterprise_federation_foundation` migrations.
- Added cross-tenant database constraints and single-use authentication/replay
  records.
- Added domain-separated HMAC blind indexes for external subjects and protocol
  one-time values.
- Added a shared SAML/OIDC adapter/principal contract and allowlisted JIT
  attribute mapping.
- Added explicit lifecycle state machines for membership, provider, identity and
  signing bindings.
- Added a fail-closed transaction-authorisation policy proving that SSO alone is
  insufficient to move escrowed funds.
- Documented architecture, wallet risk decision, deprovisioning limits, data
  model, migration/rollback and the remaining phased delivery in ADR-012.

## Compatibility and rollout

The migration is additive. No routes are mounted, no provider is enabled, JWT
contents do not change and individual wallet/passkey users keep the same
behavior. The down migration removes the unpopulated foundation in reverse
dependency order; `RESTRICT` prevents silent data loss after later phases begin
using it.

## Security decisions

- Linked personal wallets are the first signing model.
- Passkey account contracts remain a supported later binding type.
- Platform-custodied employee keys are excluded.
- Provider subjects and protocol one-time values are stored only as keyed blind
  indexes.
- IdP-initiated SAML remains disabled by default and does not weaken signing.
- A deprovisioned membership is terminal and immediately fails the transaction
  policy, even if an old session and signing proof are presented.

## Validation

- Federation unit/security tests
- Named migration apply/rollback tests
- Backend unit suite and lint
- Repository formatting and merge-policy checks

## Follow-up sequence

1. SAML SP metadata, signed/encrypted assertion validation and JIT
2. OIDC authorization code + S256 PKCE
3. Wallet/passkey transaction authority and reassignment
4. SCIM Users/Groups/Bulk and deprovisioning
5. Enforced SSO, session/domain controls and audit APIs

References #317. Related organisation/RBAC work: #255.
