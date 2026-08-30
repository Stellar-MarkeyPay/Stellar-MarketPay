# Workflow hook plugin template

A minimal plugin that reacts to a platform event.

## Files

- `plugin.json` — the manifest: what events you subscribe to and what
  permissions you need. Edit `id`, `name`, and `version` for your own
  plugin; keep `entry` as `index.js`.
- `index.js` — your handler. Must assign a `plugin` object with an async
  `onEvent(payload, context)` to the global scope.

## Local testing (no live marketplace required)

From `backend/`:

```bash
node src/plugins/cli.js run src/plugins/templates/workflow-hook --hook job.created --payload '{"jobId":"job-1"}'
```

This runs your plugin in the exact same sandbox (`src/plugins/sandbox.js`)
production uses, with a stub broker that returns fixture data for every
`marketpay.call(...)` instead of hitting a real database — see
`src/plugins/cli.js`'s `FIXTURES` for what each stubbed method returns, and
edit them to exercise your own logic.

## Submitting

```
POST /api/plugins/submit
{ "manifest": <contents of plugin.json>, "source": "<contents of index.js>" }
```

Your submission is scanned automatically (`src/plugins/securityScan.js`)
before it reaches a human reviewer — see docs/ADR-011-plugin-platform.md
for what that scan checks and why passing it is necessary but not
sufficient (the sandbox itself is the real safety boundary).
