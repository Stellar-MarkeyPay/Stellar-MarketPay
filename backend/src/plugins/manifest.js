/**
 * src/plugins/manifest.js
 *
 * Plugin manifest schema and validation (Issue #322).
 *
 * Every plugin ships a `plugin.json` describing, declaratively, everything
 * it might do — before any of its code runs. This is the permission model's
 * foundation: "a plugin API that exposes everything can never be changed"
 * (the issue's own framing) means the set of things a plugin can even ask
 * for has to be a fixed, versioned enum, not "whatever the code happens to
 * call." The runtime (sandbox.js) refuses to grant anything not declared
 * here, and the installing user sees exactly this list before granting it.
 */
"use strict";

/** Extension points a plugin may register for. Deliberately closed — see
 *  module doc comment above. */
const EXTENSION_POINTS = Object.freeze([
  "ui_panel", // a UI surface rendered in a sandboxed iframe (see frontend PluginFrame)
  "workflow_hook", // runs on a platform event (job.created, application.accepted, ...)
  "scheduled_task", // runs on a cron-like schedule
  "data_provider", // supplies data to a named platform integration point
]);

/** Platform events a `workflow_hook` may subscribe to. Closed for the same
 *  reason as EXTENSION_POINTS — new hook points are a deliberate API change,
 *  not a side effect of a plugin author discovering an internal event name. */
const WORKFLOW_EVENTS = Object.freeze([
  "job.created",
  "job.completed",
  "application.submitted",
  "application.accepted",
  "escrow.released",
  "dispute.raised",
]);

/**
 * Permission scopes a plugin may request. Each is a capability the
 * installing user grants explicitly at install time (see
 * pluginService.installPlugin) — never inherited from a broader "trusted
 * plugin" tier. `network:<host>` requests egress to one specific host
 * through the broker (see broker.js); there is no `network:*`.
 */
const PERMISSION_KINDS = Object.freeze([
  "read:jobs",
  "read:applications",
  "read:profile",
  "write:notifications",
  "network", // followed by an allowlisted host, e.g. "network:api.example.com"
]);

const MAX_MANIFEST_BYTES = 8 * 1024;
const MAX_PERMISSIONS = 20;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

function fail(errors, message) {
  errors.push(message);
}

/**
 * Validate a parsed manifest object. Returns `{ valid, errors }` — never
 * throws, so a malformed submission is a normal rejected-with-reasons
 * response, not a 500.
 */
function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["manifest must be a JSON object"] };
  }

  if (!PLUGIN_ID_RE.test(manifest.id || "")) {
    fail(
      errors,
      "id must be 3-64 lowercase alphanumeric/hyphen characters, starting with a letter or digit"
    );
  }
  if (!manifest.name || typeof manifest.name !== "string" || manifest.name.length > 100) {
    fail(errors, "name is required (max 100 chars)");
  }
  if (!SEMVER_RE.test(manifest.version || "")) {
    fail(errors, "version must be semver (e.g. 1.0.0)");
  }
  if (!manifest.apiVersion || typeof manifest.apiVersion !== "string") {
    fail(errors, "apiVersion is required (the plugin API version this plugin targets)");
  }

  const extensionPoints = manifest.extensionPoints;
  if (!Array.isArray(extensionPoints) || extensionPoints.length === 0) {
    fail(errors, "extensionPoints must be a non-empty array");
  } else {
    for (const ep of extensionPoints) {
      if (!EXTENSION_POINTS.includes(ep)) {
        fail(errors, `unknown extension point "${ep}"`);
      }
    }
  }

  if (extensionPoints?.includes("workflow_hook")) {
    const events = manifest.workflowEvents;
    if (!Array.isArray(events) || events.length === 0) {
      fail(errors, "workflowEvents is required when extensionPoints includes workflow_hook");
    } else {
      for (const ev of events) {
        if (!WORKFLOW_EVENTS.includes(ev)) fail(errors, `unknown workflow event "${ev}"`);
      }
    }
  }

  if (extensionPoints?.includes("scheduled_task")) {
    if (typeof manifest.schedule !== "string" || !manifest.schedule.trim()) {
      fail(
        errors,
        "schedule (cron expression) is required when extensionPoints includes scheduled_task"
      );
    }
  }

  const permissions = manifest.permissions || [];
  if (!Array.isArray(permissions)) {
    fail(errors, "permissions must be an array");
  } else {
    if (permissions.length > MAX_PERMISSIONS)
      fail(errors, `at most ${MAX_PERMISSIONS} permissions`);
    for (const perm of permissions) {
      const permStr = String(perm);
      const kind = permStr.split(":")[0];
      if (kind === "network") {
        const host = permStr.slice("network:".length);
        if (!host || host === "*" || /[/\s]/.test(host)) {
          fail(errors, `network permission must name one specific host, got "${perm}"`);
        }
      } else if (!PERMISSION_KINDS.includes(permStr)) {
        fail(errors, `unknown permission "${perm}"`);
      }
    }
  }

  if (manifest.entry !== "index.js") {
    fail(errors, 'entry must be "index.js" (the only file the sandbox loads)');
  }

  return { valid: errors.length === 0, errors };
}

function assertManifestSize(rawJson) {
  const bytes = Buffer.byteLength(rawJson, "utf8");
  if (bytes > MAX_MANIFEST_BYTES) {
    throw Object.assign(new Error(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes`), { status: 400 });
  }
}

module.exports = {
  EXTENSION_POINTS,
  WORKFLOW_EVENTS,
  PERMISSION_KINDS,
  MAX_MANIFEST_BYTES,
  MAX_PERMISSIONS,
  validateManifest,
  assertManifestSize,
};
