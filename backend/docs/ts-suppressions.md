# TypeScript Suppressions Audit

This document lists all `@ts-ignore`, `as any`, and `as unknown` usages in the
backend source code. Every entry was reviewed during the JS → TS migration.
New suppressions should not be added without updating this list.

> **Policy**: Prefer proper typing. Use `as any` only when the cost of full
> typing is disproportionate (e.g. dynamic ORM row shapes, third-party CJS
> interop). Each entry below states why the suppression exists.

## `@ts-ignore` — Import interop (6)

These suppress CJS/ESM interop warnings for `require()`-style modules that
lack type declarations or use default-export patterns.

| File                                 | Line | Reason                               |
| ------------------------------------ | ---- | ------------------------------------ |
| `src/db/pool.ts`                     | 7    | `requireEnv` has no type declaration |
| `src/db/migrate.ts`                  | 4    | Migration script CJS import          |
| `src/middleware/auth.ts`             | 5    | Orphaned (safe to remove)            |
| `src/middleware/apiKey.ts`           | 3, 5 | CJS requires without types           |
| `src/middleware/edgeCacheControl.ts` | 2    | CJS require                          |
| `src/middleware/rateLimiter.ts`      | 3    | CJS require                          |
| `src/services/store.ts`              | 8    | Legacy compat module                 |
| `src/utils/encryption.ts`            | 5    | CJS require                          |

## `as any` — Dynamic database rows (14)

Query results from `rawQuery<T>` sometimes return `Generated<Date>` or
aggregate fields not in the table interface. These casts are on read-only
values immediately consumed, so are safe.

| File                                    | Line    | Expression              | Reason                                    |
| --------------------------------------- | ------- | ----------------------- | ----------------------------------------- |
| `src/db/kysely.ts`                      | 19      | RawNode query object    | Kysely internal API shape                 |
| `src/routes/health.ts`                  | 61      | `result as any`         | `Promise.race` returns `unknown`          |
| `src/services/analytics.ts`             | 144     | `h.updated_at as any`   | `Generated<Date>` → `Date` ctor           |
| `src/services/jobService.ts`            | 929     | `originalDate as any`   | `Generated<Date>` → `Date` ctor           |
| `src/services/jobService.ts`            | 960     | `updatedJob as any`     | Adding dynamic `extensionFeeXlm`          |
| `src/services/jobService.ts`            | 1078    | Date arithmetic casts   | `Date - Date` math                        |
| `src/services/escrowService.ts`         | 22      | Milestone shape         | Dynamic row object                        |
| `src/services/escrowService.ts`         | 32-34   | Milestone fields        | camelCase/snake fallback                  |
| `src/services/escrowService.ts`         | 227     | Date arithmetic         | `Date - Date` math                        |
| `src/services/fraudDetectionService.ts` | 325-443 | `jobStats as any`       | Aggregate query extras (`mean`, `stdDev`) |
| `src/services/indexerService.ts`        | 241     | `typeMap as any`        | Dynamic string key lookup                 |
| `src/services/profileService.ts`        | 349     | `portfolioFiles as any` | User input validation                     |
| `src/services/referralService.ts`       | 562     | `root as any`           | Mutating inferred literal type            |
| `src/middleware/auth.ts`                | 26      | JWT decode result       | `jwt.verify` returns `JwtPayload          | string` |

## `as any` — Test assertions (6)

Test files use `as any` for mock shapes and dynamic assertions.
These do not weaken type safety in production code.

| File                                       | Line    | Reason                         |
| ------------------------------------------ | ------- | ------------------------------ |
| `src/config/cors.test.ts`                  | 20-54   | Cast CORS callback result      |
| `src/middleware/auth.test.ts`              | 19      | Mock request object            |
| `src/services/gasEstimatorService.test.ts` | 32-118  | Mock overrides and tier access |
| `src/services/cdn/cdnService.test.ts`      | 13, 107 | Mock provider call tracking    |

## `as unknown as string` (1)

| File                                  | Line | Expression                 | Reason                         |
| ------------------------------------- | ---- | -------------------------- | ------------------------------ |
| `src/services/weeklyDigestService.ts` | 341  | `digest_unsubscribe_token` | `Generated<string>` → `string` |

## `@ts-nocheck` — Pending Migration (1)

| File                             | Reason                       |
| -------------------------------- | ---------------------------- |
| `src/services/indexerService.ts` | Massive upstream JS refactor |

---

**Total: 28 suppression sites across 20 files.**  
One `@ts-nocheck` directive exists for `indexerService.ts` due to complex upstream refactor.
