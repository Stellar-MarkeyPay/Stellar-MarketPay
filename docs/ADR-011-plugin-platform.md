# ADR-011: Plugin Platform for Third-Party Marketplace Extensions

**Status:** Accepted
**Date:** 2026-08-26
**Author:** Stellar MarketPay Team
**Stakeholders:** Backend Team, Frontend Team, Security

## Context

`routes/developer.js` issues API keys for reading platform data; nothing
lets a third party extend the product's own behavior — react to a job
being posted, add a UI surface, run on a schedule. Issue #322 asks for
that: a plugin platform, with sandboxing as the load-bearing requirement
("This is the part that makes it safe or makes it a liability").

This document is the design record the issue asks be posted before code.
It also documents a real correction made mid-implementation: the first
sandbox design (`worker_threads`) was found, by testing, to have a failure
mode serious enough to change the architecture. That correction — not just
the final answer — is recorded here because it's the difference between
"we assumed this was safe" and "we verified it."

## Decision

### Extension model

Four extension points, deliberately closed (`backend/src/plugins/manifest.js`):
`ui_panel`, `workflow_hook`, `scheduled_task`, `data_provider`. A plugin
declares which it uses in `plugin.json`; the platform's set of hook names
(`WORKFLOW_EVENTS`) and permission scopes (`PERMISSION_KINDS`) are equally
closed enums. "A plugin API that exposes everything can never be changed"
(the issue's framing) — closing the vocabulary now is what keeps a future
API version able to deprecate one hook without an unbounded compatibility
surface.

Permissions are explicit, scoped strings (`read:jobs`, `write:notifications`,
`network:<exact-host>` — no wildcards). A manifest declares what it wants;
an installer grants a subset of that, never more (`pluginService.installPlugin`
rejects a request for anything the manifest didn't declare). This is the
"declares... grants explicitly" split the issue asks for, enforced at
install time, not trusted at runtime.

**Versioning and deprecation policy:** `manifest.apiVersion` pins which
version of the SDK surface (`backend/src/plugins/sdk/index.d.ts`) and
broker method set (`broker.js`'s `METHODS`) a plugin was written against.
A method is never removed within a major API version — only added to or,
if it must change shape, superseded by a new method name, with the old one
kept functioning for at least one full major version. This PR ships API
version `1.0`; the policy is recorded here ahead of ever needing to break
it.

**Data isolation between organisations:** a plugin's installation is scoped
to one `installer_address`; a private plugin (`plugins.visibility = 'private'`)
is further scoped to one `org_address` and invisible to every other
installer (`pluginService.listPlugins`, `installPlugin`'s visibility check).
Every broker call an invocation makes is scoped to the _installing_ user's
own data by construction — the broker has no method that takes an
arbitrary "whose data" parameter separate from the installation's own
identity.

### Sandboxing — the part that had to be right

Every plugin invocation (`sandbox.js`'s `runPlugin`) runs in two nested
boundaries:

1. **A forked OS process** (`child_process.fork`), fresh per call. Not a
   thread, not a same-process callback — a genuine separate process, own
   address space, own V8 instance, `--max-old-space-size` capped, `env: {}`
   (no inherited secrets), killed on a wall-clock timeout.
2. **Inside that process, a `vm.createContext` sandbox** with
   `codeGeneration: { strings: false }` and none of `require`, `process`,
   `fs`, `global`, or any Node builtin. The plugin's source runs only here.
   The one capability it's given is `marketpay.call(method, params)` —
   `childEntry.js`'s bridge, relayed to the parent, which mediates it
   through `broker.js` against the installation's granted permissions
   before doing anything.

**Why a forked process and not `worker_threads`, specifically:** the first
implementation used `worker_threads.Worker` with `resourceLimits` to cap
memory — the more commonly reached-for option, and initially it looked
sufficient (timeouts worked, thrown errors were contained, the happy path
was fine). Writing the negative test for a plugin that exhausts memory
(`sandbox.test.js`'s "a plugin that allocates one huge block cannot crash
the host process") surfaced that a **single allocation exceeding the
configured heap** — `new Array(1e7).fill("x")` in a tight loop — hits V8's
_fatal_ out-of-memory path rather than the graceful, catchable one.
A V8 fatal OOM is a native abort: not a JS exception, not a `worker`
`'error'` event, unconditional. For a `worker_threads` thread, sharing one
OS process with the code that spawned it, that abort **takes the entire
host process down**. Verified directly — `node -e` reproduction, exit code
134 (SIGABRT), core dumped, before the test process ever printed its next
line. That is exactly the failure the issue's acceptance criteria rule
out ("a plugin crash is contained and reported, never surfacing as a
platform failure"), and no amount of `resourceLimits` tuning changes it —
the fatal path bypasses that mechanism entirely for a large-enough single
allocation.

Switching the outer boundary to `child_process.fork()` — genuine OS
process isolation, not V8-isolate-only — fixed it: the same memory bomb
now aborts only the child; the parent observes a normal `'exit'` event
with `SIGABRT` and reports a contained `PluginError`. Re-verified with the
same reproduction. `sandbox.test.js`'s memory-bomb test is the regression
guard for this specific finding.

**Sandbox limitations — stated plainly, not left implicit.** Node's own
documentation says: _"the `vm` module is not a security mechanism; do not
use it to run untrusted code."_ Taken seriously, this means
`vm.createContext` alone does not stop a sufficiently determined plugin
from escaping to the outer (still-trusted, still full-Node) realm inside
its own child process — verified directly: an object injected into the
sandbox (`marketpay`) carries a `.constructor` chain back to the outer
realm's `Function`, and `marketpay.constructor.constructor("return
process")()` reaches full Node access in that process, `codeGeneration:
{ strings: false }` notwithstanding (that setting blocks code generation
_in the restricted context_; the constructor-chain trick generates the new
function in the _outer_, unrestricted context, then merely calls the
result). Two things narrow this gap:

- The forked-process boundary above still holds regardless — an escape
  reaches the _child's_ Node APIs, never the host process or another
  plugin's process. This is a real, contained blast radius, not the whole
  system.
- Node's Permission Model (`--permission`, no `--allow-*` grants) closes
  the most damaging escalation from that point: `fs`, `child_process`, and
  `worker_threads` are gated at Node's runtime binding layer, which holds
  even when reached via the constructor-chain trick (verified — see
  `sandbox.test.js`'s "constructor-chain escape cannot reach the
  filesystem"). **One gap remains and is not yet closable by any Node
  flag as of this writing: raw network sockets (`net`/`http`/`dgram`) are
  not gated by the Permission Model**, so a plugin that deliberately
  attacks the sandbox (as opposed to one that simply uses the SDK it was
  given) could still exfiltrate data over the network from inside its
  child process, bypassing `broker.js`'s allowlist. `env: {}` limits what
  there is to exfiltrate (no inherited secrets), and this is exactly why
  the automated security scan (below) and human review exist as
  additional, independent layers — the sandbox is the hard floor, not the
  only defense. Closing this fully in production means running plugin
  child processes under an OS-level network-namespaced or
  container/microVM boundary (gVisor, Firecracker, or a Linux network
  namespace with egress only through the broker's own process) — real
  infrastructure work, tracked as a named follow-up, not silently assumed
  solved by the code in this PR.

**Not WebAssembly.** A WASM runtime was considered as the sandbox
foundation and set aside for this PR: it would give strong capability
isolation _natively_ (no ambient host object model to walk a constructor
chain through, closing exactly the gap above), but requires a plugin
author to target WASM or a second build toolchain, and this platform has
no existing WASM tooling to build on. The forked-process + `vm` design
above achieves the process-crash-containment and mediated-network
properties the acceptance criteria ask for today, with the constructor-chain
gap disclosed rather than hidden. Revisiting WASM (or a proper V8-isolate
embedder, the approach real multi-tenant JS platforms use) is the correct
answer if this platform ever needs to fully close that gap without OS-level
infrastructure.

### UI extension isolation

A `ui_panel` plugin's surface renders inside `PluginFrame.tsx`: an
`<iframe sandbox="allow-scripts">` with **no `allow-same-origin`**,
fed via `srcDoc`. That combination gives the frame a unique opaque origin
on every render — not merely cross-origin from the host, but equal to no
origin anywhere else, ever. Concretely: the plugin's script cannot read
the host page's DOM, cookies, or `localStorage` (standard same-origin
policy), and — the specific property the issue calls "critical" —
**cannot reach `window.freighter` or any wallet extension's injected
API**, because extensions inject content scripts by origin-matching rules
that an opaque `srcDoc` origin never satisfies. The only channel is
`postMessage`; if a plugin's UI needs a signature, it posts a _request_
describing what to sign, and the actual Freighter flow runs entirely in
the host's own trusted UI — the plugin is told the outcome, never given
the wallet API, the private key, or a code path that could auto-approve.

### Developer experience

- **SDK types**: `backend/src/plugins/sdk/index.d.ts` — the full
  `marketpay.call(...)` surface, versioned with `apiVersion`.
- **Template**: `backend/src/plugins/templates/workflow-hook/` — a working
  `plugin.json` + `index.js` + README.
- **Local test harness**: `backend/src/plugins/cli.js` — runs a plugin
  directory through the _real_ sandbox (`sandbox.js`, unmocked) against
  either offline fixtures (default; no database, no network) or `--live`
  data. Directly answers "provide a testing harness so a plugin can be
  tested without a live marketplace."
- **Hot reload / full local dev environment**: not shipped in this PR — the
  CLI harness covers the "test without a live marketplace" requirement;
  a `watch`-and-rerun mode is a small, separable follow-up once there's
  usage to justify the extra surface.

### Distribution — registry, review, install/uninstall

Data model (`backend/src/db/migrations/V18__plugin_platform.up.sql`):

```
plugins               identity, ownership, visibility (public/private + org)
plugin_versions        every submission: manifest, source, scan result,
                        review status — immutable once created
plugin_installations    (version, installer) with the exact granted
                        permission scopes — never wider than the manifest
plugin_invocation_logs  every sandboxed run: outcome, timing, error detail
```

**Review pipeline**: `pluginService.submitPluginVersion` runs manifest
validation and the automated security scan
(`backend/src/plugins/securityScan.js` — flags forbidden Node builtins,
`eval`/`Function` construction, prototype tampering, and any import outside
the SDK's own namespace) synchronously at submission time. **A submission
that fails the scan is recorded `review_status = 'rejected'` immediately
and never reaches a human reviewer** — the scan is a hard gate, not a
warning. A version that passes waits for an admin's explicit
approve/reject (`POST /api/plugins/versions/:versionId/review`,
admin+2FA-gated, matching this codebase's existing admin route pattern).

The scanner is deliberately a coarse, textual/AST-parse gate, not the
safety boundary itself — see "Sandbox limitations" above for why: a scan
can be evaded by a determined author; the sandbox contains the result
either way. Its job is to reject the cheap, common cases before a
reviewer's time is spent and before a plugin with an obvious red flag ever
runs at all.

**Versioning, updates, rollback**: `plugins.active_version_id` points at
one approved `plugin_versions` row. Publishing a new release and rolling
back to an older one are the _same_ operation — moving that pointer — and
neither ever deletes or rewrites a version row, so a rollback is instant
and a previously-installed version's exact source is always still on
record.

**Install / uninstall / data removal**: `installPlugin` computes the
granted-permission intersection and records it; `uninstallPlugin` disables
the row and clears `config`/`granted_permissions` to empty (Issue #322's
"including data removal") while keeping the row itself, soft-deleted, so
invocation history stays attributable without resurrecting the old grant
on a future reinstall.

**Private plugins**: `plugins.visibility = 'private'` + `org_address`
scopes a plugin to one organisation's installers only; it never appears in
the public listing (`listPlugins`) and installing it from outside that
`org_address` is rejected.

## Consequences

### Positive

- Genuine process-level crash containment, verified by directly
  reproducing and then fixing the failure mode a naive `worker_threads`
  design has.
- A plugin cannot observe or intercept a wallet signing flow — a browser
  guarantee (`sandbox` + opaque origin), not a policy this code merely
  asserts.
- Permissions are explicit, capped at what the manifest declared, and
  computed once at install time.
- Same sandbox code path (`sandbox.js`, `childEntry.js`) runs a
  submission's automated test, the CLI harness, and a real production
  invocation — nothing different is exercised in review than what actually
  runs.

### Negative

- Raw network egress is not yet fully closable against a plugin that
  deliberately attacks the sandbox (see "Sandbox limitations"). Mitigated
  by `env: {}`, the automated scan, and human review; not eliminated.
  Closing it fully needs OS-level infrastructure (network namespace or
  microVM) beyond this PR's scope.
- A new OS process per invocation has real overhead (tens of milliseconds
  of fork + Node startup) compared to a warm thread pool. Acceptable for
  webhook-style workflow hooks; would need a pooling strategy revisit if
  `scheduled_task`/`data_provider` volume grows into a hot path.
- No hot-reload local dev loop yet — the CLI harness is one-shot per run.
- WASM was considered and deferred (see "Not WebAssembly"); revisiting it
  is the durable fix for the constructor-chain gap.

## Related ADRs

- ADR-010: Zero-Knowledge Reputation — another subsystem in this same
  batch built around the same principle of stating a system's actual trust
  boundary precisely rather than implying a stronger guarantee than what
  was verified.

## References

- Issue #322 — epic: build a plugin platform for third-party marketplace
  extensions
- `backend/src/plugins/` — manifest, securityScan, sandbox, childEntry,
  broker, cli, sdk, templates
- `backend/src/services/pluginService.js`
- `backend/src/routes/plugins.js`
- `backend/src/db/migrations/V18__plugin_platform.{up,down}.sql`
- `frontend/components/PluginFrame.tsx`
