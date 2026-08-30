# ADR-012: Enterprise Federation and Transaction Authority Separation

**Status:** Accepted for phased delivery
**Date:** 2026-08-28
**Issue:** [#317](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/issues/317)
**Related:** [#255](https://github.com/Stellar-MarkeyPay/Stellar-MarketPay/issues/255)

## Context

MarketPay currently treats a Stellar public key as both a login identity and
the authority that signs escrow transactions. Enterprise identity providers
solve a different problem: they tell the platform which employee has passed
an organisation's authentication policy. Treating that assertion as a wallet
credential would collapse two trust boundaries and let an identity-provider
compromise become a funds compromise.

Issue #317 therefore has two independent axes:

1. federation and lifecycle management (SAML, OIDC, JIT and SCIM); and
2. possession-based authority to sign a specific Stellar transaction.

Issue #255 owns the broader organisation/RBAC product. It has not landed yet.
This foundation supplies only the minimum additive organisation and membership
seam required to scope federation records. It does not claim to implement the
permission matrix, invitations, organisation UI or organisation-owned escrow
work tracked by #255. The `role_key` column is intentionally an opaque key that
can become a foreign key to that epic's role catalogue without rewriting
federated identities.

The required design/claim comment was posted on #317 before this branch was
created. This ADR turns that review proposal into a repository-owned decision
record and describes the migration and rollback boundaries for each phase.

## Decision

### 1. Keep authentication identity separate from signing authority

A successful SAML or OIDC response creates an authenticated **membership
session**, not a Stellar signer. A federated membership may have no linked
profile or wallet at all. Escrow-sensitive actions require all of:

- an active organisation, membership and federated identity;
- an unexpired session and fresh organisation reauthentication;
- an active, transaction-enabled signing binding; and
- fresh proof from that binding, bound to the exact transaction hash.

`transactionAuthorization.js` encodes this intersection as a fail-closed pure
policy. The regression test begins from the most important negative case: a
valid SSO session with no signing credential is denied.

The first supported signing arrangement will be a **linked personal wallet**.
The member proves control when linking it and continues to sign each Stellar
transaction in the wallet. A **passkey account contract** is the second
supported arrangement once its on-chain verification and recovery rules are
available. A platform-custodied employee key is deliberately not in the schema
enum: it would turn MarketPay into the key custodian, create a new recovery and
insider-risk system, and make IdP compromise materially closer to funds.

| Arrangement              | Authentication             | Transaction proof                              | Main risk                                           | Decision                               |
| ------------------------ | -------------------------- | ---------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| Linked wallet            | SSO + organisation session | Wallet signs exact transaction                 | Member key loss / offboarding hand-off              | First implementation                   |
| Passkey account contract | SSO + organisation session | Passkey/account contract authorises exact call | Contract recovery and device lifecycle              | Supported schema, later implementation |
| Platform custody         | SSO + organisation session | Platform-held key signs                        | IdP/platform compromise can become funds compromise | Excluded                               |

The backend policy is defense in depth; the Soroban contract remains the final
signature/authority boundary.

### 2. Normalise protocol output behind one adapter contract

SAML and OIDC handlers will implement the same narrow boundary:

```text
buildAuthenticationRequest(context) -> redirect/form + one-time state
consumeAuthenticationResponse(context) -> NormalizedFederatedPrincipal
```

The normalized principal includes protocol, organisation, provider, issuer,
immutable subject, response/assertion identifier, audience, authentication
context, timestamps and raw attributes. Protocol code must complete signature,
encryption, issuer, recipient/audience, time-window, nonce/state and replay
validation **before** constructing it. JIT mapping happens afterwards through
an explicit allowlist of target attributes. Wallet seeds, private keys and
arbitrary object paths are not mapping targets.

### 3. Use per-organisation provider records

Every provider belongs to exactly one organisation. Cross-organisation foreign
keys use `(organisation_id, id)` pairs where tenant confusion would otherwise
be possible. One organisation may have several SAML/OIDC providers but only one
non-retired default. Configuration is versioned and moves through
`draft -> enabled <-> disabled -> retired`; retirement is terminal.

Provider configuration is split into:

- `public_configuration`: endpoints, entity/client identifiers, certificates
  intended for metadata and other non-secret material;
- `credentials_envelope`: authenticated encryption envelope for client secrets,
  decryption keys and signing private keys; and
- `attribute_mapping`: explicit IdP-claim to platform-field mapping.

No protocol phase may write a plaintext secret to the public JSON column,
logs, audit metadata or assertions table.

### 4. Make one-time values non-recoverable and single-use

External subjects, SAML request/response/assertion IDs, OIDC state, nonce,
authorization code and ID-token fingerprints are stored as domain-separated
HMAC-SHA-256 blind indexes. `FEDERATION_HASH_KEY` is a dedicated 32-byte
production key, independent from JWT signing. The database stores no raw state,
nonce, authorization code or subject.

`federation_auth_transactions` stores a bounded authentication ceremony. A
pending row becomes succeeded, failed or cancelled exactly once and records a
consumption timestamp. `federation_replay_keys` uses a primary key across
provider, key type and hash so concurrent duplicates lose atomically at the
database boundary rather than relying on an in-process cache.

Secrets that must be recovered briefly, such as an OIDC PKCE verifier, belong
in `secret_envelope` with authenticated encryption and authentication-
transaction context as AAD. A later protocol PR adds that keyring implementation
before writing any such value.

### 5. Treat IdP-initiated SAML as a separate, opt-in flow

Unsolicited responses lack an SP-created request to correlate. They are disabled
per provider by default. When enabled, the SAML phase will require:

- a configured organisation/provider selected from trusted issuer metadata,
  never from an arbitrary RelayState URL;
- a signed response and signed assertion according to the configured policy;
- valid destination, recipient, audience, issuer and time restrictions;
- encrypted assertions where the organisation policy requires them;
- one-time response and assertion IDs committed atomically before login; and
- RelayState resolving only to a server-issued, same-origin destination token.

IdP-initiated login does not weaken transaction-signing requirements.

### 6. Make deprovisioning immediate off-chain and conservative on-chain

SCIM or administrator deprovisioning transitions the membership and every
federated identity to `deprovisioned`, revokes sessions and disables signing
bindings in one database transaction. Deprovisioned state is terminal; a later
rehire creates a new membership so audit history is not silently resurrected.

An active escrow may still name the employee's wallet on-chain. Removing a
database row cannot change that fact. The later wallet-reconciliation phase
will implement a controlled hand-off:

1. freeze new organisation-sensitive actions for the membership;
2. inventory owned jobs and in-flight escrow authority;
3. select a replacement who already has the required organisation permission
   and signing binding;
4. require independent organisation approval plus the contract-authorised
   signature/multisig path for reassignment; and
5. record each decision and on-chain transaction in the audit trail.

Until the contract supports a verified hand-off for a given escrow version,
that escrow remains operable only by its existing on-chain authority or its
documented dispute/timeout path. The platform must surface that condition; it
must not claim an off-chain reassignment moved on-chain power.

### 7. Record authentication events without raw identity material

`organisation_authentication_events` is an append-oriented organisation log.
It stores event/outcome, correlation ID and HMAC fingerprints for subject, IP
and user agent. Metadata is for bounded non-secret decision facts. Sequence and
hash fields allow the controls phase to implement tamper-evident chaining.
Rows use `RESTRICT`, not identity cascades, so deprovisioning does not erase the
record of who authenticated or was denied.

## Data model

| Table                                | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `organisations`                      | Minimal tenant boundary shared with future #255 work       |
| `organisation_memberships`           | Stable corporate principal; optional linked profile/wallet |
| `organisation_identity_providers`    | Versioned per-tenant SAML/OIDC configuration               |
| `federated_identities`               | Provider subject blind index mapped to one membership      |
| `federation_auth_transactions`       | Expiring, single-consumption login ceremony                |
| `federation_replay_keys`             | Atomic response/assertion/code/token replay barrier        |
| `federated_signing_bindings`         | Explicit wallet/passkey authority, disabled by default     |
| `organisation_authentication_events` | Tenant-scoped authentication audit history                 |

Important constraints:

- identity provider, identity, membership and audit references cannot cross an
  organisation boundary;
- a live profile can have only one non-deprovisioned membership per
  organisation;
- a provider subject is unique within its provider;
- only one active primary signing binding exists per membership;
- `transaction_enabled` requires an active, verified binding; and
- deprovisioned membership/identity rows require a timestamp.

## Migration plan

### PR 1 — foundation (this change)

- Add the tables above through `V22__enterprise_federation_foundation`.
- Add protocol-neutral principal, attribute-mapping, blind-index, lifecycle and
  transaction-authorisation primitives.
- Do not mount routes, change JWTs or enable SSO. Existing users are unchanged.

Rollback is safe while the foundation is unpopulated: apply the down migration,
which drops tables in reverse dependency order. `RESTRICT` makes later data a
visible stop condition rather than silently deleting identity/audit records.

### PR 2 — SAML service provider

- Add SP metadata and certificate rotation.
- Validate signed responses/assertions and decrypt encrypted assertions.
- Enforce audience/recipient/destination/time and atomic replay checks.
- Add opt-in IdP-initiated flow and JIT provisioning.

The phase remains disabled until a provider is explicitly enabled.

### PR 3 — OIDC relying party

- Discover issuer metadata from the configured issuer.
- Use authorization code flow with S256 PKCE, state and nonce.
- Validate issuer, audience, authorized party and token lifetime.
- Reuse the same identity/JIT and replay boundaries as SAML.

### PR 4 — wallet reconciliation

- Implement linked-wallet proof and transaction-bound sensitive-action proof.
- Integrate passkey account authority only after its contract boundary is
  specified and tested.
- Add controlled authority reassignment and risk-assessment evidence.

### PR 5 — SCIM

- Implement RFC 7643/7644 Users, Groups and Bulk resources.
- Make external IDs/idempotency keys tenant-scoped.
- Apply group-to-role updates and deprovision/reassignment transactionally.
- Return per-operation Bulk responses without rolling successful independent
  operations into an inconsistent aggregate state.

### PR 6 — enterprise controls

- Enforced SSO checks at every wallet/WebAuthn session-issuance and refresh
  boundary, not only the login UI.
- Absolute/idle/reauth session policy.
- Domain challenge verification and conflict handling.
- Organisation audit query/retention controls and security integration tests.

## Security invariants

1. SSO success alone never authorises an escrow transaction.
2. Tenant-selected identifiers never permit cross-organisation provider use.
3. Assertion, response, state, nonce, code and token replay is rejected
   atomically.
4. JIT provisioning maps only configured fields and never grants wallet
   authority.
5. Deprovisioning denies new sessions and sensitive actions immediately while
   preserving on-chain truth and audit history.
6. Direct wallet/WebAuthn login remains unchanged until enforced SSO is
   explicitly enabled; once enabled, the controls phase checks every session
   issuance/refresh path.

## Consequences

### Positive

- Protocol work has one normalized contract and one tenant/replay model.
- The highest-risk wallet question is decided before login handlers exist.
- Existing individual accounts remain releasable throughout the sequence.
- Blind indexes and encrypted envelopes avoid building a raw-assertion archive.

### Negative

- The minimal organisation seam overlaps the data-model portion of #255 and
  must be evolved jointly when that epic lands.
- Off-chain deprovisioning cannot retroactively replace a signer in an existing
  contract. Contract-version-specific reassignment work remains mandatory.
- Audit hash chaining, envelope key rotation and session revocation are schema
  hooks in this foundation, not active behavior until their named phases land.
