# Contract Contributor Guide

The `contracts/marketpay-contract` directory holds the highest-risk code in the
repository. A bug here can permanently lose user funds. This guide covers
everything you need to contribute safely: local setup, the test infrastructure,
the review bar for fund-moving changes, storage compatibility rules, and a
complete worked example of adding a new entrypoint.

---

## Table of contents

1. [Local setup](#1-local-setup)
2. [Test snapshots](#2-test-snapshots)
3. [Review bar for fund-moving changes](#3-review-bar-for-fund-moving-changes)
4. [Storage compatibility](#4-storage-compatibility)
5. [Worked example — adding `get_escrow_count_by_client`](#5-worked-example--adding-get_escrow_count_by_client)

---

## 1. Local setup

### 1.1 Toolchain

The contract targets `wasm32-unknown-unknown` and uses `soroban-sdk = "22.0.0"`.
Install Rust via [rustup](https://rustup.rs/) and then add the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

No `rust-toolchain.toml` is committed, so any recent stable Rust toolchain
works. The CI gate uses whatever stable is current at the time. If you hit a
build error related to a specific rustc version, check the comments in
`Cargo.toml` — pinned dependencies occasionally document the minimum rustc
required.

### 1.2 Build

```bash
cd contracts/marketpay-contract
cargo build --target wasm32-unknown-unknown --release
```

The optimised WASM artifact is written to:

```
target/wasm32-unknown-unknown/release/marketpay_contract.wasm
```

Release flags in `Cargo.toml` are deliberately aggressive (`opt-level = "z"`,
`lto = true`, `panic = "abort"`) to minimise on-chain storage cost. Do not
remove them.

### 1.3 Run tests

Tests run under the native target (not WASM) using the `testutils` feature flag,
which Soroban provides for off-chain unit testing:

```bash
cd contracts/marketpay-contract
cargo test
```

To run a single test by name:

```bash
cargo test test_release_escrow_happy_path
```

To run every test in a specific module (e.g. the timeout tests):

```bash
cargo test timeout_tests
```

Tests call `env.mock_all_auths()` to bypass signature verification — this is the
standard Soroban unit test pattern. The real auth flow is exercised by `require_auth()`
calls inside each function and is confirmed by checking that the snapshot records
the correct `auth` tree (see [section 2](#2-test-snapshots)).

### 1.4 Clippy

CI runs clippy with the test feature flags enabled. Run the same invocation
locally before pushing:

```bash
cargo clippy --features testutils -- -D warnings
```

Two clippy lints are intentionally suppressed at the crate level because
Soroban entrypoints legitimately have many arguments and internal helpers use
named variables that happen to be unused in some branches:

```rust
#![allow(clippy::too_many_arguments, clippy::manual_range_contains, unused_variables)]
```

Do not add further crate-level suppressions. If clippy flags something in new
code, either fix the code or add a narrow `#[allow(...)]` on the specific item
with a comment explaining why.

---

## 2. Test snapshots

### 2.1 What they are

When a Soroban test runs, the `soroban-sdk` testutils framework can record a
deterministic JSON dump of everything that happened during that test invocation:

- the authorisation tree (who signed what)
- the complete ledger state before and after each host call
- all emitted events

These dumps live under `contracts/marketpay-contract/test_snapshots/`. Each file
is named after the test function and suffixed `.1.json` (the `1` is the
invocation index — tests that call multiple contract functions in sequence
produce a single combined file).

Example path:

```
test_snapshots/tests/comprehensive_escrow_tests/test_create_escrow_happy_path.1.json
```

The JSON is produced automatically by `soroban-sdk` when the `testutils`
feature is active and the environment variable `SOROBAN_WRITE_SNAPSHOTS=1` is
set (this is how the files in the repository were originally generated). Under
normal `cargo test` the snapshots are read back and compared; if the actual
execution diverges from the snapshot, the test fails.

### 2.2 When snapshots legitimately change

A snapshot diff is expected (and correct) when:

- you add a new test (a new `.1.json` file is created)
- you change the arguments to an existing contract call in a test
- you add, remove, or rename an emitted event
- you change a ledger entry key or value because of a storage layout change
- you change how authorisation is structured (e.g. add a `require_auth()` call)

A snapshot diff is **not** expected and is a red flag when:

- you make a refactor that should be behaviour-neutral (same inputs, same outputs)
- you change a helper that is not on any code path touched by the test

If you make a behaviour-neutral refactor and the snapshot changes, stop and
understand why before committing.

### 2.3 How to review a snapshot diff

Open the diff in your editor or in the GitHub PR review interface. The key
sections to check are:

**`auth`** — the array of authorisation trees for each host function call.
Each element records which address signed the call and which sub-invocations
were authorised. Verify that:
- fund-moving functions (`create_escrow`, `release_escrow`, `refund_escrow`,
  `timeout_refund`, `approve_release`, `approve_refund`, milestone functions)
  still require the correct caller's signature.
- no new function gained an empty auth entry when it should require one.

**`ledger_entries`** — the on-chain storage state. Verify that:
- the diff only touches entries you expected to change.
- token balances move in the correct direction and by the correct amount.
- no unexpected keys appear or disappear.

**Events** — emitted via `env.events().publish(...)`. Verify that event topics
and data match the documented event schema.

To regenerate snapshots after an intentional change:

```bash
SOROBAN_WRITE_SNAPSHOTS=1 cargo test
```

Always commit regenerated snapshots together with the code change that caused
them. Reviewers use the snapshot diff as a second source of truth to validate
the change.

---

## 3. Review bar for fund-moving changes

"Fund-moving" means any code path that calls `token::Client::transfer(...)`.
The current paths are:

| Function | Direction |
|---|---|
| `create_escrow_internal` | client → contract |
| `release_escrow_core` | contract → freelancer (and optionally referrer / admin) |
| `refund_escrow_core` | contract → client |
| `timeout_refund` | contract → client |
| `release_with_conversion` | contract → freelancer |
| `finalize_dispute` | contract → client and/or freelancer |
| `emergency_admin_resolve` | contract → recipient |
| `verify_milestone_oracle` (in `oracle.rs`) | contract → freelancer |
| `distribute_tree_rewards` (in `referral.rs`) | contract → referral tree ancestors |

Any PR that adds a new call to `token_client.transfer(...)`, or that changes the
arguments to an existing one, must satisfy **all** of the following before it
can be merged.

### 3.1 Required test coverage

Every fund-moving path must have:

1. **Happy-path test** — verifies the transfer goes to the right address and the
   right amount using `token::Client::new(&env, &token_id).balance(&addr)` assertions.
2. **Authorization test** — verifies that calling the function with a wrong
   caller panics. Use `#[should_panic(expected = "...")]` with the exact panic
   message the function produces.
3. **Double-action test** — verifies that the action cannot be triggered twice
   on the same escrow (e.g. double-release, double-refund). The expected status
   check error message must be in the `#[should_panic]` annotation.
4. **Arithmetic edge-case test** — if the amount is computed rather than passed
   through directly, test the boundary: zero amount, maximum `i128`, and any
   intermediate calculation that could overflow.

Existing test modules in `lib.rs` follow this pattern — see
`comprehensive_escrow_tests` and `regression_tests` for examples.

### 3.2 Authorization checks

Every fund-moving public function must call `caller.require_auth()` **before**
reading any storage, and must then verify that the caller matches the expected
role stored in the escrow record. The order matters: `require_auth()` first,
identity check second. Example from `release_escrow`:

```rust
pub fn release_escrow(env: Env, job_id: String, client: Address) {
    client.require_auth();                          // ← require_auth first
    let escrow: Escrow = env.storage()...           // ← then read storage
    if escrow.client != client { panic!(...) }      // ← then check identity
    ...
}
```

Do not use `env.invoker()` as a substitute for passing the caller as a
parameter — the Soroban auth model requires the address to be an argument so
that cross-contract callers can correctly authorise sub-invocations.

### 3.3 Arithmetic checks

All arithmetic on token amounts must use checked operations and must include an
explicit expect message:

```rust
// Correct
let fee = release_amount
    .checked_mul(PLATFORM_FEE_BPS)
    .expect("Arithmetic overflow")
    .checked_div(FEE_BPS_DENOMINATOR)
    .expect("Arithmetic overflow");

let freelancer_amount = release_amount
    .checked_sub(total_bonus)
    .expect("Arithmetic overflow");
```

Never use `+`, `-`, `*`, `/` directly on `i128` amounts. The `overflow-checks =
true` profile flag catches debug builds, but the `.expect(...)` annotation
also documents intent and produces a deterministic panic message that the tests
can assert against.

Confirm that the invariant `freelancer_amount + fees == release_amount` holds
for every release path. Write an assertion in the test if it is not obvious from
the code.

### 3.4 Snapshot review for fund-moving PRs

In addition to the standard review checklist, a fund-moving PR must show
snapshot diffs that confirm:

- the correct `transfer` sub-invocation appears in the `auth` tree
- the token balance changes are consistent with the expected arithmetic
- the escrow status transitions to a terminal state (`Released` or `Refunded`)
  after the transfer — preventing any re-entry

One reviewer with Soroban contract experience must explicitly approve the
snapshot diff before merge.

---

## 4. Storage compatibility

### 4.1 DataKey rules

All on-chain storage uses `DataKey` variants (defined in `lib.rs`). The rules
are:

- **Never rename a variant.** The variant name is part of the XDR-encoded key.
  Renaming it silently creates a new key and the old data becomes unreachable.
- **Never reorder variants.** The discriminant index is encoded in XDR. Moving
  a variant changes its discriminant and breaks all existing stored values for
  that key.
- **Adding a new variant is always safe.** New variants produce new keys with
  no conflict with existing data.
- **Removing a variant is a breaking change** if any live contract instance has
  data stored under that key.

When in doubt, add a comment to a new `DataKey` variant explaining what it
stores and since which contract version it exists:

```rust
/// Added in v2: per-job message thread CID list (IPFS).
MessageCid(String),
```

### 4.2 Changing a stored struct

All structs annotated with `#[contracttype]` are serialised to XDR when written
to storage. The following changes are backward-compatible (old stored bytes can
still be deserialised):

| Change | Safe? | Notes |
|---|---|---|
| Add a new `Option<T>` field at the end | ✅ Yes | Absent in old data → deserialises as `None` |
| Add a new field with a `Default` impl | ✅ Yes | Old data fills with the default value |
| Rename a field | ❌ No | Field names are encoded in XDR |
| Change a field's type | ❌ No | Breaks deserialisation of old records |
| Remove a field | ❌ No | Any code reading the old field now panics |
| Reorder fields | ❌ No | XDR is positional |

If you need to make a breaking struct change, you must write a migration
function. See the upgrade guide in `contracts/marketpay-contract/README.md` for
the recommended `migrate()` pattern.

### 4.3 Migration pattern

A migration function reads each stored record of the old shape, transforms it to
the new shape, and writes it back. It must be called once, immediately after the
`upgrade()` call, before any other entrypoints are invoked:

```rust
/// Called once after upgrading from v1 to v2 to backfill the new
/// `insurance_policy` field on every Escrow record.
pub fn migrate_v1_to_v2(env: Env, admin: Address) {
    admin.require_auth();
    let admin_stored: Address = env.storage().instance()
        .get(&DataKey::Admin).expect("Not initialized");
    if admin_stored != admin { panic!("Unauthorized") }

    // Walk every escrow and set the new field's default.
    // In practice you would iterate a known list or use a secondary index.
    // This is a one-shot function; gate it on a migration flag.
    if env.storage().instance().has(&DataKey::MigrationV2Done) {
        panic!("Migration already applied");
    }
    // ... transform records ...
    env.storage().instance().set(&DataKey::MigrationV2Done, &true);
}
```

Old records that are never touched will still deserialise correctly as long as
the new field is `Option<T>` or derives `Default`.

### 4.4 Instance vs. persistent vs. temporary storage

The contract currently uses `env.storage().instance()` for everything. Instance
storage has a single TTL tied to the contract instance itself. If you add a new
key that has very different access patterns (e.g. a one-per-ledger temporary
record), use `env.storage().temporary()` to avoid inflating the instance TTL
rent unnecessarily. Document your choice in a comment.

---

## 5. Worked example — adding `get_escrow_count_by_client`

This section walks through adding a new read-only entrypoint from zero to merged.
The entrypoint returns how many escrows a given client address has created.

### 5.1 What already exists

The contract already tracks the total escrow count:

```rust
// DataKey::EscrowCount  →  u32   (incremented in create_escrow_internal)

pub fn get_escrow_count(env: Env) -> u32 {
    env.storage().instance().get(&DataKey::EscrowCount).unwrap_or(0)
}
```

There is no per-client count. We will add one.

### 5.2 Add the storage key

Open `src/lib.rs`. In the `DataKey` enum, add a new variant. **Append it at the
end** to preserve all existing discriminants:

```rust
#[contracttype]
pub enum DataKey {
    // ... existing variants ...
    MilestoneOracle(String, u32),   // ← last existing variant

    /// Per-client escrow count. Added in v2.
    EscrowCountByClient(Address),   // ← new variant
}
```

### 5.3 Increment the counter in `create_escrow_internal`

Find the section in `create_escrow_internal` that increments `EscrowCount` and
add the per-client increment immediately after it:

```rust
        // Increment global counter
        let count: u32 = env.storage().instance()
            .get(&DataKey::EscrowCount).unwrap_or(0);
        let new_count = count.checked_add(1).expect("Counter overflow");
        env.storage().instance().set(&DataKey::EscrowCount, &new_count);

        // NEW: Increment per-client counter
        let client_count: u32 = env.storage().instance()
            .get(&DataKey::EscrowCountByClient(client.clone()))
            .unwrap_or(0);
        let new_client_count = client_count
            .checked_add(1)
            .expect("Counter overflow");
        env.storage().instance().set(
            &DataKey::EscrowCountByClient(client.clone()),
            &new_client_count,
        );
```

### 5.4 Add the entrypoint

In the `#[contractimpl] impl MarketPayContract` block, add the new read function
alongside the other `get_*` functions:

```rust
    /// Return the number of escrows created by `client`.
    /// Returns 0 if the address has never created an escrow.
    pub fn get_escrow_count_by_client(env: Env, client: Address) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::EscrowCountByClient(client))
            .unwrap_or(0)
    }
```

This function is read-only — it does not transfer funds or change state — so it
requires no `require_auth()` call and no snapshot review beyond confirming the
returned value is correct.

### 5.5 Write the tests

Add a new test module at the bottom of `src/lib.rs` (or extend the existing
`tests` module if the test is small enough):

```rust
#[cfg(test)]
mod escrow_count_by_client_tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    fn setup(env: &Env) -> (MarketPayContractClient, Address, Address, Address) {
        let id = env.register(MarketPayContract, ());
        let contract_client = MarketPayContractClient::new(env, &id);
        let admin = Address::generate(env);
        contract_client.initialize(&admin);

        let token_contract = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token_contract.address();
        (contract_client, admin, token_id, id)
    }

    fn mint(env: &Env, admin: &Address, token_id: &Address, recipient: &Address, amount: i128) {
        use soroban_sdk::token;
        let token_admin = token::StellarAssetClient::new(env, token_id);
        token_admin.mint(recipient, &amount);
    }

    #[test]
    fn test_count_starts_at_zero_for_unknown_client() {
        let env = Env::default();
        env.mock_all_auths();
        let (client_contract, _admin, _token, _id) = setup(&env);

        let unknown = Address::generate(&env);
        assert_eq!(client_contract.get_escrow_count_by_client(&unknown), 0);
    }

    #[test]
    fn test_count_increments_on_each_create() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract, _admin, token_id, _id) = setup(&env);

        let client = Address::generate(&env);
        let freelancer = Address::generate(&env);
        mint(&env, &_admin, &token_id, &client, 3000);

        // Before any escrow
        assert_eq!(contract.get_escrow_count_by_client(&client), 0);

        // First escrow
        contract.create_escrow(
            &String::from_str(&env, "job-a"),
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        assert_eq!(contract.get_escrow_count_by_client(&client), 1);

        // Second escrow
        contract.create_escrow(
            &String::from_str(&env, "job-b"),
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        assert_eq!(contract.get_escrow_count_by_client(&client), 2);

        // Third escrow
        contract.create_escrow(
            &String::from_str(&env, "job-c"),
            &client,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        assert_eq!(contract.get_escrow_count_by_client(&client), 3);
    }

    #[test]
    fn test_counts_are_independent_per_client() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract, _admin, token_id, _id) = setup(&env);

        let client_a = Address::generate(&env);
        let client_b = Address::generate(&env);
        let freelancer = Address::generate(&env);
        mint(&env, &_admin, &token_id, &client_a, 1000);
        mint(&env, &_admin, &token_id, &client_b, 1000);

        contract.create_escrow(
            &String::from_str(&env, "job-x"),
            &client_a,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        // client_a has 1, client_b still has 0
        assert_eq!(contract.get_escrow_count_by_client(&client_a), 1);
        assert_eq!(contract.get_escrow_count_by_client(&client_b), 0);

        contract.create_escrow(
            &String::from_str(&env, "job-y"),
            &client_b,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        // Now each has 1
        assert_eq!(contract.get_escrow_count_by_client(&client_a), 1);
        assert_eq!(contract.get_escrow_count_by_client(&client_b), 1);
    }

    #[test]
    fn test_global_count_and_per_client_count_are_consistent() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract, _admin, token_id, _id) = setup(&env);

        let client_a = Address::generate(&env);
        let client_b = Address::generate(&env);
        let freelancer = Address::generate(&env);
        mint(&env, &_admin, &token_id, &client_a, 2000);
        mint(&env, &_admin, &token_id, &client_b, 1000);

        contract.create_escrow(
            &String::from_str(&env, "job-1"),
            &client_a,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract.create_escrow(
            &String::from_str(&env, "job-2"),
            &client_a,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );
        contract.create_escrow(
            &String::from_str(&env, "job-3"),
            &client_b,
            &CreateEscrowParams {
                freelancer: freelancer.clone(),
                token: token_id.clone(),
                amount: 1000,
                milestones: None,
                timeout_ledgers: None,
                referrer: None,
                arbitrator: None,
            },
        );

        // Global count should equal sum of per-client counts
        let global = contract.get_escrow_count();
        let sum = contract.get_escrow_count_by_client(&client_a)
            + contract.get_escrow_count_by_client(&client_b);
        assert_eq!(global, sum);
        assert_eq!(global, 3);
    }
}
```

### 5.6 Run the tests and regenerate snapshots

```bash
cd contracts/marketpay-contract

# Verify all tests pass
cargo test

# Regenerate snapshots for the new tests
SOROBAN_WRITE_SNAPSHOTS=1 cargo test escrow_count_by_client_tests

# Confirm no other snapshots changed unexpectedly
git diff --stat test_snapshots/
```

The `git diff` should show only new files under
`test_snapshots/escrow_count_by_client_tests/`. If any existing snapshot files
changed, investigate before committing.

### 5.7 Run clippy

```bash
cargo clippy --features testutils -- -D warnings
```

Fix any warnings before opening a PR.

### 5.8 Commit checklist

- [ ] New `DataKey` variant appended at the end of the enum
- [ ] Counter incremented in `create_escrow_internal` with `checked_add`
- [ ] New entrypoint is documented with a `///` doc comment
- [ ] At least four tests: zero baseline, single increment, isolation, consistency
- [ ] Snapshots generated and committed alongside the code
- [ ] Clippy clean
- [ ] PR description references the issue being addressed

---

## Appendix: quick reference

| Task | Command |
|---|---|
| Build WASM | `cargo build --target wasm32-unknown-unknown --release` |
| Run all tests | `cargo test` |
| Run one test | `cargo test <test_name>` |
| Run one module | `cargo test <module_name>` |
| Regenerate snapshots | `SOROBAN_WRITE_SNAPSHOTS=1 cargo test` |
| Clippy (with testutils) | `cargo clippy --features testutils -- -D warnings` |
| Deploy to testnet | see [contract-deployment.md](./contract-deployment.md) |
