# Decentralized Storage Insurance (SLA Verification)

## Overview

The Decentralized Storage Insurance system monitors the availability of files stored on IPFS and Arweave, and automatically triggers insurance payouts when Service Level Agreement (SLA) violations occur. This creates a trustless, decentralized insurance mechanism for critical files stored on distributed networks.

## Architecture

### Components

1. **Backend SLA Monitor** (`services/sla_monitor.js`)
   - Monitors file availability on IPFS/Arweave
   - Manages insurance policies and claims
   - Tracks premium payments and payouts
   - Evaluates SLA violations automatically

2. **Soroban Smart Contract** (`contracts/insurance.rs`)
   - Manages on-chain insurance policies
   - Handles claim approval and payouts
   - Integrates with token contracts (XLM/USDC)
   - Stores oracle proofs on-chain

3. **Database Schema** (`migrations/create_insurance_tables.sql`)
   - Insured files and policies
   - Insurance claims and proofs
   - Payment tracking
   - Audit history

4. **API Routes** (`routes/insurance.js`)
   - Policy creation and management
   - Claim submission and tracking
   - Oracle proof submission
   - System statistics

## System Components

### Steady-State Metrics

The insurance system defines SLA requirements:

| Metric                     | Value       | Purpose                              |
| -------------------------- | ----------- | ------------------------------------ |
| **Availability Threshold** | 99%         | Minimum availability requirement     |
| **Premium Rate**           | 2% annually | Insurance premium as % of file value |
| **Maximum Payout**         | 100%        | Maximum claim payout per file        |
| **Check Interval**         | 1 hour      | Frequency of availability checks     |
| **Claim Wait Period**      | 24 hours    | Time before claim can be paid out    |

### Premium Model

Insurance premiums are calculated based on:

```
Premium = File Value × Base Rate (2%) × Size Multiplier
```

**Size Multiplier:**

- 1-10 MB: 0.1x - 1.0x
- 10-100 MB: Caps at 2.0x

**Example:**

- File: 5 MB, Value: 1000 XLM
- Size Multiplier: 5/10 = 0.5
- Premium: 1000 × 0.02 × 0.5 = **10 XLM/year**

### Availability Scoring

Files are checked periodically, and an availability score is calculated:

```
Availability Score = Passed Checks / Total Checks
```

When score drops below 99%:

1. SLA violation is detected
2. Insurance claim is automatically created
3. User can submit proof of unavailability
4. Payout is issued after verification

## Workflow

### 1. Policy Creation

User creates an insurance policy for a file:

```bash
POST /api/insurance/policies
Content-Type: application/json

{
  "cid": "QmTest123...",
  "fileSize": 5,
  "fileValue": 1000,
  "storageType": "ipfs"
}

Response:
{
  "policy": {
    "id": 1,
    "cid": "QmTest123...",
    "premium": 10.0,
    "status": "active",
    "createdAt": "2026-06-18T16:00:00Z"
  }
}
```

**On-Chain:**

- Policy stored on Soroban
- Premium amount locked (optional)
- Policy ID generated

### 2. Continuous Monitoring

Backend service checks file availability every hour:

```javascript
await slaMonitor.performAvailabilityCheck(fileId);
```

**Process:**

1. Query IPFS node or Arweave gateway
2. Record result (available/unavailable)
3. Update availability score
4. Auto-detect SLA violations

### 3. SLA Violation & Claim

When availability drops below 99%:

```javascript
const claim = await slaMonitor.evaluateInsuranceClaim(fileId);
```

**Automatically creates claim with:**

- Evidence: availability metrics
- Status: pending
- Wait period: 24 hours

### 4. Oracle Proof Submission

Oracle submits cryptographic proof of file unavailability:

```bash
POST /api/insurance/claims/:id/submit-proof
Content-Type: application/json

{
  "oracleProof": {
    "checkTimestamp": 1687090800,
    "failedChecks": 5,
    "totalChecks": 5,
    "signature": "0x..."
  }
}
```

**Proof verifies:**

- File is actually unavailable
- Checks were performed correctly
- Oracle is authorized

### 5. Claim Approval & Payout

Admin approves claim and triggers payout:

```rust
// On-chain
contract.approve_and_payout(claim_id);
```

**Payout:**

- Transfers claim amount to user's address
- Marks policy as claimed
- Logs transaction on blockchain
- Emits event for verification

### 6. Claim Completion

User receives payout:

```bash
GET /api/insurance/claims/:id

{
  "claim": {
    "id": 1,
    "status": "paid",
    "claimAmount": 1000,
    "payoutTxHash": "tx123...",
    "paidAt": "2026-06-19T00:00:00Z"
  }
}
```

## API Endpoints

### Insurance Policies

#### Create Policy

```http
POST /api/insurance/policies
Authorization: Bearer <token>
Content-Type: application/json

{
  "cid": "QmXxxx...",
  "fileSize": 10,
  "fileValue": 5000,
  "storageType": "ipfs"
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "policy": {
    "id": 1,
    "cid": "QmXxxx...",
    "premium": 50.0,
    "fileValue": 5000,
    "status": "active"
  }
}
```

#### List User's Policies

```http
GET /api/insurance/policies
Authorization: Bearer <token>
```

**Response:** `200 OK`

```json
{
  "success": true,
  "policies": [
    {
      "id": 1,
      "cid": "QmXxxx...",
      "fileSize": 10,
      "premium": 50.0,
      "status": "active",
      "availabilityScore": 0.99
    }
  ]
}
```

#### Get Policy Details

```http
GET /api/insurance/policies/:id
Authorization: Bearer <token>
```

### Insurance Claims

#### Submit Claim

```http
POST /api/insurance/claims
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": 1
}
```

**Response:** `201 Created`

```json
{
  "success": true,
  "claim": {
    "id": 1,
    "fileId": 1,
    "claimAmount": 5000,
    "status": "pending"
  }
}
```

#### List User's Claims

```http
GET /api/insurance/claims
Authorization: Bearer <token>
```

#### Get Claim Details

```http
GET /api/insurance/claims/:id
Authorization: Bearer <token>
```

#### Submit Oracle Proof

```http
POST /api/insurance/claims/:id/submit-proof
Authorization: Bearer <token>
Content-Type: application/json

{
  "oracleProof": {
    "checkTimestamp": 1687090800,
    "failedChecks": 5,
    "totalChecks": 5,
    "signature": "0x..."
  }
}
```

### Statistics

#### Get Insurance Statistics

```http
GET /api/insurance/stats
```

**Response:** `200 OK`

```json
{
  "success": true,
  "stats": {
    "activeInsuredFiles": 42,
    "pendingClaims": 3,
    "approvedClaims": 8,
    "totalPremiumsActive": 500.0,
    "totalPayoutsIssued": 3500.0,
    "systemAverageAvailability": 0.985
  }
}
```

## Smart Contract Functions

### Initialize

```rust
contract.initialize(admin, token_address)
```

Sets up contract with admin and token.

### Create Policy

```rust
contract.create_policy(
    owner,
    cid,
    file_value,
    storage_type,
    duration_ledgers
)
```

Creates insurance policy on-chain.

### Submit Availability Proof

```rust
contract.submit_availability_proof(
    policy_id,
    oracle_proof,
    oracle_address
)
```

Oracle submits proof of file unavailability.

### Approve and Payout

```rust
contract.approve_and_payout(claim_id)
```

Admin approves claim and initiates payout.

### Reject Claim

```rust
contract.reject_claim(claim_id, reason)
```

Admin rejects ineligible claim.

## Database Schema

### insured_files

```sql
CREATE TABLE insured_files (
    id SERIAL PRIMARY KEY,
    cid VARCHAR(255) UNIQUE NOT NULL,
    owner_address VARCHAR(56) NOT NULL,
    file_size INTEGER NOT NULL,
    file_value DECIMAL NOT NULL,
    premium DECIMAL NOT NULL,
    storage_type VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL,
    availability_score DECIMAL,
    checks_total INTEGER DEFAULT 0,
    checks_passed INTEGER DEFAULT 0,
    last_checked TIMESTAMP
);
```

### insurance_claims

```sql
CREATE TABLE insurance_claims (
    id SERIAL PRIMARY KEY,
    file_id INTEGER REFERENCES insured_files,
    owner_address VARCHAR(56) NOT NULL,
    claim_amount DECIMAL NOT NULL,
    status VARCHAR(50) NOT NULL,
    oracle_proof JSONB,
    oracle_address VARCHAR(56),
    payout_tx_hash VARCHAR(255),
    created_at TIMESTAMP,
    paid_at TIMESTAMP
);
```

### availability_check_history

```sql
CREATE TABLE availability_check_history (
    id SERIAL PRIMARY KEY,
    file_id INTEGER REFERENCES insured_files,
    is_available BOOLEAN NOT NULL,
    check_duration_ms INTEGER,
    error_message VARCHAR(500),
    created_at TIMESTAMP
);
```

## Testing

### Unit Tests

Coverage includes:

- Premium calculation ✅
- Policy creation ✅
- Availability tracking ✅
- Claim creation ✅
- Oracle proof handling ✅
- Payout processing ✅

Run tests:

```bash
npm test -- src/services/sla_monitor.test.js
```

### Integration Tests

Test full workflows:

- Policy → Monitoring → Claim → Payout
- Multiple concurrent policies
- SLA violation detection
- Claim rejection scenarios

## Security Considerations

### Oracle Proofs

Oracle proofs must include:

- **Signature:** Cryptographic proof by oracle
- **Timestamp:** When check was performed
- **Check results:** Failed/passed counts
- **File CID:** What file was checked

### Authorization

- Only file owner can create claim
- Only oracle can submit proof
- Only admin can approve/reject
- Claims are user-specific

### Anti-Fraud

- Proofs validated before claim approval
- Multiple independent checks encouraged
- Availability scores aggregate over time
- Rejection reasons logged permanently

## Monitoring & Alerts

### Key Metrics

```
marketpay_insurance_policies_active
marketpay_insurance_claims_pending
marketpay_insurance_average_availability
marketpay_insurance_total_payouts
```

### Alert Triggers

- **System Degradation:** Avg availability < 95%
- **High Claim Volume:** >10% policies filing claims
- **Claim Backlog:** Pending claims > 20
- **Proof Failures:** Oracle rejection rate > 5%

## Configuration

Environment variables:

```bash
# IPFS
PINATA_API_KEY=<key>
PINATA_SECRET_KEY=<secret>
PINATA_API_URL=https://api.pinata.cloud

# Smart Contract
SOROBAN_CONTRACT_ID=<contract_id>
STELLAR_NETWORK=testnet
```

## Common Issues

### File Not Detected

**Problem:** Availability check returns unavailable
**Solutions:**

- Verify file is pinned on IPFS
- Check IPFS node connectivity
- Ensure CID is correct

### Claim Rejected

**Problem:** Insurance claim is rejected
**Reasons:**

- Availability still above threshold
- Proof doesn't verify
- Policy already claimed
- File recovered

### Payment Failed

**Problem:** Claim approved but payout fails
**Reasons:**

- Insufficient contract balance
- Token transfer failure
- Invalid payout address

## Roadmap

Future enhancements:

- [ ] Multi-tier insurance coverage
- [ ] Deductible options
- [ ] Custom check intervals
- [ ] Third-party storage providers
- [ ] Automated claims tribunal
- [ ] Staking for oracle reputation
- [ ] Parametric insurance (automatic payout)
- [ ] Coverage for Arweave migrations

## References

- [Soroban Documentation](https://developers.stellar.org/learn/build/smart-contracts)
- [IPFS Pinning Services](https://docs.ipfs.tech/how-to/pin-files/)
- [Arweave Permanence](https://docs.arweave.org/)
- [Insurance SLA Standards](https://en.wikipedia.org/wiki/Service-level_agreement)
