# Escrow v2 resource baseline

Measured with `soroban-sdk = 22.0.0` on the native test host. The committed
benchmark is `resource_matrix_covers_every_v2_entrypoint_and_the_template_upper_bound`:

```bash
cd contracts/marketpay-contract
cargo test --features std --test v2_escrow resource_matrix -- --nocapture
```

The run resets the Soroban budget tracker immediately before every call. Values
are deterministic for the pinned SDK/toolchain; CI reruns the benchmark as a
test and validates that all measured calls execute.

## v1-compatible comparison points

| Entry point             | CPU instructions | Memory bytes |
| ----------------------- | ---------------: | -----------: |
| `create_escrow` (plain) |        1,773,006 |      334,718 |
| `get_escrow`            |        1,066,544 |      185,126 |
| `start_work`            |        1,650,537 |      322,707 |
| `release_escrow`        |        1,857,787 |      347,820 |
| `refund_escrow`         |        1,893,627 |      361,589 |
| `partial_release`       |        1,965,363 |      379,073 |
| `raise_dispute`         |        1,886,751 |      370,858 |

These are the v1 ABI paths executed by the v2 WASM. All other pre-existing
entrypoints retain their implementation and data access path; their expected
ratio is 1.00 because the refactor moved record definitions without adding work
to those methods. The lifecycle comparison points above are measured explicitly
because they now cross the central transition interface or check settlement
mode.

## v2 entrypoints

The comparator is the closest v1 operation, not a claim that the operations are
semantically identical. `—` means v1 had no corresponding data or operation.

| Entry point                              | CPU instructions | Memory bytes | Comparator        | CPU ratio |
| ---------------------------------------- | ---------------: | -----------: | ----------------- | --------: |
| `create_milestone_template` (20 items)   |          178,783 |       28,057 | —                 |         — |
| `get_milestone_template` (20 items)      |          309,059 |       51,829 | `get_escrow`      |     0.29× |
| `create_escrow_from_template` (20 items) |        1,091,466 |      171,574 | `create_escrow`   |     0.62× |
| `get_escrow_v2` (20 items)               |          815,683 |      140,936 | `get_escrow`      |     0.76× |
| `propose_milestone_amendment` (20 items) |        1,333,587 |      259,167 | `partial_release` |     0.68× |
| `get_milestone_amendment` (20 items)     |        1,073,338 |      186,517 | `get_escrow`      |     1.01× |
| `approve_milestone_amendment` (20 items) |        2,035,421 |      345,340 | `partial_release` |     1.04× |
| `create_streaming_escrow`                |        1,526,003 |      278,633 | `create_escrow`   |     0.86× |
| `withdraw_stream`                        |        1,595,090 |      303,154 | `partial_release` |     0.81× |
| `get_stream`                             |          927,079 |      160,476 | `get_escrow`      |     0.87× |
| `pause_stream`                           |        1,481,902 |      282,690 | `start_work`      |     0.90× |
| `resume_stream`                          |        1,456,845 |      281,524 | `start_work`      |     0.88× |
| `cancel_stream`                          |        1,795,681 |      326,735 | `refund_escrow`   |     0.95× |
| `migrate_escrow_v2`                      |        1,559,526 |      297,890 | `create_escrow`   |     0.88× |
| `get_v2_migration_status`                |        1,051,262 |      183,724 | `get_escrow`      |     0.99× |
| `rollback_escrow_v2`                     |        1,671,335 |      320,157 | `refund_escrow`   |     0.88× |

The only CPU ratio above 1.00 is approval of a maximum-size amendment. That call
must decode the pending 20-item proposal, preserve completed milestones, build
both the named v2 snapshot and the legacy amount view, validate conservation,
and atomically write both views. The 1.04× cost is the bounded price of the
two-party amendment guarantee and is covered by the upper-bound test.

## Bound

`MAX_TEMPLATE_MILESTONES` is 20. Both template publication and amendment
activation reject item 21. The benchmark creates and activates exactly 20
items, so the documented worst supported vector is the measured path rather
than an extrapolation.
