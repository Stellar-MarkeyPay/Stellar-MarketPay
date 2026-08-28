# 🏪 Stellar MarketPay

> A decentralised freelance marketplace powered by Stellar blockchain and Soroban smart contracts.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Storybook](https://img.shields.io/badge/Storybook-Component%20Library-ff4785.svg)](frontend/stories)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-purple)](https://soroban.stellar.org)
[![Backend Coverage](https://img.shields.io/badge/backend%20coverage-60%25%2B-brightgreen)](#testing)

Stellar MarketPay is an open-source decentralised freelance marketplace where clients post jobs, freelancers apply, and payments are secured in **Soroban smart contract escrow** — released automatically when work is approved. No middlemen. No payment delays. No platform fees eating your earnings..

---

## ✨ Features (v1)

- 🔗 **Wallet Connect** — Freighter browser wallet integration
- 📋 **Post Jobs** — Clients post jobs with XLM budget locked in escrow
- 🙋 **Apply & Bid** — Freelancers apply with proposals
- 🔒 **Escrow Payments** — Funds held in Soroban contract until work approved
- ✅ **Release & Complete** — Client approves → funds released to freelancer instantly
- 📜 **Job History** — Track all your jobs and earnings on-chain
- 🎨 **Component Library & Storybook** — 48+ isolated components, theme & i18n decorators, design tokens, and visual regression testing ([docs/design-tokens.md](docs/design-tokens.md))
- 🛡️ **Compliance Core** — Tiered individual/corporate KYC, SEP-12, continuous screening, transaction monitoring, Travel Rule exchange, human case decisions, jurisdiction policies, regulatory reports, and auditable encrypted data handling ([design](docs/COMPLIANCE_DESIGN_COMMENT.md), [operations](docs/COMPLIANCE_OPERATIONS.md))

---

## 🗂 Project Structure

```
stellar-marketpay/
├── frontend/              # Next.js + React + Tailwind CSS
├── backend/               # Node.js + Express API
├── contracts/             # Stellar Soroban smart contracts (Rust)
│   ├── marketpay-contract/# Soroban escrow contract (Rust/Cargo)
│   └── evm-bridge/        # EVM-side escrow bridge (Hardhat)
├── packages/              # Shared workspace packages
│   ├── types/             # @marketpay/types
│   ├── validation/        # @marketpay/validation
│   ├── utils/             # @marketpay/utils
│   └── api-client/        # @marketpay/api-client
├── docs/                  # Architecture & API documentation
├── scripts/               # Deployment & utility scripts
├── .github/               # CI/CD workflows & issue templates
├── pnpm-workspace.yaml    # pnpm workspace definition
├── turbo.json             # Turborepo pipeline config
├── CONTRIBUTING.md
├── ROADMAP.md
└── LICENSE
```

> **Note**: The Rust Soroban contract under `contracts/marketpay-contract/` is an independent Rust crate managed separately from the Node.js/pnpm workspace. It uses Cargo for building and testing.

---

## 🚀 Quick Start

### Prerequisites

| Tool             | Version                |
| ---------------- | ---------------------- |
| Node.js          | ≥ 18.x                 |
| npm              | Latest                 |
| Python 3         | ≥ 3.9 (for seeding)    |
| psql             | PostgreSQL client      |
| Rust + Cargo     | ≥ 1.74 (for contracts) |
| Freighter Wallet | Browser extension      |

### 1. Clone

```bash
git clone https://github.com/your-org/stellar-marketpay.git
cd stellar-marketpay
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Build all packages

```bash
pnpm build
```

### 4. Seed the database manually

```bash
# Small dataset (default, ~50 users / 20 jobs)
scripts/db/seed.sh --seed 42

# Medium performance dataset (~200 users / 100 jobs)
scripts/db/seed.sh --scale medium --seed 42

# Large dataset (~1000 users / 500 jobs)
scripts/db/seed.sh --scale large --seed 42
```

The seed script is deterministic: the same `--seed` always produces the same data.
All data is synthetic and contains no real personal information.

### 5. Start Frontend

```bash
pnpm --filter frontend dev
# → http://localhost:3000
```

### 6. Start Backend

```bash
pnpm --filter backend dev
# → http://localhost:4000
```

---

## 🔑 Environment Variables

See [docs/environment-variables.md](docs/environment-variables.md) for the full list of backend and frontend variables, validation rules, and examples.

Deploy the Soroban escrow contract with [docs/contract-deployment.md](docs/contract-deployment.md).

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_USE_CONTRACT_MOCK=false
```

### Backend (`backend/.env`)

```env
PORT=4000
DATABASE_URL=postgresql://stellarwork:stellarwork_dev@localhost:5432/stellarwork
JWT_SECRET=replace-with-a-long-random-secret
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
ALLOWED_ORIGINS=http://localhost:3000
```

---

## 🧪 Offline Development with Contract Mock

For frontend development without a deployed Soroban contract:

1. **Enable mock mode** in `frontend/.env.local`:

   ```env
   NEXT_PUBLIC_USE_CONTRACT_MOCK=true
   ```

2. **Start the frontend**:

    ```bash
    pnpm --filter frontend dev
    ```

3. **What works offline**:
   - ✅ Job creation with escrow locking
   - ✅ Start work, release escrow, refund escrow
   - ✅ Query escrow status and records
   - ✅ All contract calls logged to browser console
   - ✅ Realistic delays and error simulation
   - ✅ No Freighter signing required
   - ✅ No network calls to Stellar/Soroban

4. **Check the console**:
   All mock contract calls are logged with `[CONTRACT MOCK]` prefix for debugging.

5. **Switch back to real contract**:
   Set `NEXT_PUBLIC_USE_CONTRACT_MOCK=false` and provide a valid `NEXT_PUBLIC_CONTRACT_ID`.

---

## 🧪 Get Testnet XLM

1. Install [Freighter Wallet](https://freighter.app)
2. Switch to **Testnet** in Freighter settings
3. Visit [Stellar Friendbot](https://friendbot.stellar.org) with your public key
4. Receive 10,000 test XLM instantly

---

## Testing

| Suite                   | Command                                        | Notes                                            |
| ----------------------- | ---------------------------------------------- | ------------------------------------------------ |
| Frontend unit snapshots | `pnpm --filter frontend test`                      | Jest + React Testing Library                     |
| Update snapshots        | `pnpm --filter frontend test:update-snapshots`     | Regenerate when UI changes are intentional       |
| Backend unit + coverage | `pnpm --filter backend test`                       | HTML report in `backend/coverage/`               |
| E2E (Playwright)        | `pnpm --filter frontend test:e2e`                  | Includes full client/freelancer marketplace flow |

Deploy or upgrade the Soroban escrow contract using [docs/contract-deployment.md](docs/contract-deployment.md).

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) to get started. All skill levels welcome!

## 🗺 Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features.

## 📄 License

MIT — see [LICENSE](LICENSE)
