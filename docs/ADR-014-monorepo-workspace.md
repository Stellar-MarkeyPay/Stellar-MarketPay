# ADR-014: Monorepo Workspace with pnpm and Turborepo

**Status:** Accepted  
**Date:** 2026-08-28  
**Author:** Stellar MarketPay Team  
**Stakeholders:** Frontend Team, Backend Team, Smart Contract Team, DevOps

## Context

Frontend, backend and contracts are three unrelated projects sharing a directory. There is no root package.json, dependency versions drift independently, domain types are duplicated between frontend and backend, and CI reinstalls and rebuilds everything on every change regardless of what was touched.

## Decision

We will adopt **pnpm workspaces** with **Turborepo** as the monorepo toolchain.

### Workspace Layout

```
stellar-marketpay/
  pnpm-workspace.yaml
  turbo.json
  package.json              (workspace root)
  .npmrc
  frontend/                 (Next.js — kept at root for minimal Docker/K8s path churn)
  backend/                  (Node.js/Express — kept at root for minimal Docker/K8s path churn)
  contracts/
    marketpay-contract/     (Rust/Soroban — not a Node package)
    evm-bridge/             (Solidity/Hardhat — optional Node package)
  packages/
    types/                  (shared TypeScript domain types)
    validation/             (Zod schemas shared by frontend and backend)
    api-client/             (frontend API client)
    utils/                  (formatting, currency, date utilities)
  docs/
  k8s/
  monitoring/
  terraform/
  scripts/
```

### Tool Selection

| Tool | Role |
|---|---|
| **pnpm workspaces** | Dependency management, hoisting, single install |
| **Turborepo** | Task pipeline, affected-only execution, remote caching |
| **Zod** | Runtime validation + TypeScript type inference for shared schemas |
| **TypeScript** | Shared type definitions in `packages/types` |

### Trust Model / Architecture

- The Rust crate is **not forced into the Node toolchain**. `contracts/marketpay-contract/` is excluded from the pnpm workspace. It is built independently via `cargo` and referenced by path in Turborepo's `pipeline`.
- Frontend and backend remain separate runtimes. Shared code flows through `packages/*` only.
- The platform (workspace tooling) is **not a trusted party** for user funds; it is purely a build/dev toolchain.

### Data Model

```
packages/types/src/
  job.ts          -> Job, JobStatus, JobMilestone, Currency, JobVisibility
  user.ts         -> UserProfile, UserRole, FreelancerTier, Availability
  application.ts  -> Application, ApplicationStatus
  referral.ts     -> ReferralStats, ReferralTreeNode, ReferralStatus
  bridge.ts       -> BridgeTransfer, BridgeTransferStatus, BridgeChain
  escrow.ts       -> EscrowState, EscrowStatus

packages/validation/src/
  jobSchema.ts    -> Zod schemas for Job, CreateJobInput
  userSchema.ts   -> Zod schemas for UserProfile
  applicationSchema.ts
```

### Reorg Safety (Build Pipeline)

- Turborepo's `--continue` flag ensures partial failures don't hide state.
- Each package has an independent `build` and `test` task.
- The Rust contract task is a leaf node with no Node dependencies.

### Recovery Path (Migration)

- Existing code is moved to workspace packages without renaming internal modules.
- A `backwards-compat` script rewrites old import paths in a single commit.

### Circuit Breaker (CI)

- `turbo run build test lint --continue` fails fast but reports all failures.
- Remote cache is enabled via `TURBO_TOKEN` and `TURBO_TEAM`.
- On `main`, full pipeline runs. On PRs, only affected packages run.

### Fee and Slippage (Dependency Alignment)

- All Node packages share a single `pnpm-lock.yaml` at root.
- A `sync-versions` script enforces aligned versions for shared deps (`@stellar/stellar-sdk`, `axios`, etc.).
- CI runs `pnpm dedupe` and fails if the lockfile drifts.

## Rationale

### Why pnpm + Turborepo?

- pnpm's strictness prevents phantom dependencies.
- Turborepo's hashing is content-aware, so unchanged packages are skipped locally and in CI.
- Remote caching reduces CI time measurably (before: full rebuild every run; after: cache hit for unaffected packages).
- Both tools are widely adopted, well-documented, and require no external service for local development.

### Why Not Nx?

- Nx is more prescriptive about project boundaries. Turborepo is lighter and fits our existing npm scripts with minimal rewriting.

### Why Not Single Package?

- The Rust crate must not be forced into Node. Keeping it as an excluded directory preserves its independent toolchain while still allowing Turborepo to orchestrate it.

## Consequences

- All developers must install pnpm (`corepack enable`).
- Paths in docs, Dockerfiles, Compose, Kubernetes and workflows are updated.
- Shared types are imported from `@marketpay/types` instead of local `utils/types.ts`.
- CI configuration is rewritten in Turborepo's pipeline format.

## Alternatives Considered

1. **npm workspaces + custom scripts** — Rejected: no built-in task pipeline or remote cache.
2. **Lerna** — Rejected: slower, heavier, and Turborepo supersedes its task graph.
3. **No monorepo** — Rejected: dependency drift and duplicated types continue to cause bugs.
