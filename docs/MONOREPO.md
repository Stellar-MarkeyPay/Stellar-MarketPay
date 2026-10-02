# Monorepo Workspace Guide

## Overview

Stellar MarketPay is a **pnpm + Turborepo** monorepo. All JavaScript/TypeScript packages are managed through the root `package.json` using pnpm workspaces, with Turborepo orchestrating the build, test, and lint pipelines.

```
stellar-marketpay/
├── pnpm-workspace.yaml    # Workspace package globs
├── turbo.json             # Pipeline, caching, and remote cache config
├── package.json           # Root scripts (delegates to Turbo)
├── frontend/              # Next.js application
├── backend/               # Express API
├── contracts/
│   └── evm-bridge/        # Hardhat EVM bridge
├── packages/
│   ├── types/             # @marketpay/types
│   ├── validation/        # @marketpay/validation
│   ├── utils/             # @marketpay/utils
│   └── api-client/        # @marketpay/api-client
└── contracts/
    └── marketpay-contract/# Rust/Soroban — independent Cargo crate
```

## Workspace Packages

| Package | Location | Description |
|---------|----------|-------------|
| `frontend` | `./frontend` | Next.js 14 + React + Tailwind CSS client application |
| `backend` | `./backend` | Node.js + Express REST API server |
| `contracts/evm-bridge` | `./contracts/evm-bridge` | Hardhat EVM-side escrow bridge |
| `packages/types` | `./packages/types` | Shared TypeScript type definitions |
| `packages/validation` | `./packages/validation` | Zod validation schemas |
| `packages/utils` | `./packages/utils` | Shared utility functions |
| `packages/api-client` | `./packages/api-client` | Axios-based API client |

## Quick Start

```bash
# Install all workspace dependencies
pnpm install

# Build all packages (dependency order respected)
pnpm build

# Run all tests
pnpm test

# Lint all packages
pnpm lint
```

## Running Tasks for a Single Package

Use `--filter` (or `-F`) to run a script in a specific workspace package:

```bash
# Frontend
pnpm --filter frontend dev
pnpm --filter frontend build
pnpm --filter frontend test

# Backend
pnpm --filter backend dev
pnpm --filter backend test

# A shared package
pnpm --filter @marketpay/types build
```

You can also filter by directory or name pattern:

```bash
pnpm --filter ./packages/* build
```

## Running Affected Tasks

Turborepo tracks which packages changed and only rebuilds/re-tests what is necessary:

```bash
# Build only packages affected by current changes
pnpm turbo run build --continue

# Test only affected packages
pnpm turbo run test --continue

# Lint only affected packages
pnpm turbo run lint --continue
```

The `--continue` flag ensures that if one package fails, the rest still run.

## Remote Cache Setup

Turborepo can cache build outputs in a remote storage (e.g., Vercel, S3, GCS, or a self-hosted server).

1. Sign up at [https://turbo.build/repo](https://turbo.build/repo) and create a repository.
2. Authenticate Turbo with your token:

   ```bash
   pnpm turbo login
   ```

3. Link the repository:

   ```bash
   pnpm turbo link
   ```

4. Verify remote caching is working:

   ```bash
   pnpm turbo run build --force
   ```

   Subsequent runs should show `FULL TURBO` when outputs are retrieved from the remote cache.

For self-hosted or custom remote caches, set `TURBO_TOKEN` and `TURBO_TEAM` in your CI environment.

## Adding New Packages

1. Create the package directory with its own `package.json`.
2. Add the package to `pnpm-workspace.yaml`:

   ```yaml
   packages:
     - "frontend"
     - "backend"
     - "contracts/evm-bridge"
     - "packages/*"
     - "packages/new-package"  # add here
   ```

3. Add workspace dependencies using the `workspace:*` protocol:

   ```json
   {
     "dependencies": {
       "@marketpay/types": "workspace:*"
     }
   }
   ```

4. Define scripts (`build`, `test`, `lint`, etc.) in the package `package.json` so Turborepo can orchestrate them.
5. Run `pnpm install` from the root to symlink the new package.

## Dependency Alignment Rules

- **pnpm only**: Do not use `npm` or `yarn` inside the workspace. Use `pnpm add`, `pnpm remove`, or `pnpm update`.
- **Workspace protocol**: Internal packages must reference each other with `workspace:*` (e.g., `"@marketpay/types": "workspace:*"`). Do not publish internal packages to the registry.
- **Single `node_modules`**: pnpm creates a single root `node_modules` with content-addressable storage. Do not add nested `node_modules` in workspace packages.
- **Engines**: The root `package.json` enforces `"node": ">=22.12.0"` and `"pnpm": ">=9.0.0"`. All workspace packages should align with these versions.
- **Lock file**: `pnpm-lock.yaml` is the single source of truth for dependency versions. Commit it on every change.
- **Script parity**: Every workspace package should expose `build`, `test`, and `lint` scripts so Turborepo can run them uniformly.
- **Independent crates**: Rust crates (e.g., `contracts/marketpay-contract`) are **not** part of the pnpm workspace. Manage them with Cargo independently. Do not add them to `pnpm-workspace.yaml`.

## Independent Rust Crates

The Soroban smart contract in `contracts/marketpay-contract/` is an independent Rust project:

- It has its own `Cargo.toml` and is built with `cargo build`.
- It is **not** listed in `pnpm-workspace.yaml`.
- Do not add Node.js tooling to this crate.
- Contract deployment and testing use standard Rust/Soroban CLI commands.
