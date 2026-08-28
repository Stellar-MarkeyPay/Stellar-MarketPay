# Escrow core v2 — design / claim comment

I am claiming this work. This comment is intentionally committed before the
implementation so the subsystem can be reviewed and landed as independently
releasable changes.

## Architecture

`lib.rs` remains the ABI compatibility façade while domain records, invariants,
and decisions are divided into bounded modules with explicit functions called
by the entrypoint wrappers:

- `escrow.rs`: v1-compatible records, v2 records, and settlement accounting.
- `state_machine.rs`: the complete shared lifecycle transition gate.
- `migration.rs`: additive storage access, exact v1 backup, and lazy migration.
- `milestones.rs`: named template definitions, validation, template reuse, and
  mutually-authorised amendment proposals.
- `streaming.rs`: per-ledger accrual, checkpointing, withdrawal, pause/resume,
  cancellation, and dispute interaction.
- `multisig.rs`: signer validation, distinct approvals, and threshold decisions.
- `arbitration.rs`: dispute/arbitration records and resolution helpers.
- `referrals.rs`, `ratings.rs`, and `certificates.rs`: their domain records and
  storage interfaces. Existing public calls remain available through the
  compatibility façade while code is moved.

Lifecycle changes go through one transition table. Its state is
`Locked | Active | Paused | Disputed | Released | Refunded | Cancelled` and its
events include start, pause/resume, dispute, milestone/final settlement, timeout,
refund, arbitration resolution, and cancellation.
`transition(from, event)` is the only place that decides whether an edge exists;
entrypoints provide authentication and domain inputs, then call the gate. This
keeps illegal edges centrally rejected and makes the complete graph auditable.
Legacy `EscrowStatus` is preserved at the ABI boundary and mapped to/from the v2
state for old entrypoints.

## Data model and accounting

The v2 escrow stores the original identities/token/deposit plus:

- a schema version and lifecycle state;
- settlement mode: `Discrete` or `Streaming`;
- `paid_to_freelancer`, `paid_as_fees`, and `refunded_to_client` counters;
- either a template snapshot or a stream schedule.

Every settlement maintains:

```text
deposit = contract_liability + paid_to_freelancer + paid_as_fees
          + refunded_to_client
```

Streaming uses cumulative entitlement, never a rounded per-ledger rate:

```text
vested(t) = floor(total * elapsed_active_ledgers(t) / duration_ledgers)
withdrawable(t) = vested(t) - withdrawn
```

The multiplication is checked and the final active ledger is a special exact
endpoint (`vested = total`). Pauses checkpoint active elapsed time before the
state changes. Resume resets the checkpoint ledger. Dispute uses the same
checkpoint operation and therefore stops accrual atomically. Cancellation first
settles the already-accrued amount to the freelancer and returns exactly the
unvested remainder to the client. Many small withdrawals and one terminal
withdrawal therefore have the same aggregate result; no fractional residue is
stored or compounded.

Milestone templates are immutable reusable definitions. A definition has a
name, ordered items, item names, acceptance-criteria hashes, amounts, and
deadlines. The documented bound is 20 items. An escrow takes a snapshot so
editing/replacing a reusable template never mutates an active agreement.
Mid-engagement amendments are proposals containing a replacement snapshot and
two independent approval flags. The client proposes and approves; the
freelancer separately approves. Activation occurs only after both signatures
and validation that completed/paid value is preserved and the outstanding item
amounts equal the remaining liability.

## Storage and migration

Existing `DataKey::Escrow(job_id) -> Escrow` data is not overwritten blindly.
v2 uses additive keys:

- `EscrowV2(job_id) -> EscrowV2`
- `MigrationBackup(job_id) -> Escrow` (the exact decoded v1 record)
- `V2MigrationStatus(job_id) -> Migrated | RolledBack`
- template, amendment, and stream keys in their owning modules.

On every v2 access, `load_v2(job_id)` first reads `EscrowV2`. If absent, it
reads the v1 key, maps status and accounting deterministically, stores the
unchanged v1 record as a rollback backup, writes v2, and marks migration done.
This is lazy and idempotent. The `upgrade` entrypoint continues replacing WASM
and bumping the version; no unbounded scan is added to an upgrade transaction.

Mid-lifecycle mapping is explicit:

| v1 state   | v2 state | remaining liability                         |
| ---------- | -------- | ------------------------------------------- |
| Locked     | Locked   | sum of incomplete milestones, or deposit    |
| InProgress | Active   | sum of incomplete milestones, or deposit    |
| Disputed   | Disputed | same as pre-dispute; no stream exists in v1 |
| Released   | Released | zero                                        |
| Refunded   | Refunded | zero                                        |

Completed v1 milestones become completed named snapshot items with generated
stable names; incomplete items preserve order and amount. Legacy escrows remain
discrete. New streaming/template fields are introduced only by explicit v2
creation calls.

## Rollback

Rollback is a two-step, tested operation rather than only a deployment note:

1. Freeze creation operationally and invoke `rollback_escrow_v2(job_id)` for
   every lazily migrated escrow. The call requires the admin and succeeds only
   if the v2 record is still v1-representable (discrete mode and no v2-only
   settlement or amendment since migration). It restores the exact backup,
   removes v2 state, and marks the migration rolled back.
2. Invoke the existing `upgrade` with the previously installed v1 WASM hash.

Escrows created directly as v2, streams that accrued/paid, and amended template
escrows are intentionally not projected into an older shape. The release
runbook therefore enables v2 creation operationally only after the rollback
observation window. Once a record has used v2-only behavior, its on-chain
`v2_features_used` guard rejects projection; rollback is then a forward-fix by
reinstalling the last known-good v2 WASM.

## Merge sequence and verification

1. Module boundaries plus transition table; old ABI and behavior unchanged.
2. Template definitions/snapshots/amendments plus max-bound resource test.
3. Streaming lifecycle and conservation/no-dust property tests.
4. Additive lazy migration, v1 fixture settlement, and executable rollback.
5. Authorization matrix, state-machine properties, and per-entrypoint CPU/memory
   snapshots compared with the captured v1 baseline.

Each change builds WASM, runs the existing differential/regression suites, and
keeps `main` releasable. New entrypoints are additive and existing parameter and
return types remain stable throughout the migration window.
