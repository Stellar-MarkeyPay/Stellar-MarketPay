# 🤝 Contributing to Stellar MarketPay

Thank you for your interest in contributing! Stellar MarketPay is open source and welcomes contributors of all skill levels.

---

## 🍴 How to Fork & Set Up

```bash
# 1. Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/stellar-marketpay.git
cd stellar-marketpay

# 2. Add upstream
git remote add upstream https://github.com/your-org/stellar-marketpay.git

# 3. Run setup
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

---

## 🌿 Branch Naming

```
feature/job-search-filters
fix/escrow-release-bug
docs/update-api-reference
chore/upgrade-stellar-sdk
contracts/implement-milestone-escrow
```

---

## 💬 Commit Style & Git Hooks

We enforce [Conventional Commits](https://www.conventionalcommits.org/) via **commitlint** and **Husky**:

```text
feat(frontend): add job search filters
fix(backend): correct escrow balance calculation
docs: add milestone payment guide
contracts: implement dispute resolution
chore(ci): upgrade workflow actions
```

To use an interactive commit prompt:

```bash
npm run commit
```

Local git hooks automatically run `lint-staged` on `pre-commit`, `commitlint` on `commit-msg`, and fast unit test suites on `pre-push`.

> For complete hook guidelines, escape hatch documentation (`--no-verify`), and benchmark details, see [docs/GIT_HOOKS_AND_COMMITS.md](./docs/GIT_HOOKS_AND_COMMITS.md).

---

## 🔃 Submitting a Pull Request

1. Create a branch from `main`
2. Make your changes
3. Push and open a PR against `main`
4. Fill in the PR template
5. Link related issues with `Closes #123`

### PR Checklist

- [ ] Tested locally on Testnet
- [ ] No TypeScript / Rust errors
- [ ] Documentation updated if needed
- [ ] No breaking changes (or clearly documented)

---

## 📁 Project Structure

```
stellar-marketpay/
├── frontend/
│   ├── components/     ← Reusable UI components
│   ├── pages/          ← Next.js routes
│   ├── lib/            ← Stellar SDK + wallet helpers
│   └── utils/          ← Shared utilities
├── backend/
│   └── src/
│       ├── routes/     ← Express route definitions
│       ├── controllers/← Request handlers
│       ├── services/   ← Business logic
│       └── middleware/ ← Auth, validation, rate limiting
├── contracts/          ← Soroban smart contracts (Rust)
└── docs/               ← Architecture & API docs
```

Look for `good first issue` labels to find beginner-friendly tasks!

---

## Testing

### Frontend snapshot tests

Component snapshots live under `frontend/__tests__/` and cover `JobCard`, `JobCardSkeleton`, `RatingForm`, `Toast`, `FreelancerTierBadge`, and `Navbar`.

```bash
cd frontend
npm test
```

When you intentionally change UI markup, regenerate snapshots:

```bash
npm run test:update-snapshots
```

CI runs `npm test` without `-u`, so outdated snapshots fail the build.

### Backend coverage

```bash
cd backend
npm test
```

Coverage HTML is written to `backend/coverage/`. Thresholds are enforced in `backend/package.json` (minimum 60% lines, 50% branches on covered middleware and service modules). The full suite in `src/services/*.test.js` still runs on every `npm test`.

### End-to-end tests

```bash
cd frontend
npm run test:e2e
```

`tests/e2e/full-marketplace-flow.spec.ts` exercises the full client and freelancer journey with two mock Freighter accounts and `NEXT_PUBLIC_USE_CONTRACT_MOCK=true` (no testnet required).

### Smart contract deployment

See [docs/contract-deployment.md](docs/contract-deployment.md) for Soroban build, deploy, and env configuration steps.

---

## 🌍 Adding Translated Strings

The frontend ships English, Spanish, French, and Portuguese via `i18next`.
Before adding or changing a user-facing string, read the
**[i18n Contributor Guide](docs/i18n-guide.md)**. It covers:

- Where locale files live and how to add a key to all four languages
- Why money/fee/escrow/payout/security strings go into a tracked pending
  list instead of being guessed at, and how to fill them in later
- The CI check that fails a PR when a locale is missing an English key
- The dev-mode console warning that flags a silent fallback to English

---

## 🦀 Smart Contract Contributions

The Soroban escrow contract (`contracts/marketpay-contract`) is the
highest-risk component in the repository — bugs there can permanently lose user
funds.

Before opening a PR that touches `contracts/`, read the
**[Contract Contributor Guide](docs/contract-contributor-guide.md)**. It covers:

- Local toolchain setup, building the WASM, running tests, and clippy
- The `test_snapshots/` mechanism and how to review a snapshot diff in a PR
- The mandatory review bar for any change that moves funds (authorization
  checks, arithmetic requirements, required test coverage)
- Storage-compatibility rules for `DataKey` and `#[contracttype]` structs
- A complete worked example of adding a new entrypoint with tests

The PR checklist below applies to contract changes too, with the additional
requirement that any fund-moving change must receive an explicit approval from
a reviewer who has read the snapshot diff.
