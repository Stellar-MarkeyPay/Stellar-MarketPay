# W3C Verifiable Credentials & DIDs — design comment

I am claiming this work. This design comment is committed before implementation
so the subsystem can be reviewed and landed as independently releasable changes.

## Why this exists

Credentials that exist only inside this platform — verified skills, completed
work history, platform certifications — lock a freelancer's reputation in.
That is bad for the user and, in the long run, bad for the platform's
credibility as neutral infrastructure. W3C Verifiable Credentials and DIDs
make that history portable and independently verifiable.

The existing `routes/verification.js`, `routes/certificates.js`, and the
contract's `mint_certificate` entrypoint produce credentials that have no
portability story. This subsystem gives every credential a portable,
cryptographically verifiable form.

## Goals and boundaries

1. **DIDs**: a DID method bound to Stellar accounts so that control of the
   account proves control of the identifier, with key rotation that preserves
   continuity.
2. **Issuance**: W3C VC data model credentials for completed engagements,
   verified skills, and platform certifications, with Data Integrity proofs
   anchored on-chain via `mint_certificate`.
3. **Wallet**: holder wallet where a user controls their credentials and
   discloses claims selectively.
4. **Interoperability**: credentials verify with third-party tooling (not only
   ours), and externally issued credentials can be imported.
5. **Trust model**: documented in terms a verifier can act on.

This subsystem does not:
- Replace the existing verification/certificates routes (they remain for
  backward compatibility during migration).
- Provide a custodial wallet (the user holds their own keys).
- Implement cross-chain bridging.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Verifier (external)                          │
│  resolves DID → gets DID document → verifies Data Integrity     │
└──────────────────────────────┬──────────────────────────────────┘
                               │ DID Resolution / VC Verification
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Platform (this system)                       │
│                                                                 │
│  routes/dids.js           ← DID create, update, resolve, rotate│
│  routes/credentials.js    ← Issue, revoke, list, export        │
│  routes/wallet.js         ← Holder wallet, presentations       │
│  routes/verifier.js       ← External verifier verification API │
│                                                                 │
│  services/didService.js           ← DID CRUD, resolution, cache│
│  services/credentialService.js     ← VC issuance, status, export│
│  services/walletService.js         ← Holder operations          │
│  services/presentationService.js   ← VP creation, verification  │
│  services/statusListService.js     ← Bitstring status list      │
│                                                                 │
│  lib/did-stellar.js       ← DID method definition + resolver   │
│  lib/vcProof.js           ← Data Integrity proof create/verify │
│  lib/credentialSchema.js  ← VC JSON Schema definitions         │
│                                                                 │
│  db/migrations/V18__verifiable_credentials.up.sql              │
│  db/migrations/V18__verifiable_credentials.down.sql            │
└──────────────────────────────┬──────────────────────────────────┘
                               │ mint_certificate (on-chain)
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  Soroban: certificates.rs                                      │
│  anchor_credential(credential_hash) → ledger entry              │
└─────────────────────────────────────────────────────────────────┘
```

## DID method: did:stellarmarket

### Method identifier

```
did:stellarmarket:<stellar-public-key>
```

Example: `did:stellarmarket:GA5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O`

### Method specification

- **Method name**: `stellarmarket`
- **Method-specific identifier**: the Stellar public key (ed25519, 56 chars
  starting with G)
- **Verification method**: `Ed25519VerificationKey2020`
- **Controller**: the Stellar account itself (control of account = control of DID)

### DID Document

```json
{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1"
  ],
  "id": "did:stellarmarket:GA5...",
  "controller": "did:stellarmarket:GA5...",
  "verificationMethod": [{
    "id": "did:stellarmarket:GA5...#key-1",
    "type": "Ed25519VerificationKey2020",
    "controller": "did:stellarmarket:GA5...",
    "publicKeyMultibase": "zG4..."
  }],
  "authentication": ["#key-1"],
  "assertionMethod": ["#key-1"],
  "capabilityDelegation": [],
  "keyAgreement": [],
  "service": []
}
```

### Key rotation

Key rotation is supported through a DID Document version history stored in
PostgreSQL. Rotation requires a signed update operation authenticated by the
current key. The DID identifier (Stellar public key) never changes; only the
keys within the DID Document change.

Rotation flow:
1. Holder signs a `rotateKey` request with their current private key.
2. Platform verifies the signature against the current DID Document.
3. Platform updates the DID Document with the new key, increments version.
4. Previous key is deactivated (not deleted — verifiers may need to verify
   credentials signed with the old key).
5. Rotation event is logged in the audit trail.

### Resolution

Resolution path:
1. Parse `did:stellarmarket:<key>`.
2. Look up cached DID Document in PostgreSQL (`did_documents` table).
3. If cache hit and not expired (TTL = 5 minutes), return cached.
4. If miss or expired, reconstruct the DID Document from the current key
   state and rotation history.
5. Store/renew cache.

Trust model: the platform is the authoritative resolver for DIDs created on
the platform. DIDs can also be resolved by any party who reads the Stellar
ledger and applies the same reconstruction rules, making resolution
decentralisable in principle. The cache is a performance optimisation, not a
trust dependency.

## Credential issuance

### Credential types

| Type                    | Issuer claim                      | On-chain anchor |
| ----------------------- | --------------------------------- | --------------- |
| `EngagementCredential`  | "Subject completed engagement X"  | Yes             |
| `SkillCredential`       | "Subject has verified skill S"    | No              |
| `CertificationCredential`| "Subject holds certification C"  | Yes             |

### Data model (W3C VC Data Model 2.0)

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://www.w3.org/2018/credentials/examples/v1"
  ],
  "type": ["VerifiableCredential", "EngagementCredential"],
  "issuer": "did:stellarmarket:GA5...",
  "issuanceDate": "2026-08-28T00:00:00Z",
  "credentialSubject": {
    "id": "did:stellarmarket:GB6...",
    "engagementTitle": "Build Soroban escrow contract",
    "completedAt": "2026-08-15T00:00:00Z",
    "rating": 5
  },
  "credentialStatus": {
    "id": "https://api.stellar-marketpay.com/api/credentials/status/123",
    "type": "BitstringStatusList2021",
    "statusListIndex": "42",
    "statusListCredential": "did:stellarmarket:GA5...#status-list"
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "created": "2026-08-28T00:00:00Z",
    "verificationMethod": "did:stellarmarket:GA5...#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z58DAdF..."
  }
}
```

### Proof format: Data Integrity with EdDSA-JCS-2022

Chosen over JWT-based VC proofs because:
- The proof is embedded in the credential (self-contained, no external context).
- `EdDSA-JCS-2022` (Ed25519 + JSON Canonicalization Scheme) is the W3C
  recommended suite for EdDSA-based Data Integrity.
- The same key material signs VCs as signs DID operations, so one key pair
  serves all platform identity functions.
- JCS canonicalisation produces deterministic JSON, making proof verification
  independent of serialization differences.

### Revocation: Bitstring Status List 2021

Privacy-respecting revocation using W3C Bitstring Status List:
- Each credential is assigned a bit position in a status list.
- The status list is itself a Verifiable Credential issued by the platform.
- Verifiers fetch the status list credential and check the bit at the
  credential's position.
- This does **not** leak which specific credential was verified, because the
  status list is fetched in bulk (a verifier typically caches the whole list).

Status list credentials are stored in `credential_status_lists` and served
from `GET /api/credentials/status-list/:id`.

### On-chain anchoring

For `EngagementCredential` and `CertificationCredential`, the credential hash
(credentialId → SHA-256 of the canonicalised credential without proof) is
anchored on-chain via `mint_certificate`. This provides an immutable, publicly
verifiable timestamp and proof that the platform issued the credential at a
specific ledger sequence.

The Soroban contract stores:
```
certificate { credential_hash: BytesN<32>, issuer: Address, issued_at: u64 }
```

## Wallet

### Holder wallet

The wallet stores credentials issued to the user's DID. It supports:
- Listing held credentials with type, issuer, issuance date, and status.
- Exporting a credential as a signed VC JSON.
- Creating verifiable presentations (VPs) with selective disclosure.
- Importing credentials issued by external platforms.
- Backup and recovery (encrypted export/import of the wallet).

### Selective disclosure via Derived Credential

For selective disclosure, the wallet creates a derived credential that includes
only the requested claims. The derived credential:
1. References the original credential via `credentialSchema` and
   `originalCredentialId`.
2. Includes only the disclosed claims.
3. Is signed by the platform (issuer) as a new VC, so the verifier can verify
   it independently.
4. The original credential is not included in the presentation.

This approach does not use BBS+ signatures (which would allow disclosure from
a single signed credential) because BBS+ is not yet a W3C-recommended
cryptosuite and adds significant implementation complexity. The derived
credential approach is simpler, interoperable with all W3C verifiers, and
still achieves the goal of sharing only needed claims.

### Verifiable Presentations

```json
{
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  "type": ["VerifiablePresentation"],
  "holder": "did:stellarmarket:GB6...",
  "verifiableCredential": [{ ...derived credential... }],
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "verificationMethod": "did:stellarmarket:GB6...#key-1",
    "proofPurpose": "authentication",
    "proofValue": "z..."
  }
}
```

### Presentation requests (DIDComm-style)

External verifiers can initiate presentation requests via:
```
POST /api/verifier/presentation-request
{
  "verifierDid": "did:stellarmarket:GABC...",
  "callbackUrl": "https://verifier.example/callback",
  "requestedCredentials": [{
    "type": "EngagementCredential",
    "requiredClaims": ["engagementTitle", "completedAt"],
    "constraints": { "issuer": "did:stellarmarket:GA5..." }
  }],
  "nonce": "random-nonce",
  "expiresAt": "2026-08-28T01:00:00Z"
}
```

The user is redirected to the wallet UI, reviews the request, selects
credentials, and the platform creates a signed VP and POSTs it to the
callback URL.

## External verifier

```
POST /api/verifier/verify
{
  "credential": { ... VC JSON ... },
  "options": {
    "purpose": "assertionMethod",
    "domain": "verifier.example.com"
  }
}
```

The verifier endpoint:
1. Resolves the issuer DID.
2. Fetches/verifies the DID Document and public key.
3. Verifies the Data Integrity proof on the credential.
4. Checks the credential status (revocation) against the status list.
5. Validates the credential schema.
6. Returns verification result with detailed breakdown.

The endpoint does not require an API key — it is a public service, because
the whole point of VCs is that anyone can verify without an account.

## Trust model (documented for verifiers)

When a verifier accepts a platform-issued credential, they are trusting:

1. **The issuer DID resolves to a DID Document controlled by this platform.**
   Resolution can be independently verified: any party who reads the Stellar
   ledger and applies the reconstruction rules gets the same DID Document.

2. **The platform's private key has not been compromised.** The platform signs
   VCs with an Ed25519 key that is rotation-capable and auditable. Key
   compromise is mitigated by the platform's HSM-backed key management and
   the ability to rotate keys.

3. **The claims in the credential are accurate at issuance time.** The platform
   attests that it verified the information through its own compliance and
   verification processes. The trust boundary is the platform's identity
   assurance system (see `COMPLIANCE_DESIGN_COMMENT.md`).

4. **Revocation status is current.** A credential's revocation status is
   checked against the platform's status list. The verifier should check status
   at or near the time of verification.

What a verifier is **not** trusting:
- That the credential holder is the person named in it (authentication is a
  separate concern from the credential's accuracy).
- That the claims remain true after issuance (credentials can expire).
- Any specific compliance or screening outcome beyond what the credential
  explicitly states.

## Data model — PostgreSQL tables

### did_documents
- `id` (uuid, PK)
- `did` (text, unique) — the full DID string
- `controller` (text) — Stellar public key of the controller
- `document` (jsonb) — the full DID Document
- `version` (integer) — monotonically increasing
- `created_at`, `updated_at` (timestamptz)
- `deactivated` (boolean, default false)

### did_key_history
- `id` (uuid, PK)
- `did_id` (uuid, FK → did_documents)
- `key_id` (text) — fragment identifier, e.g. `#key-1`
- `public_key_multibase` (text)
- `key_type` (text) — `Ed25519VerificationKey2020`
- `activated_at`, `deactivated_at` (timestamptz)
- `rotation_reason` (text)

### verifiable_credentials
- `id` (uuid, PK)
- `credential_id` (text, unique) — deterministic ID from issuer + subject + type + issuance
- `issuer_did` (text, FK → did_documents.did)
- `subject_did` (text)
- `type` (text[]) — e.g. `{VerifiableCredential, EngagementCredential}`
- `claims` (jsonb) — the credential subject claims
- `credential` (jsonb) — the full signed VC JSON
- `proof_value` (text) — the proof value
- `status_list_index` (integer)
- `status_list_id` (uuid, FK → credential_status_lists)
- `revoked` (boolean, default false)
- `revoked_at` (timestamptz)
- `on_chain_anchored` (boolean, default false)
- `on_chain_tx_hash` (text)
- `schema_name` (text) — e.g. `EngagementCredential`
- `schema_version` (text)
- `issued_at` (timestamptz)
- `expires_at` (timestamptz)
- `created_at`, `updated_at` (timestamptz)

### credential_status_lists
- `id` (uuid, PK)
- `issuer_did` (text)
- `list_index` (integer)
- `bitstring` (bytea) — the status bitstring
- `credential` (jsonb) — the status list VC
- `version` (integer)
- `created_at`, `updated_at` (timestamptz)

### credential_presentations
- `id` (uuid, PK)
- `holder_did` (text)
- `presentation` (jsonb) — the full signed VP
- `requested_by` (text) — verifier DID if from a presentation request
- `purpose` (text)
- `created_at` (timestamptz)

### credential_imports
- `id` (uuid, PK)
- `holder_did` (text)
- `external_issuer_did` (text)
- `credential` (jsonb) — the imported VC
- `verification_status` (text) — `verified`, `unverified`, `expired`
- `imported_at` (timestamptz)

### presentation_requests
- `id` (uuid, PK)
- `verifier_did` (text)
- `callback_url` (text)
- `requested_credentials` (jsonb)
- `nonce` (text, unique)
- `status` (text) — `pending`, `fulfilled`, `expired`, `declined`
- `holder_did` (text)
- `created_at`, `expires_at` (timestamptz)

## Merge sequence

1. **Design and schema** — this comment, additive migration, DID method
   definition, resolution, and DID CRUD routes + tests.
2. **Issuance** — credential issuance, status lists, on-chain anchoring,
   revocation, and issuance routes + tests.
3. **Wallet** — holder wallet, selective disclosure, verifiable presentations,
   and wallet routes + tests.
4. **Interoperability** — external verifier, external credential import,
   presentation request protocol, trust model docs, and integration tests.

Each step keeps existing routes working, has a down migration, and leaves
`main` releasable. No existing endpoint's request or response shape changes.

## Verification plan

- Unit tests for DID document construction, resolution, cache expiry, key
  rotation, and deactivation.
- Unit tests for VC creation, proof generation, proof verification, schema
  validation, and status list bit operations.
- Unit tests for presentation creation, selective disclosure, and presentation
  verification.
- Integration tests for the full lifecycle: create DID → issue credential →
  hold in wallet → create presentation → verify presentation.
- Negative tests: tampered credentials, expired presentations, revoked
  credentials, wrong key material, replay attacks.
- Policy engine compliance: new backend routes arrive with a test file
  (`new-module-tests` rule), no secrets in source, no wall-clock assertions.
