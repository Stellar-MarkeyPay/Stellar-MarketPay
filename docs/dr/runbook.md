# Multi-Region Active-Active DR & Replication Operator Runbook

## 1. Ownership and Operational Access

- **Incident Commander:** Owns the operational timeline and decision log.
- **Database Operator:** Owns fencing leases, replication lag, and promotion.
- **Platform Operator:** Owns Kubernetes clusters, K8GB GSLB, and NGINX Ingress.

---

## 2. Telemetry and Health Verification

Check replication status across clusters:

```bash
# Check primary cluster replication telemetry
curl -fsS https://primary.marketpay.example.com/api/replication/status | jq

# Check secondary cluster replication telemetry
curl -fsS https://secondary.marketpay.example.com/api/replication/status | jq

# Inspect conflict audit log
curl -fsS https://marketpay.example.com/api/replication/conflicts | jq
```

Key fields to observe:

- `fencing.isFenced`: Must be `false` on the active authority and `true` on standby nodes.
- `fencing.generationToken`: Monotonically increasing generation number.
- `replication.currentLagSeconds`: Should remain < 1.0s under normal load (alert at 30s, critical breach at 60s).
- `replication.currentRttMs`: Cross-region heartbeat latency (< 50ms typical).

---

## 3. Automated Regional Failover

When the primary region suffers a complete outage or network partition:

1. **Autonomous Primary Fencing:** The partitioned primary misses heartbeats for > 6s and switches into `FENCED_READ_ONLY` mode, rejecting any local financial writes.
2. **Secondary Lease Takeover:** The secondary region acquires the fencing lease, increments the generation token ($G_{new} = G_{old} + 1$), and enables Class 1 writes.
3. **K8GB Traffic Realignment:** K8GB observes the secondary reporting `database.writable=true` and `database.fenced=false` at `/health/ready` and routes public traffic to `secondary-cluster`.
4. **Post-Failover Chain Reconciliation:**
   ```bash
   # Trigger on-chain Soroban escrow reconciliation
   curl -X POST https://secondary.marketpay.example.com/api/replication/reconcile \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -H "Content-Type: application/json" \
     -d '{"dryRun": false}' | jq
   ```

---

## 4. Planned Maintenance & Deliberate Switchover

To perform a planned region switchover without downtime:

1. **Step 1: Drain in-flight writes on current primary:**
   ```bash
   curl -X POST https://primary.marketpay.example.com/api/replication/fence \
     -H "Authorization: Bearer $ADMIN_JWT" | jq
   ```
2. **Step 2: Verify replication replay lag is caught up (< 0.1s):**
   ```bash
   curl -fsS https://secondary.marketpay.example.com/api/replication/status | jq .replication.currentLagSeconds
   ```
3. **Step 3: Promote secondary region to active authority:**
   ```bash
   curl -X POST https://secondary.marketpay.example.com/api/replication/promote \
     -H "Authorization: Bearer $ADMIN_JWT" | jq
   ```
4. **Step 4: Verify public traffic routing:**
   ```bash
   curl -fsS https://marketpay.example.com/health/ready | jq
   ```

---

## 5. Deliberate Failback Procedure

Failback is **never automatic**. Follow these steps to restore `primary-cluster`:

1. Repair and restore network connectivity to `primary-cluster`.
2. Verify bidirectional replication catch-up (replay lag < 0.5s for at least 15 minutes).
3. Execute the planned switchover sequence above from `secondary-cluster` back to `primary-cluster`.
4. Run chain escrow reconciliation:
   ```bash
   curl -X POST https://primary.marketpay.example.com/api/replication/reconcile \
     -H "Authorization: Bearer $ADMIN_JWT" \
     -d '{"dryRun": false}' | jq
   ```

---

## 6. Network Partition Game Day Execution

Run quarterly and before major database or infrastructure releases:

```bash
# Run Network Partition Game Day Simulation
python3 scripts/dr/partition_gameday.py \
  --mode simulation \
  --primary-url https://primary.marketpay.example.com/health/ready \
  --secondary-url https://secondary.marketpay.example.com/health/ready \
  --public-url https://marketpay.example.com/health/ready \
  --secondary-region secondary-cluster \
  --rto-target-seconds 10.0 \
  --rpo-target-seconds 1.0 \
  --report-json artifacts/dr-gameday-partition.json \
  --report-markdown artifacts/dr-gameday-partition.md
```
