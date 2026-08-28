# Documentation Index

Welcome to Stellar MarketPay documentation. This index helps you find what you need.

---

## 🚀 Getting Started

**New to Stellar MarketPay?** Start here:

- **[Quick Start Guide](../QUICK_START_NEW_FEATURES.md)** - Get up and running with new features
- **[Getting Started](./getting-started.md)** - Initial setup and installation
- **[README](../README.md)** - Project overview and features

---

## 📚 Core Documentation

### Architecture & Design

- **[Architecture Overview](./architecture.md)** - System design and components
- **[Deployment Guide](./deployment.md)** - How to deploy Stellar MarketPay
- **[Multi-cluster DR Architecture](./dr/architecture.md)** - Active-passive topology, RTO/RPO, and state replication (decision recorded in [ADR-008](./ADR-008-multi-cluster-kubernetes-dr.md))
- **[DR and Blue-Green Runbook](./dr/runbook.md)** - Failover, deployment rollback, failback, and game-day procedures
- **[Latest DR Game-Day Report](./dr/game-day-report.md)** - Measured recovery evidence and qualification
- **[Soroban Contract Deployment](./contract-deployment.md)** - Build, deploy, and configure the escrow contract
- **[Contract Contributor Guide](./contract-contributor-guide.md)** - Local setup, test snapshots, fund-moving review bar, storage compatibility, and a worked entrypoint example
- **[Environment Variables](./environment-variables.md)** - Single source of truth for runtime config
- **[CDN Strategy](./CDN_STRATEGY.md)** - Multi-CDN edge caching, event-driven invalidation, cache-key/TTL strategy, stampede protection (decision recorded in [ADR-007](./ADR-007-multi-cdn-edge-strategy.md))
- **[Enterprise Federation Architecture](./ADR-012-enterprise-federation.md)** - Per-organisation SAML/OIDC identity, wallet-authority separation, deprovisioning, and phased SCIM/controls delivery

### Formal Verification

The escrow contract holds user funds. These two documents state what it
guarantees and how much of that has actually been established — including, at
length, what has not.

- **[Escrow Specification](./SPECIFICATION.md)** - The formal invariants, the legal transition relation, per-entrypoint pre/postconditions, and the ten findings where the design and the implementation disagreed
- **[Verification Approach and Limitations](./VERIFICATION.md)** - Tooling evaluated and why, what each technique establishes, results, and the bounds every claim is subject to

### API Documentation

- **[API Documentation](./API_DOCUMENTATION.md)** - REST API endpoints
- **[API Reference](./api.md)** - Detailed API reference
- **[Scope WebSocket Protocol](./websocket-scope-protocol.md)** - Realtime session protocol and client schema
- **[GraphQL Gateway Guide](./GRAPHQL.md)** - Domain schema conventions, registry checks, migration status, and REST boundaries
- **[GraphQL Gateway Design](./GRAPHQL_DESIGN_COMMENT.md)** - Architecture, data model, safety posture, and phased rollout for issue #318

---

## 🏗️ Architecture Decision Records (ADRs)

Decisions that shaped Stellar MarketPay's architecture:

### ADR-001: Soroban Smart Contract for Escrow Management

**File**: [ADR-001-soroban-escrow-design.md](./ADR-001-soroban-escrow-design.md)

**Decision**: Use Soroban smart contracts for trustless escrow management

**Key Points**:

- Why Soroban was chosen over alternatives
- Contract design and state machine
- Key features (atomic operations, access control, timeouts)
- Implementation details

**Status**: ✅ Accepted

---

### ADR-002: Horizon API for Transaction Indexing

**File**: [ADR-002-horizon-api-indexing.md](./ADR-002-horizon-api-indexing.md)

**Decision**: Use Horizon REST API as primary transaction data source

**Key Points**:

- Why Horizon API was chosen
- Architecture (Frontend → Backend → Horizon → Stellar)
- Implementation approach
- Caching strategy
- Error handling

**Status**: ✅ Accepted

---

### ADR-003: Database Schema for Escrow State Management

**File**: [ADR-003-database-schema-escrow.md](./ADR-003-database-schema-escrow.md)

**Decision**: Maintain off-chain escrow state in PostgreSQL

**Key Points**:

- PostgreSQL schema design
- Tables: escrows, escrow_events, escrow_disputes
- State transitions and lifecycle
- Sync strategy with smart contracts
- Timeout handling

**Status**: ✅ Accepted

---

### ADR-004: 2-of-3 Multisig for Escrow Release Arbitration

**File**: [ADR-004-multisig-escrow-arbitration.md](./ADR-004-multisig-escrow-arbitration.md)

**Decision**: Escrows with an optional arbitrator require 2-of-3 multisig approval to release or refund

**Key Points**:

- Why multisig over unilateral client release
- The unused arbitrator-pool voting alternative found in the contract
- Vote tracking and the 2-of-3 threshold

**Status**: ✅ Accepted

---

### ADR-005: Multi-Level Referral Tree with 3-Tier Reward Split

**File**: [ADR-005-referral-tree-reward-split.md](./ADR-005-referral-tree-reward-split.md)

**Decision**: Reward up to 3 ancestor levels of a freelancer's referral tree on job completion

**Key Points**:

- Level 1/2/3 bonus percentages (2.00% / 0.75% / 0.25%)
- Cycle and self-referral prevention
- Why it supersedes the earlier off-chain reputation-point referral design

**Status**: ✅ Accepted

---

### ADR-006: On-Chain Platform Fee with Referrer-or-Admin Routing

**File**: [ADR-006-platform-fee-referrer-routing.md](./ADR-006-platform-fee-referrer-routing.md)

**Decision**: A flat 1% platform fee on non-tree escrow releases, routed to the escrow's referrer or else the admin

**Key Points**:

- How this path defers to the ADR-005 tree path when one exists
- On-chain, atomic fee computation and routing
- Known documentation drift (`docs/FAQ.md`) this ADR does not fix

**Status**: ✅ Accepted

---

### ADR-007: Multi-CDN Edge Strategy with Event-Driven Cache Invalidation

**File**: [ADR-007-multi-cdn-edge-strategy.md](./ADR-007-multi-cdn-edge-strategy.md)

**Decision**: Ordered Cloudflare/Fastly failover chain, with contract events driving targeted cache purges

**Key Points**:

- Why an ordered chain instead of active-active multi-CDN
- Event-driven invalidation instead of TTL-only or a full flush
- Stampede protection via request coalescing

**Status**: ✅ Accepted

---

### ADR-008: Active-Passive Multi-Cluster Kubernetes Disaster Recovery

**File**: [ADR-008-multi-cluster-kubernetes-dr.md](./ADR-008-multi-cluster-kubernetes-dr.md)

**Decision**: Two-region active-passive Kubernetes topology with K8GB DNS failover and Argo Rollouts blue-green

**Key Points**:

- Why active-passive, not active-active (split-brain risk)
- The layered health-check / traffic-gate design
- Current DR evidence is simulation-only, not yet production-proven

**Status**: ✅ Accepted

---

### ADR-010: Zero-Knowledge Reputation with Selective Disclosure

**File**: [ADR-010-zk-reputation.md](./ADR-010-zk-reputation.md)

**Decision**: Pedersen commitments + Chaum–Pedersen sigma protocols over BLS12-381 G1 (no trusted setup), anchored in a per-subject Merkle tree, with an on-chain Soroban verifier mirroring the off-chain JS byte-for-byte

**Key Points**:

- Why a sigma-protocol scheme was chosen over a zk-SNARK for v1
- O(1) revocation via a single `earliestInvalidatedEpoch` scalar
- Measured on-chain verification cost: cheap for `dispute_free`, not yet viable in one transaction for `rating_threshold`/`earnings_band` — honest numbers, not an assumed yes
- The contiguous-leaf-range scope decision and what it does and doesn't hide

**Status**: ✅ Accepted

---

### ADR-012: Enterprise Federation and Transaction Authority Separation

**File**: [ADR-012-enterprise-federation.md](./ADR-012-enterprise-federation.md)

**Decision**: Treat SAML/OIDC authentication as an organisation membership
session and require an independent linked-wallet or passkey signing proof for
every escrow-sensitive transaction.

**Key Points**:

- Per-organisation provider and federated-identity model with atomic replay barriers
- Linked wallet first; passkey account later; no platform-custodied employee keys
- Deprovisioning immediately removes off-chain access without misrepresenting existing on-chain authority
- Additive six-PR migration plan that leaves existing wallet users unchanged

**Status**: ✅ Accepted for phased delivery

---

## ❓ FAQ & Help

### Frequently Asked Questions

**File**: [FAQ.md](./FAQ.md)

**Coverage**: 50+ questions across 10 categories

**Categories**:

1. General Questions - What is MarketPay, how is it different?
2. Getting Started - Sign up, fund account, install Freighter
3. For Clients - Post jobs, manage funds, approve work
4. For Freelancers - Find jobs, submit proposals, get paid
5. Transactions & Payments - View history, understand fees
6. Disputes & Refunds - Open disputes, provide evidence
7. Technical Questions - Smart contracts, IPFS, wallets
8. Troubleshooting - Common issues and solutions
9. Support & Community - Contact support, contribute
10. Legal & Compliance - Regulations, taxes, privacy

**Quick Links**:

- [How do I post a job?](./FAQ.md#how-do-i-post-a-job)
- [When do I get paid?](./FAQ.md#when-do-i-get-paid)
- [Is it safe?](./FAQ.md#is-stellar-marketpay-safe)
- [What are transaction fees?](./FAQ.md#what-are-transaction-fees)

---

## 📦 Setup Guides

### Pinata IPFS Setup for Dispute Evidence

**File**: [PINATA_IPFS_SETUP.md](./PINATA_IPFS_SETUP.md)

**Purpose**: Store dispute evidence on decentralized IPFS network

**Sections**:

1. Overview - What is IPFS, Pinata, why use it
2. Create Pinata Account
3. Generate API Keys
4. Install Pinata SDK
5. Implement File Upload
6. Backend Integration
7. Access Evidence Files
8. Testing
9. Production Deployment
10. Troubleshooting
11. Best Practices

**Code Examples**:

- `frontend/lib/pinata.ts` - Upload service
- `frontend/components/DisputeEvidenceUpload.tsx` - Upload component
- `backend/src/routes/disputes.js` - Backend endpoints
- Database schema for disputes

---

### Private Message Encryption

**File**: [messaging-encryption.md](./messaging-encryption.md)

**Purpose**: Documents the client-side encryption contract for private job messages and the nonce uniqueness requirement.

---

## 🎯 Feature Documentation

### Transaction History Page

**Location**: `/dashboard/transactions`

**Features**:

- Real-time transaction fetching from Stellar Horizon API
- Advanced filtering (all, sent, received, escrow)
- Cursor-based pagination
- Transaction type detection with icons
- Direct links to Stellar Expert explorer
- Responsive design with loading states

**Code**:

- `frontend/lib/stellar.ts` - Transaction functions
- `frontend/pages/dashboard/transactions.tsx` - Page component

**Related**:

- [ADR-002: Horizon API Indexing](./ADR-002-horizon-api-indexing.md)
- [FAQ: Transaction History](./FAQ.md#how-do-i-view-my-transaction-history)

---

## 📋 Implementation Guides

### Implementation Summary

**File**: [../IMPLEMENTATION_SUMMARY.md](../IMPLEMENTATION_SUMMARY.md)

**Contents**:

- Overview of all 4 features
- Detailed implementation for each feature
- Integration checklist
- File structure
- Next steps and roadmap
- References and support

---

### Quick Start for New Features

**File**: [../QUICK_START_NEW_FEATURES.md](../QUICK_START_NEW_FEATURES.md)

**Contents**:

- Quick reference for each feature
- How to use each feature
- Code locations
- Testing instructions
- Troubleshooting tips
- Implementation checklist

---

## 🔗 Related Documentation

### Project Documentation

- **[README](../README.md)** - Project overview
- **[ROADMAP](../ROADMAP.md)** - Feature roadmap
- **[CONTRIBUTING](../CONTRIBUTING.md)** - Contribution guidelines
- **[TODO](../TODO.md)** - Outstanding tasks

### External Resources

- **[Stellar Documentation](https://developers.stellar.org)** - Official Stellar docs
- **[Soroban Smart Contracts](https://soroban.stellar.org)** - Soroban documentation
- **[Horizon API](https://developers.stellar.org/api)** - Horizon API reference
- **[Pinata Documentation](https://docs.pinata.cloud)** - Pinata docs
- **[IPFS Documentation](https://docs.ipfs.io)** - IPFS docs

---

## 📁 Documentation Structure

```
stellar-marketpay/
├── docs/
│   ├── INDEX.md (this file)
│   ├── ADR-001-soroban-escrow-design.md
│   ├── ADR-002-horizon-api-indexing.md
│   ├── ADR-003-database-schema-escrow.md
│   ├── ADR-004-multisig-escrow-arbitration.md
│   ├── ADR-005-referral-tree-reward-split.md
│   ├── ADR-006-platform-fee-referrer-routing.md
│   ├── ADR-007-multi-cdn-edge-strategy.md
│   ├── ADR-008-multi-cluster-kubernetes-dr.md
│   ├── contract-contributor-guide.md
│   ├── FAQ.md
│   ├── PINATA_IPFS_SETUP.md
│   ├── architecture.md
│   ├── API_DOCUMENTATION.md
│   ├── api.md
│   ├── deployment.md
│   └── getting-started.md
├── IMPLEMENTATION_SUMMARY.md
├── QUICK_START_NEW_FEATURES.md
├── README.md
├── ROADMAP.md
├── CONTRIBUTING.md
└── TODO.md
```

---

## 🎓 Learning Paths

### For Clients

1. [Getting Started](./getting-started.md)
2. [FAQ: For Clients](./FAQ.md#for-clients)
3. [FAQ: Transactions & Payments](./FAQ.md#transactions--payments)
4. [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)

### For Freelancers

1. [Getting Started](./getting-started.md)
2. [FAQ: For Freelancers](./FAQ.md#for-freelancers)
3. [FAQ: Transactions & Payments](./FAQ.md#transactions--payments)
4. [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)

### For Developers

1. [Architecture Overview](./architecture.md)
2. [ADR-001: Escrow Design](./ADR-001-soroban-escrow-design.md)
3. [Contract Contributor Guide](./contract-contributor-guide.md)
4. [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
5. [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
6. [ADR-004: Multisig Escrow Arbitration](./ADR-004-multisig-escrow-arbitration.md)
7. [ADR-005: Referral Tree Reward Split](./ADR-005-referral-tree-reward-split.md)
8. [ADR-006: Platform Fee Referrer Routing](./ADR-006-platform-fee-referrer-routing.md)
9. [API Documentation](./API_DOCUMENTATION.md)
10. [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
11. [Deployment Guide](./deployment.md)

### For DevOps/Infrastructure

1. [Deployment Guide](./deployment.md)
2. [Architecture Overview](./architecture.md)
3. [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
4. [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
5. [ADR-007: Multi-CDN Edge Strategy](./ADR-007-multi-cdn-edge-strategy.md)
6. [ADR-008: Multi-Cluster Kubernetes DR](./ADR-008-multi-cluster-kubernetes-dr.md)

---

## 🔍 Quick Search

### By Topic

**Blockchain & Stellar**

- [ADR-001: Soroban Escrow](./ADR-001-soroban-escrow-design.md)
- [ADR-002: Horizon API](./ADR-002-horizon-api-indexing.md)
- [ADR-004: Multisig Escrow Arbitration](./ADR-004-multisig-escrow-arbitration.md)
- [FAQ: Technical Questions](./FAQ.md#technical-questions)

**Database & Backend**

- [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
- [API Documentation](./API_DOCUMENTATION.md)
- [Deployment Guide](./deployment.md)

**Frontend & UI**

- [Transaction History](./FAQ.md#how-do-i-view-my-transaction-history)
- [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
- [Architecture Overview](./architecture.md)

**User Guides**

- [FAQ](./FAQ.md)
- [Getting Started](./getting-started.md)
- [Quick Start](../QUICK_START_NEW_FEATURES.md)

**Disputes & Evidence**

- [Pinata IPFS Setup](./PINATA_IPFS_SETUP.md)
- [FAQ: Disputes & Refunds](./FAQ.md#disputes--refunds)
- [ADR-003: Database Schema](./ADR-003-database-schema-escrow.md)
- [ADR-004: Multisig Escrow Arbitration](./ADR-004-multisig-escrow-arbitration.md)

**Growth & Monetization**

- [ADR-005: Referral Tree Reward Split](./ADR-005-referral-tree-reward-split.md)
- [ADR-006: Platform Fee Referrer Routing](./ADR-006-platform-fee-referrer-routing.md)

**Infrastructure & Operations**

- [CDN Strategy](./CDN_STRATEGY.md)
- [ADR-007: Multi-CDN Edge Strategy](./ADR-007-multi-cdn-edge-strategy.md)
- [Multi-cluster DR Architecture](./dr/architecture.md)
- [ADR-008: Multi-Cluster Kubernetes DR](./ADR-008-multi-cluster-kubernetes-dr.md)

---

## 📞 Support & Contact

### Getting Help

- **GitHub Issues**: [stellar-marketpay/issues](https://github.com/stellar-marketpay/issues)
- **Discord**: [Stellar MarketPay Community](https://discord.gg/stellar-marketpay)
- **Email**: support@stellar-marketpay.com
- **Twitter**: [@StellarMarketPay](https://twitter.com/StellarMarketPay)

### Contributing

- See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines
- Check [TODO.md](../TODO.md) for outstanding tasks
- Review [ROADMAP.md](../ROADMAP.md) for planned features

### Merge Policy & Supply Chain

The rules that gate a merge are defined once and executed identically by the
local hooks and by a required CI check, so bypassing a hook changes when you
learn about a violation, never whether it is enforced.

- **[Policy Catalogue](./POLICY_CATALOGUE.md)** - Every rule, the incident behind it, its severity per stage, and the override mechanism
- **[Policy Engine](./POLICY_ENGINE.md)** - Architecture, the parity guarantee, warn-only rollout, and how to add a rule
- **[Git Hooks & Commits](./GIT_HOOKS_AND_COMMITS.md)** - The local hook runner the policy stages plug into
- **[Branch Protection & Merge Queue](./BRANCH_PROTECTION.md)** - Required checks, the merge queue, and the administrator-override decision
- **[Commit Signing](./COMMIT_SIGNING.md)** - One-command enrolment and the server-side rollout path
- **[Secrets: Prevention and Response](./SECRET_RESPONSE.md)** - Scanning locally and remotely, the allowlist, and what to do when a credential leaks
- **[Build Provenance](./PROVENANCE.md)** - Attesting the release wasm and verifying a deployed contract

---

## 📝 Document Maintenance

### Last Updated

- **Date**: May 28, 2026
- **Version**: 1.0
- **Status**: ✅ Complete

### Recent Additions

- ✅ ADR-001: Soroban Escrow Design
- ✅ ADR-002: Horizon API Indexing
- ✅ ADR-003: Database Schema
- ✅ ADR-004: Multisig Escrow Arbitration
- ✅ ADR-005: Referral Tree Reward Split
- ✅ ADR-006: Platform Fee Referrer Routing
- ✅ ADR-007: Multi-CDN Edge Strategy
- ✅ ADR-008: Multi-Cluster Kubernetes DR
- ✅ FAQ: 50+ Questions
- ✅ Pinata IPFS Setup Guide
- ✅ Implementation Summary
- ✅ Quick Start Guide

### Planned Updates

- [ ] Video tutorials
- [ ] Interactive examples
- [ ] Multi-language translations
- [ ] Community contributions guide
- [ ] Advanced topics section

---

## 🎯 Next Steps

1. **Choose your role**: Client, Freelancer, or Developer
2. **Follow the learning path** for your role
3. **Read the FAQ** for common questions
4. **Check the guides** for specific tasks
5. **Contact support** if you need help

---

**Happy learning! 🚀**

For the latest updates, visit [stellar-marketpay.com](https://stellar-marketpay.com)
