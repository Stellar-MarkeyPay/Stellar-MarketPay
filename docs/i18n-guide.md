# i18n Contributor Guide

Stellar MarketPay ships English, Spanish, French, and Portuguese via `i18next`.
This guide covers how translation keys are organized, how to add a new
string, and how the CI gate and dev-mode warning keep the four locales from
silently drifting apart.

## How it's wired

| Piece                                    | Location                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| Locale resource files (one per language) | `frontend/public/locales/{en,es,fr,pt}/common.json`                                       |
| i18next setup                            | `frontend/lib/i18n.js`                                                                    |
| App-wide `useTranslation()` hook         | `frontend/lib/i18n.js` (re-exported, not react-i18next's own hook)                        |
| Key-coverage audit logic                 | `frontend/lib/i18nAudit.ts`                                                               |
| Explicitly tracked pending keys          | `frontend/lib/i18nPendingKeys.json`                                                       |
| CI gate + dev-warning tests              | `frontend/__tests__/i18n-coverage.test.ts`, `frontend/__tests__/i18n-dev-warning.test.ts` |

There is a single namespace, `common`, shared by every locale file. English
(`en`) is the source of truth — every key that exists in `en/common.json`
must exist in `es`, `fr`, and `pt`, or be explicitly listed as pending.

## Adding a new string

1. Add the key to `frontend/public/locales/en/common.json`, nested under the
   section it belongs to (`nav`, `jobs`, `wallet`, `language`, `dao`, ...).
2. Add the same key, translated, to `es`, `fr`, and `pt` at the same nested
   path. Keep the key order consistent across all four files — it makes the
   diff reviewable and matches what the audit test expects to compare.
3. **If the string touches money, fees, escrow, payouts, or security**
   (anything where a mistranslation could mislead a user about funds or a
   security-relevant action), do not guess the translation. Instead:
   - Leave the key out of the locale(s) you can't confidently translate.
   - Add `"<the.new.key>"` to that locale's array in
     `frontend/lib/i18nPendingKeys.json`.
   - Open an issue (or flag in your PR) asking a native speaker to review
     and fill it in, then remove it from the pending list once translated.
4. Use the key in a component via the app's `useTranslation` hook:

   ```tsx
   import { useTranslation } from "@/lib/i18n";

   const { t } = useTranslation("common");
   t("nav.browseFreelancers");
   ```

5. Run the frontend test suite (`pnpm --filter frontend test`). The i18n
   coverage test fails the build if a key exists in `en` but is missing from
   another locale and isn't listed in `i18nPendingKeys.json`.

## Why a pending-keys list instead of translating everything immediately

Money/fee/escrow/payout/security copy is exactly the kind of string where a
plausible-sounding but wrong machine translation is worse than a visible gap.
`i18nPendingKeys.json` makes that gap explicit and trackable instead of
letting it silently fall back to English forever — which is the core problem
this issue exists to fix. A locale with tracked pending keys still passes the
CI gate; a locale with an _untracked_ missing key does not.

## The CI gate

`frontend/lib/i18nAudit.ts` flattens each locale's JSON into dot-path keys
(`"jobs.status.open"`, etc.) and diffs them against `en`, excluding anything
listed in `i18nPendingKeys.json`. `frontend/__tests__/i18n-coverage.test.ts`
runs that audit against the real locale files as part of the normal Jest
suite — which `npm test` already runs in CI (see `.github/workflows/ci.yml`)
— so a PR that adds an English key without updating (or explicitly
pending-listing) the other three locales fails CI with no extra workflow
step required.

## The dev-mode fallback warning

`fallbackLng: "en"` means a missing key never throws or renders blank — it
silently renders the English string. That's convenient for users but means
gaps are invisible during development. i18next's own `missingKeyHandler`
doesn't help here: it only fires when a key is missing from _every_ language
in the fallback chain, not when English successfully covers for one locale.

Instead, the app's `useTranslation()` hook in `frontend/lib/i18n.js` checks —
only when `process.env.NODE_ENV !== "production"` — whether the active
locale's own resource bundle has the key (via i18next's `getResource`, which
does a direct lookup with no fallback). If it doesn't, but English does, it
logs one `console.warn` per lookup and still returns the English value, so
the UI behaves exactly as it did before. Because the check is scoped to
non-English locales and skipped entirely in production, it never adds noise
in production and only ever fires for a genuine gap.
