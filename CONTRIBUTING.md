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

Local Git hooks validate staged-index snapshots on `pre-commit`, run `commitlint` on ordinary
messages, and execute only affected project suites on `pre-push`. Diagnose setup with
`npm run hooks:doctor`.

> For complete hook guidelines, escape hatch documentation (`--no-verify`), and benchmark details, see [docs/GIT_HOOKS_AND_COMMITS.md](./docs/GIT_HOOKS_AND_COMMITS.md).

---

## 🛡️ Merge Policy

Alongside linting and tests, the hooks run a **merge policy** — a small set of
rules drawn from failures this repository has actually had: a contract
entrypoint changed with no test, a stored type reshaped with no migration
note, a deleted `Cargo.lock`, a migration with no rollback, a test that asserts
against the wall clock, a credential in a diff.

The rules are defined once, in
[`policy/policies.json`](./policy/policies.json), and the same definition is
executed by the local hook and by a required CI check. A rule can be a warning
locally and an error in CI, but it is never _detected_ differently — so
`--no-verify` changes **when you find out** about a violation, never whether it
is enforced.

```bash
npm run policy:check      # what the hooks will say about this branch
npm run policy:ci         # what CI will say about it
```

Findings name the file, the rule and the fix. If one does not, that is a
defect — open an issue. If a rule is wrong for a specific change, it can be
overridden with an approver and an expiry rather than disabled; if it is wrong
in general, argue with the **Why** paragraph in the catalogue and change it.

- **[docs/POLICY_CATALOGUE.md](./docs/POLICY_CATALOGUE.md)** — every rule and its rationale
- **[docs/POLICY_ENGINE.md](./docs/POLICY_ENGINE.md)** — how it works, and how to add a rule

### Signing your commits

```bash
npm run policy:signing-setup
```

One-time enrolment; see [docs/COMMIT_SIGNING.md](./docs/COMMIT_SIGNING.md).
Signing currently warns rather than blocks, and will become required once
contributors have enrolled.

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
- [ ] New/updated components include Storybook stories (`*.stories.tsx`) covering default, loading, error, and overflow states
- [ ] Storybook builds cleanly (`npm run build-storybook`) and passes a11y tests (`npm run test:a11y`)
- [ ] Uses documented design tokens ([docs/design-tokens.md](./docs/design-tokens.md)) rather than ad-hoc arbitrary values
- [ ] Documentation updated if needed
- [ ] No breaking changes (or clearly documented)
- [ ] `npm run policy:ci` is clean — or every remaining finding is explained in the PR body
- [ ] A change to `Escrow`, `DataKey` or another stored type carries a `Storage-Compat:` commit trailer

---

## 🎨 Component Development & Storybook Guidelines

All frontend UI components live under `frontend/components/` and are developed in isolation using Storybook.

### Rules for Components:

1. **Stories are Mandatory**: Every component MUST ship with a corresponding `[ComponentName].stories.tsx` file covering:
   - Default state
   - Loading & Skeleton states (where applicable)
   - Empty & Error states (where applicable)
   - Long-content overflow & edge cases
2. **Design Tokens as Source of Truth**: Always use the design tokens from `frontend/styles/tokens.ts` and Tailwind design system tokens. Do not introduce arbitrary hardcoded values. See [docs/design-tokens.md](./docs/design-tokens.md).
3. **Accessibility (WCAG 2.1 AA)**: Components must pass automated accessibility checks. Interactive elements must provide proper labels, keyboard navigation (Escape, Enter, Tab), and touch targets of at least `44px`.
4. **Shared Primitives**: When adding common UI controls (buttons, badges, inputs, dialogs, cards), reuse or extend the primitives in `frontend/components/primitives/`.

### Storybook Commands (inside `frontend/`):

```bash
# Start local Storybook environment
npm run storybook

# Build static Storybook bundle for review
npm run build-storybook

# Run automated accessibility checks
npm run test:a11y

# Run visual regression tests
npm run test:visual
```

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

## 🏛️ Architecture Decision Records (ADRs)

`docs/ADR-NNN-*.md` records decisions that are hard to reverse and not
obvious from reading the code alone — see `docs/ADR-001` through
`docs/ADR-008` for the existing set and format.

Write a new ADR when your PR:

- Chooses between two or more genuinely viable approaches (a framework,
  data model, consensus/arbitration mechanism, deployment topology, etc.)
  and picking wrong would be expensive to undo later.
- Changes a fee, reward-split, or economic parameter baked into the
  contract or backend (e.g. `PLATFORM_FEE_BPS`), where the _why_ behind the
  chosen value or split isn't obvious from the diff.
- Introduces or replaces a cross-cutting mechanism — a caching layer,
  disaster-recovery topology, indexing strategy, arbitration model — that
  other future PRs will need to understand before extending or replacing.

You probably don't need one for a bug fix, a new UI component, an added
test, a dependency bump, or an internal refactor that doesn't change any
externally-observable decision.

Each ADR must include the **Context**, **Decision**, **Rationale**
(including alternatives considered and why they were rejected — not just
the outcome), and **Consequences** sections in the existing format, and
should link to the specific files/modules it governs so a future reader can
find the implementation from the decision and vice versa. If you can't find
solid evidence for _why_ a past decision was made (no commit, PR, or doc
explains it), say so explicitly in the ADR — mark it as reconstructed and
unconfirmed — rather than inventing a plausible-sounding rationale.

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
