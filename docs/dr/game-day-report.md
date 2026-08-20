# Disaster-recovery game-day report

## Control-plane simulation — 2026-07-29

Scope: `scripts/dr/gameday.py --mode simulation`, actually executed against
three local mock HTTP endpoints standing in for the primary, secondary, and
public (GSLB-routed) health checks, with `--failure-command`/`--restore-command`
scripts that flip a small state file rather than touching real infrastructure.
A background delay in the failure script models a managed-Postgres provider
promoting the secondary ~6 seconds after the primary goes unreachable,
independent of the coordinator itself — the coordinator only observes and
measures, it does not perform promotion.

These are real measured numbers from an actual run of the tool (not values
copied from the unit tests), reproduced twice for consistency:

| Measurement                                       |      Target |                          Observed | Result |
| ------------------------------------------------- | ----------: | --------------------------------: | ------ |
| RTO                                               | 600 seconds | 8.07s, then 8.06s on a repeat run | Pass   |
| RPO upper bound (replica replay lag at injection) |  60 seconds |                       4.0 seconds | Pass   |

Raw output of the first run:

```json
{
  "mode": "simulation",
  "passed": true,
  "rto_target_seconds": 600.0,
  "rto_actual_seconds": 8.06514205498388,
  "rpo_target_seconds": 60.0,
  "rpo_actual_seconds": 4.0,
  "secondary_region": "secondary-cluster",
  "failure_reason": null
}
```

A third run additionally confirmed the pre-injection safety refusal for
real, not just in the unit tests: with the mock replica's `replay_lag_seconds`
set to 75 (above the 60-second target), the tool exited 1 with
`"Replication lag exceeded the RPO target before injection."` and the
failure-command was never executed — verified directly by checking the mock
state file still showed `primary_up: true` afterward.

Gap found and fixed (before this exercise): the previous `/health` endpoint
only ran `SELECT 1`, so a read-only replica could be advertised as healthy.
The new readiness response exposes database role, writability, and replay
lag; Kubernetes and K8GB now gate traffic on it.

Gap found and fixed (during this exercise): `scripts/dr/gameday.py`'s CLI
never actually exposed the `live`/`simulation` mode distinction that
`GameDayResult`/`write_reports()` and the unit tests already understood —
`main()` always ran with the default `mode="live"`, so any real invocation
of this tool, including a harmless local dry run like this one, would have
produced a report claiming "Production evidence" rather than "Control-plane
simulation only." Added a required `--mode` flag (no default, so an operator
must consciously say which one they're doing) and reran this game day with
it — the report above reflects the corrected, honestly-labeled output. Also
fixed: a restore-command failure previously overwrote (rather than appended
to) an earlier failure-injection error, which could hide the real cause of a
failed exercise from whoever reads the report afterward.

**Qualification:** this is control-plane automation evidence — real
execution of the real coordinator code and thresholds against mock
endpoints — not a production region-loss certification. A live two-cluster
game day requires organization cluster, DNS, and managed-database
credentials that are intentionally not stored in this repository (and were
not available in the environment this exercise was run in). The live
command and evidence requirements are defined in the runbook; running
`scripts/dr/gameday.py --mode live` against real primary/secondary clusters
and replacing/supplementing this report is the required next step before
the 10-minute/60-second production objectives are treated as proven.
