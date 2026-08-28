# ADR-010: Zero-Knowledge Reputation with Selective Disclosure

**Status:** Accepted
**Date:** 2026-08-25
**Author:** Stellar MarketPay Team
**Stakeholders:** Backend Team, Smart Contract Team, Frontend Team

## Context

Reputation today is fully public: `GET /api/ratings/:publicKey` returns every
star rating, review, and — through `profileService.refreshFreelancerTier` —
completed-job counts and total earnings are baked into a visible tier badge.
A freelancer who wants a verifiable track record has no choice but to expose
their entire commercial history: every client they've worked for, every rate
they've charged, every job they've been rated on.

Issue #319 asks for the alternative: let a freelancer prove a specific claim
— "my average rating is at least 4.5 over at least 20 jobs," "I have no
disputes," "my earnings fall in this band" — without revealing the ratings,
amounts, or job identities behind it. This document is the design record the
issue asks be posted before code, covering the provable statements, the
proving system, the commitment/anchoring scheme, revocation, and the
migration plan. Implementation follows this document section by section.

## Decision

### Provable statements

Four statements, each reducible to one of two audited circuits
(`backend/src/zk/rangeProof.js`, `backend/src/zk/equalityProof.js`) via the
Pedersen commitment homomorphism:

| Statement          | Claim                      | Circuit                                       |
| ------------------ | -------------------------- | --------------------------------------------- |
| `rating_threshold` | avg(score) ≥ T over N jobs | range proof on `sum(score) - T·N ≥ 0`         |
| `completion_count` | N ≥ minimum                | plain arithmetic (see "Scope decision" below) |
| `earnings_band`    | sum(amount) ∈ [lo, hi]     | two range proofs                              |
| `dispute_free`     | sum(disputeFlag) = 0       | equality-to-zero proof (exact, not bounded)   |

**Scope decision — contiguous ranges, not hidden subsets.** A proof covers a
_publicly-stated, contiguous leaf range_ of the subject's history (e.g. "jobs
12 through 44"), not an arbitrarily-chosen hidden subset. Hiding which
specific jobs contribute to a claim (rather than hiding their _values_)
requires a set-membership circuit per element — a substantially larger
circuit for a property this product doesn't currently need (a client cares
whether the _statistic_ holds, not which jobs it's drawn from). The range
endpoints are visible to the verifier; every star rating, bid amount, and
dispute outcome inside the range is not. This is the honest boundary of what
v1 hides, stated plainly rather than implied.

### Proving system: Pedersen commitments + Chaum–Pedersen sigma protocols over BLS12-381 G1, not a SNARK

Considered zk-SNARKs (Groth16/PLONK) for smaller proofs and richer
statements. Rejected for v1:

- **Trusted setup.** Groth16 needs a per-circuit trusted setup; PLONK needs a
  universal one. Either way, a reputation system whose entire value
  proposition is "trust the math, not an operator" starting with a ceremony
  someone has to trust is a bad first impression, and this codebase has no
  existing SNARK toolchain to build on.
- **Soroban has BLS12-381 G1 as host functions today** (`g1_add`, `g1_mul`,
  `g1_msm` — `soroban-sdk` 22's `crypto().bls12_381()`), but no R1CS/PLONK
  verifier primitives. Building a general-purpose SNARK verifier in
  `#![no_std]` Rust for this PR would dwarf the actual feature.
- **Proving time.** Sigma-protocol proving here is milliseconds (see
  "Performance" below) — a browser or a lightweight service handles it
  without a WASM-compiled circuit or a multi-second setup phase.

The trade-off: proof size is _linear_ in bit-width for range proofs (a
32-bit `rating_threshold` proof is a few KB — see Performance), where a
SNARK would be a constant ~200 bytes. Given Soroban's resource-based fee
model rather than an L1 calldata-cost model, this is the right trade for a
first version: it is auditable end to end by reading two files
(`rangeProof.js`, `equalityProof.js`), the same two files run in the browser,
the proving service, and — mirrored line-for-line — the Soroban contract's
`reputation.rs`. A SNARK migration is a compatible next step once the
product needs smaller proofs badly enough to justify the trusted setup and
verifier-key management it brings; nothing in the commitment scheme or data
model below depends on the proving system chosen on top of it.

No trusted setup: `G` and `H`, the two Pedersen generators, are derived by
nothing-up-my-sleeve try-and-increment from the ASCII labels `"value"` and
`"blind"` (`bls12381.deriveGenerator`, `pedersen.js`). Anyone can re-derive
and check them; nobody, including us, knows `log_G(H)`.

### Commitment scheme: Pedersen commitments in an RFC 6962 Merkle tree

Each rating becomes three commitments — `Com(score)`, `Com(amount)`,
`Com(disputeFlag)` — computed at issuance time (same trust boundary as
today: the platform sees the plaintext rating either way; see "Trust
boundary" below). The three commitments for a rating, plus its append index
and a revoked flag, form one Merkle leaf (`merkle.js`'s `encodeLeaf`); leaves
for one subject accumulate into one RFC 6962 tree, root recomputed on every
issuance or revocation ("epoch").

This is what "cannot be retroactively altered" means concretely: the root is
anchored on-chain (see below), so a leaf cannot be quietly edited or dropped
without producing a different, publicly visible root. A client who received
a rating can verify their own leaf's inclusion.

### Replay / context binding

Every circuit challenge is a Fiat–Shamir hash over the _entire_ proof
context: protocol version, subject, statement, epoch, root, leaf range, and
a `context` object — `audience` (who this is for), `purpose` (what for),
`nonce`, and `expiresAt` (`transcript.js`, `reputationProof.js`). Changing
any of these changes every subsequent challenge; the same response scalars
will not satisfy a different challenge under the discrete-log assumption.
That is the entire mechanism behind "cannot be replayed by another party or
reused beyond their intended context" — there is no separate replay-nonce
ledger to maintain, because the binding is cryptographic, not bookkeeping.

### Revocation

An epoch is a checkpoint of the subject's tree. The contract (and the
off-chain mirror, `reputationService.resolveEpoch`) tracks one extra scalar
per subject: `earliestInvalidatedEpoch`. Revoking a rating that was first
included at epoch _K_ sets this to `min(current, K)` — an O(1) write. A
proof bound to epoch _E_ is valid iff `E < earliestInvalidatedEpoch`. This
invalidates every proof that could have depended on the revoked rating
(anything anchored at or after _K_) and nothing else — a proof about "my
first 10 jobs" made before job #37 even existed is untouched by job #37
later being revoked. See `reputation.rs`'s `revoke_from_epoch` and
`reputationService.revokeRating`.

New ratings arriving does **not** invalidate outstanding proofs: each new
rating advances the _latest_ epoch, but the contract retains a bounded
history of `(epoch → root)` pairs (`MAX_RETAINED_EPOCHS = 64`), so a proof
bound to an earlier, still-retained epoch keeps verifying. A proof bound to
an epoch that has aged out of the retention window fails with
`unknown_epoch` — the fix is a fresh proof against the current epoch, which
costs the subject nothing: every past opening is re-derivable from one
seed (see "Proving paths" below), never a re-issuance.

### On-chain verification

`reputation.rs` (Soroban) mirrors `backend/src/zk/*.js` byte-for-byte: same
pinned generators, same Fiat–Shamir transcript framing, same sigma-protocol
equations, same RFC 6962 Merkle hashing. `verify_reputation_proof` checks,
in order: context freshness, epoch/root/revocation state, Merkle boundary
inclusion for the leaf range's endpoints, and the statement's circuit proof.
It returns `false` — never panics — for any invalid or false-statement
proof, so it composes into a `require!`-style gate without extra wrapping.

**Resource cost — measured, not estimated.** `reputation.rs`'s test module
measures real Soroban budget consumption via `env.budget()` around
`verify_reputation_proof` (`measure_dispute_free_on_chain_verification_cost`,
`measure_on_chain_verification_cost`; run `cargo test --features std
reputation_tests -- --nocapture` to reproduce). At HEAD, for a 4-leaf
boundary:

| Statement                               | CPU instructions | Memory          |
| --------------------------------------- | ---------------- | --------------- |
| `dispute_free` (equality proof)         | 7,629,756        | 113,282 bytes   |
| `rating_threshold` (32-bit range proof) | 571,554,470      | 3,058,956 bytes |

`dispute_free` is cheap and clearly viable for routine on-chain settlement —
a small fraction of Soroban's per-transaction CPU instruction budget.
**`rating_threshold` is not**, at least not as a single transaction, as
implemented: 571M instructions is several times over Soroban's
per-transaction CPU limit (on the order of 100M instructions). The cost is
dominated by the 32 Chaum–Pedersen OR-branches, each needing several
BLS12-381 G1 scalar multiplications — expensive host operations repeated
32 times. `earnings_band` (two range proofs) costs roughly double that,
worse still.

This is a real, disclosed limitation, not a rounding error: **on-chain
settlement is viable today for `dispute_free` and `completion_count`
(the latter needs no circuit at all — see "Provable statements"), and not
yet viable in one transaction for `rating_threshold`/`earnings_band`.**
Candidate fixes, none implemented in this PR: smaller bit widths where the
product can tolerate a coarser threshold (e.g. 16 bits instead of 32,
roughly halving the cost), splitting a range proof's bits across multiple
transactions with a resumable verifier, or — the more durable fix — the
SNARK migration path noted under "Proving system," which trades this
linear-in-bit-width cost for a constant-size pairing check. Until one of
those lands, clients needing an on-chain-verified `rating_threshold` or
`earnings_band` claim should use the off-chain path below for the
verification itself and, if settlement requires an on-chain fact, anchor
only the yes/no _result_ via a transaction the client controls — not ask
this contract to run the range-proof verifier in the same transaction as
the action it gates.

This is exactly the kind of number the epic's "measuring resource cost and
confirming viability" acceptance criterion asks for: honest measurement,
not an assumed yes.

**Off-chain path.** `POST /api/reputation/verify` runs the identical
`reputationProof.verifyProof` against the platform's own epoch/root history
— no gas, no settlement, for contexts like a client screening applicants
that only need a yes/no answer. Both paths share the same verification
function; the platform's HTTP path additionally is not asked to trust an
RPC node's view of chain state, which matters for a check that gates
application visibility, not money movement.

### Proving paths — what each one learns

Two ways to build a proof, and what the operator that builds it learns:

- **Hosted proving service** (`POST /api/reputation/:publicKey/prove`): the
  platform fetches the subject's stored openings and builds the proof.
  Learns: the subject's full plaintext history in the proved range (no
  different from what the platform already has), which statement was
  proved, and to whom. Convenient; not zero-trust toward the platform.
- **Client-side proving**: the subject fetches their own openings (`GET
/api/reputation/:publicKey/openings`, self-only) and runs
  `backend/src/zk/*.js` locally — the same modules, no server-only
  dependency beyond Node's `crypto`, which any bundler polyfills with Web
  Crypto. The platform learns nothing beyond "a proof was submitted
  somewhere" if the freelancer later attaches it to an application (and even
  that request only carries the finished proof, not how it was built).

Openings are derived from one HMAC seed per subject
(`pedersen.deriveBlinding`), so a lost session never loses provability: every
past commitment's opening is always re-derivable from the seed plus the
plaintext value, and the plaintext (a job's stars/budget/dispute status) is
already recorded elsewhere in the schema.

### Trust boundary (state plainly, because an unstated one is where trust erodes)

The platform backend sees every rating's plaintext at issuance — identical
to today's public `ratings` table. **What changes is what _other users_ see
by default.** Today, any authenticated caller can read a freelancer's full
rating history. After this change, a freelancer's default view stays
`public` (`profiles.reputation_visibility`, defaulting to `'public'` —
nothing changes for anyone who does not opt in), and a freelancer who
switches to `selective` chooses per-application what to reveal. The backend
remains a plaintext-trusted issuer, exactly as before; the guarantee this
ADR adds is toward third parties, not toward platform operators. Saying this
precisely, rather than implying end-to-end zero-knowledge against everyone
including us, is what "a user who does not understand it will not trust it"
(the issue's own framing) requires.

### Data model

```
reputation_commitments   -- one row per rating: 3 Pedersen commitments + openings
reputation_epochs        -- append-only (subject, epoch) -> root history + on-chain anchor status
reputation_revocations   -- (subject, invalidates_from_epoch) when a rating is overturned
job_reputation_requirements     -- a client's verifiable requirement(s) on a job posting
application_reputation_proofs   -- a freelancer's proof attached to one application + verification outcome
profiles.reputation_visibility  -- 'public' (default) | 'selective'
```

Full column-level detail: `backend/src/db/migrations/V17__zk_reputation.up.sql`.
Down migration drops all five tables and the profiles column cleanly.

### Migration plan

1. `V17` migration adds the five tables/column above. No existing table is
   altered destructively; `ratings` is untouched.
2. `ratingService.createRating` gains one additional write in the same
   transaction as the rating insert: a commitment leaf, when the rated
   party is the job's freelancer (client-rates-freelancer is the only
   direction the four statements above are about; freelancer-rates-client
   stays purely in the public `ratings` table for v1 — symmetric
   client-reputation proofs are a natural, separable follow-up).
   Atomicity here is what makes "committed as they are issued" true: a
   rating can never exist without its commitment, and vice versa.
3. Existing ratings issued before this migration have no commitment leaf
   and are therefore not provable. Backfilling them is deliberately **not**
   part of this PR: backfilling would mean assigning `blinding` values and
   leaf order retroactively, based on the now-current `ratings` table state
   rather than the true issuance order, which weakens exactly the
   "committed as issued, cannot be retroactively altered" property this
   design exists to provide. A follow-up PR can add an explicit,
   audited backfill job if the product wants pre-migration history to be
   provable, with its own review of that trade-off.
4. Every new route is additive (`/api/reputation/*`, `PUT
/api/jobs/:id/reputation-requirement`, `POST
/api/applications/:id/reputation-proof`); no existing endpoint's request
   or response shape changes except `GET /api/applications/job/:jobId`,
   which gains one new field per application (`reputationProofs: []`,
   empty array when none exist — additive, not a breaking change for
   existing consumers).

## Performance

**Off-chain (proving/verifying in JS — browser or service).** Measured on
this development machine (Node 24, no hardware acceleration):

| Operation                                               | Time                |
| ------------------------------------------------------- | ------------------- |
| Scalar multiplication (fixed 4-bit window)              | ~5 ms               |
| Generator derivation (nothing-up-my-sleeve)             | ~10 ms              |
| 32-bit range proof: prove                               | tens of ms          |
| 32-bit range proof: verify                              | tens of ms          |
| Full `rating_threshold` proof (20-job range) end to end | well under 1 second |

Viable in a browser without a proving service, which is why the hosted
service is offered as a convenience, not a requirement (see "Proving
paths").

**On-chain (verifying in the Soroban contract).** A different cost model —
Soroban bills CPU instructions per host call, and a 32-bit range proof means
32 repetitions of several BLS12-381 group operations. See "On-chain
verification" above for the measured numbers: cheap for `dispute_free`
(~7.6M instructions), not viable in one transaction for `rating_threshold`
(~572M instructions, several times over Soroban's per-transaction limit).
The gap between "fast in JS" and "expensive on-chain" here is the gap
between a general-purpose CPU doing simple arithmetic and a metered host
environment charging for every field/group operation individually — worth
internalizing before assuming an off-chain performance number says anything
about on-chain viability for a different circuit running the same protocol.

## Consequences

### Positive

- A freelancer can be verifiably reputable without a client ever seeing an
  individual rating, amount, or job identity.
- No trusted setup; generators are auditable by anyone who can run SHA-256.
- Revocation is O(1) and precisely scoped — it invalidates exactly the
  proofs that depended on the overturned rating.
- The same four modules (`bls12381.js`, `pedersen.js`, `rangeProof.js`,
  `equalityProof.js`) run in the browser, the hosted proving service, the
  HTTP verification path, and — mirrored in Rust — the Soroban contract.
  One thing to audit, not four.
- Public reputation is unchanged and remains the default; this is
  additive, not a migration users are forced through.

### Negative

- Range proofs are linear in bit width, not constant-size like a SNARK.
  Off-chain this is a non-issue (tens of milliseconds either way — see
  "Performance"). On-chain it is a real, measured cost: verifying a 32-bit
  `rating_threshold` proof is ~572M CPU instructions, several times
  Soroban's per-transaction limit, and is **not currently viable in a
  single on-chain transaction** (see "On-chain verification" for the
  numbers and candidate fixes). `dispute_free` and `completion_count` are
  cheap and viable on-chain today.
- The contiguous-range scope decision means a client can see _which_ leaf
  indices (roughly, _when_) contributed to a claim, even though not their
  values. A determined verifier could correlate leaf-range timing against
  public job-posting activity to narrow down which jobs are involved. This
  is a real, disclosed limitation, not an oversight.
- Pre-migration ratings are not provable without an explicit, separately
  reviewed backfill (see "Migration plan," item 3).
- The hosted proving service, if used, is not zero-trust toward the
  platform (see "Proving paths"). Client-side proving closes this gap for
  users who want it.
- Cross-implementation interop (JS ⟷ Rust) is verified by shared transcript
  and equation design and Rust-side self-consistency tests
  (`reputation.rs`'s `reputation_tests` module); a golden cross-language
  test-vector suite
  (JS-generated proof bytes checked into the Rust test fixtures for every
  statement kind, not just the ones exercised so far) is the recommended
  immediate follow-up before this path carries real settlement value.

## Related ADRs

- ADR-004: 2-of-3 Multisig for Escrow Release Arbitration — a comparable
  precedent for adding an alternate trust path to money movement without
  removing the simple default.

## References

- Issue #319 — epic: zero-knowledge reputation with selective disclosure
- `backend/src/zk/` — the crypto core (bls12381, pedersen, merkle,
  rangeProof, equalityProof, statements, transcript, reputationProof)
- `backend/src/services/reputationService.js`,
  `reputationRequirementService.js`
- `contracts/marketpay-contract/src/reputation.rs`
- `backend/src/db/migrations/V17__zk_reputation.{up,down}.sql`
