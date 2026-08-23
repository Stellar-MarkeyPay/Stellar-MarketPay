# Sensitive endpoint rate limiting

This document describes the trust model and operational behavior introduced for issue #163.

## Threat model

Sensitive endpoints are protected against two different forms of pressure:

1. **client-origin pressure** — one client attempts many requests while rotating account identifiers; and
2. **principal pressure** — repeated attempts against one authenticated account across multiple clients or application instances.

A caller-supplied wallet/public key is **not** treated as a globally trusted account identifier before ownership has been established. Making an unverified public identifier a global lockout key would allow a third party to throttle a victim simply by knowing that public identifier.

## Bucket scoping

- **Effective client IP** — shared globally through Redis; limits clients that rotate principals.
- **Authenticated principal (`req.user.publicKey`)** — shared globally through Redis; follows the authenticated account across IPs.
- **Pre-auth/caller-supplied principal** — bound to the effective client IP before entering shared Redis state; adds local principal pressure without creating a victim-wide lockout primitive.

Raw IPs and principals are hashed before they are used in external rate-limit keys.

## Current limits

- **SEP-10 auth** — 5-minute window; IP max 20; principal max 8; challenge/account input is IP-bound until authenticated.
- **WebAuthn public login** — 5-minute window; IP max 20; principal max 10; request `publicKey` is IP-bound before authentication.
- **WebAuthn authenticated account routes** — 5-minute window; IP max 30; principal max 20; principal comes from a verified JWT.
- **Admin 2FA** — 5-minute window; IP max 15; principal max 6; principal comes from a verified JWT.
- **Legacy/dormant 2FA router** — 5-minute window; IP max 15; principal max 6; principal comes from a verified JWT.
- **Faucet router** — 60-minute window; IP and principal maxima are configurable; request/path public keys are IP-bound before authentication.

The dormant 2FA and faucet routers are not mounted by this change. Their middleware is hardened without changing route availability.

## Authentication backoff

Repeated failed authentication can add a bounded exponential delay. The same trust rule applies:

- authenticated principals may accumulate backoff across IPs;
- pre-auth principals are bound to the effective client IP;
- success clears the relevant failure history;
- the backoff is capped and returns `Retry-After` while active.

The existing PostgreSQL-backed TOTP lockout in `twoFactorService.verify2FA()` remains the authoritative account-level TOTP lockout. This change does not introduce a second competing TOTP account-lockout state machine.

## Shared state and failure behavior

Sensitive limiter state is stored in Redis so counters survive process restarts and are visible across application instances. CI includes a Redis-backed integration test that increments the same bucket through two independent Redis clients.

If the security limiter cannot reach Redis, it fails closed with a generic service-unavailable error rather than silently falling back to process-local memory. Redis connection/command latency is bounded so a degraded Redis service cannot hang requests indefinitely.

## Response behavior

Rate-limited responses:

- return HTTP `429`;
- include a `Retry-After` value based on the actual bucket reset/backoff TTL;
- include `Cache-Control: no-store`;
- use a generic response body that does not identify the triggering bucket or account.

## WebAuthn enumeration boundary

This work does not claim to solve credential discovery in `login-options`. That endpoint currently returns `allowCredentials` for the supplied public key. Fully hiding whether an account has registered passkeys may require a separate username-less/discoverable-credential design change so existing passkeys are not broken.
