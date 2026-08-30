/**
 * src/plugins/broker.js
 *
 * The mediated capability broker (Issue #322): the only thing standing
 * between a plugin's `marketpay.call(method, params)` and an actual
 * platform API or network request. Runs in the trusted parent process —
 * never inside the sandboxed worker — so it can check every call against
 * what the plugin actually declared and the installer actually granted,
 * no matter what the plugin's own code claims about itself.
 *
 * Two enforcement layers per call:
 *   1. `method` must map to one of the fixed RPC methods below (an
 *      unrecognized method is rejected, not passed through to anything).
 *   2. The method's required permission scope must be in `grantedScopes`
 *      — the intersection of what the plugin's manifest declared and what
 *      the installing user actually approved at install time
 *      (pluginService.installPlugin). A plugin cannot expand its own
 *      access by asking nicely at runtime.
 *
 * `network.fetch` is additionally checked against the specific host in the
 * granted `network:<host>` scope — there is no wildcard, so a plugin
 * granted `network:api.example.com` cannot reach any other host, and a
 * plugin with no `network:*` permission at all cannot make outbound
 * requests through this broker no matter what it asks for.
 */
"use strict";

const pool = require("../db/pool");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("plugin-broker");

const METHODS = Object.freeze({
  "jobs.get": { scope: "read:jobs", handler: handleJobsGet },
  "applications.listForJob": { scope: "read:applications", handler: handleApplicationsListForJob },
  "profile.get": { scope: "read:profile", handler: handleProfileGet },
  "notifications.send": { scope: "write:notifications", handler: handleNotificationsSend },
  "network.fetch": { scope: "network", handler: handleNetworkFetch },
});

const MAX_FETCH_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 5000;

class BrokerDeniedError extends Error {
  constructor(message) {
    super(message);
    this.name = "BrokerDeniedError";
  }
}

function hasScope(grantedScopes, scope) {
  return grantedScopes.includes(scope);
}

async function handleJobsGet(params) {
  const { rows } = await pool.query(
    "SELECT id, title, category, budget, status, created_at FROM jobs WHERE id = $1",
    [params?.jobId]
  );
  return rows[0] || null;
}

async function handleApplicationsListForJob(params) {
  const { rows } = await pool.query(
    "SELECT id, freelancer_address, bid_amount, status, created_at FROM applications WHERE job_id = $1 ORDER BY created_at ASC LIMIT 100",
    [params?.jobId]
  );
  return rows;
}

async function handleProfileGet(params) {
  const { rows } = await pool.query(
    "SELECT public_key, display_name, bio, rating, completed_jobs FROM profiles WHERE public_key = $1",
    [params?.publicKey]
  );
  return rows[0] || null;
}

async function handleNotificationsSend(params, context) {
  if (!params?.recipientAddress || !params?.message) {
    throw new Error("notifications.send requires recipientAddress and message");
  }
  const { createNotification } = require("../services/notificationService");
  await createNotification({
    recipientAddress: params.recipientAddress,
    type: "plugin",
    title: `Plugin: ${context.pluginName || context.pluginId}`,
    message: String(params.message).slice(0, 500),
    metadata: { pluginId: context.pluginId },
  });
  return { sent: true };
}

async function handleNetworkFetch(params, context) {
  const url = new URL(String(params?.url || ""));
  const allowedHost = context.grantedScopes
    .filter((s) => s.startsWith("network:"))
    .map((s) => s.slice("network:".length));
  if (!allowedHost.includes(url.hostname)) {
    throw new BrokerDeniedError(
      `network access to "${url.hostname}" is not granted (granted: ${allowedHost.join(", ") || "none"})`
    );
  }
  if (url.protocol !== "https:") {
    throw new BrokerDeniedError("only https:// URLs may be fetched through the broker");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: params.method === "POST" ? "POST" : "GET",
      headers: { accept: "application/json, text/plain" },
      body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_FETCH_BYTES) {
      throw new BrokerDeniedError(`response exceeds ${MAX_FETCH_BYTES} bytes`);
    }
    return { status: response.status, body: text.slice(0, MAX_FETCH_BYTES) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a call handler scoped to one plugin invocation. `grantedScopes` is
 * the authoritative, already-computed intersection of manifest permissions
 * and installer grants — this function does not re-derive it.
 */
function createBroker({ pluginId, pluginName, grantedScopes }) {
  return async function handleCall(method, params) {
    const entry = METHODS[method];
    if (!entry) {
      logger.warn({ pluginId, method }, "Plugin called unrecognized broker method");
      throw new BrokerDeniedError(`unrecognized method "${method}"`);
    }
    if (!hasScope(grantedScopes, entry.scope) && entry.scope !== "network") {
      logger.warn({ pluginId, method, requiredScope: entry.scope }, "Plugin denied: missing scope");
      throw new BrokerDeniedError(`missing required permission "${entry.scope}" for "${method}"`);
    }
    return entry.handler(params, { pluginId, pluginName, grantedScopes });
  };
}

module.exports = { createBroker, BrokerDeniedError, METHODS };
