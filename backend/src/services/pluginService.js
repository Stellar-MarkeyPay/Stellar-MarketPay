/**
 * src/services/pluginService.js
 *
 * Plugin registry and invocation orchestration (Issue #322): submission,
 * automated security scanning, review/publication, install/uninstall, and
 * running an installed plugin's sandboxed hook against a real platform
 * event. Wires src/plugins/{manifest,securityScan,sandbox,broker}.js to
 * Postgres.
 */
"use strict";

const pool = require("../db/pool");
const { validateManifest, assertManifestSize } = require("../plugins/manifest");
const { scanSource, MAX_SOURCE_BYTES } = require("../plugins/securityScan");
const { runPlugin, PluginError } = require("../plugins/sandbox");
const { createBroker } = require("../plugins/broker");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("plugin-service");

/**
 * Submit a new plugin version. Runs manifest validation and the automated
 * security scan synchronously — a submission that fails either never
 * reaches a human reviewer, let alone the sandbox (Issue #322: "implement a
 * review process including automated security scanning of submitted
 * code").
 */
async function submitPluginVersion({
  authorAddress,
  manifestJson,
  source,
  visibility,
  orgAddress,
}) {
  assertManifestSize(manifestJson);
  let manifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (err) {
    const e = new Error(`manifest is not valid JSON: ${err.message}`);
    e.status = 400;
    throw e;
  }

  const { valid, errors } = validateManifest(manifest);
  if (!valid) {
    const e = new Error(`manifest validation failed: ${errors.join("; ")}`);
    e.status = 400;
    e.details = errors;
    throw e;
  }

  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    const e = new Error(`source exceeds ${MAX_SOURCE_BYTES} bytes`);
    e.status = 400;
    throw e;
  }

  const scan = scanSource(source);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO plugins (id, name, description, author_address, visibility, org_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         updated_at = NOW()
       -- Ownership never transfers via re-submission: reject if the
       -- existing plugin belongs to a different author.
       WHERE plugins.author_address = EXCLUDED.author_address`,
      [
        manifest.id,
        manifest.name,
        manifest.description || null,
        authorAddress,
        visibility || "public",
        orgAddress || null,
      ]
    );

    const { rows: ownerCheck } = await client.query(
      "SELECT author_address FROM plugins WHERE id = $1",
      [manifest.id]
    );
    if (!ownerCheck.length || ownerCheck[0].author_address !== authorAddress) {
      const e = new Error("Forbidden: this plugin id belongs to a different author");
      e.status = 403;
      throw e;
    }

    const { rows } = await client.query(
      `INSERT INTO plugin_versions (plugin_id, version, manifest, source, scan_passed, scan_findings, review_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, version, scan_passed, scan_findings, review_status, created_at`,
      [
        manifest.id,
        manifest.version,
        JSON.stringify(manifest),
        source,
        scan.passed,
        JSON.stringify(scan.findings),
        // A submission that fails the automated scan never reaches human
        // review at all — it is auto-rejected, not merely flagged.
        scan.passed ? "pending" : "rejected",
      ]
    );

    await client.query("COMMIT");
    logger.info(
      { pluginId: manifest.id, version: manifest.version, scanPassed: scan.passed },
      "Plugin version submitted"
    );
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Admin/reviewer action: approve or reject a pending version. */
async function reviewPluginVersion({ versionId, approve, reviewerAddress, notes }) {
  const { rows } = await pool.query(
    `UPDATE plugin_versions
     SET review_status = $2, reviewed_by = $3, reviewed_at = NOW(), review_notes = $4
     WHERE id = $1 AND review_status = 'pending'
     RETURNING id, plugin_id, version, review_status`,
    [versionId, approve ? "approved" : "rejected", reviewerAddress, notes || null]
  );
  if (!rows.length) {
    const e = new Error("Version not found or not pending review");
    e.status = 404;
    throw e;
  }
  return rows[0];
}

/**
 * Publish an approved version — moves the plugin's `active_version_id`
 * pointer. The same function serves both "publish the newest version" and
 * "roll back to an older one" (Issue #322): both are just pointing at an
 * already-approved plugin_versions row, and neither touches version rows.
 */
async function publishVersion({ pluginId, versionId, publisherAddress }) {
  const { rows: pluginRows } = await pool.query(
    "SELECT author_address FROM plugins WHERE id = $1",
    [pluginId]
  );
  if (!pluginRows.length) {
    const e = new Error("Plugin not found");
    e.status = 404;
    throw e;
  }
  if (pluginRows[0].author_address !== publisherAddress) {
    const e = new Error("Forbidden: not this plugin's author");
    e.status = 403;
    throw e;
  }

  const { rows: versionRows } = await pool.query(
    "SELECT id FROM plugin_versions WHERE id = $1 AND plugin_id = $2 AND review_status = 'approved'",
    [versionId, pluginId]
  );
  if (!versionRows.length) {
    const e = new Error("Version not found, not approved, or belongs to a different plugin");
    e.status = 400;
    throw e;
  }

  await pool.query(
    `UPDATE plugins SET active_version_id = $2, status = 'published', updated_at = NOW() WHERE id = $1`,
    [pluginId, versionId]
  );
  await pool.query(
    "UPDATE plugin_versions SET published_at = NOW() WHERE id = $1 AND published_at IS NULL",
    [versionId]
  );

  logger.info({ pluginId, versionId, publisherAddress }, "Plugin version published");
  return { pluginId, activeVersionId: versionId };
}

async function listPlugins({ visibility = "public", installerAddress } = {}) {
  if (visibility === "public") {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.description, p.author_address, p.status, p.active_version_id,
              v.version, v.manifest
       FROM plugins p
       LEFT JOIN plugin_versions v ON v.id = p.active_version_id
       WHERE p.visibility = 'public' AND p.status = 'published'
       ORDER BY p.created_at DESC`
    );
    return rows;
  }
  // Private plugins are visible only to the org they belong to.
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.author_address, p.status, p.active_version_id,
            v.version, v.manifest
     FROM plugins p
     LEFT JOIN plugin_versions v ON v.id = p.active_version_id
     WHERE p.visibility = 'private' AND p.org_address = $1 AND p.status = 'published'
     ORDER BY p.created_at DESC`,
    [installerAddress]
  );
  return rows;
}

/**
 * Install a plugin for one user. `requestedPermissions` must be a subset of
 * what the published version's manifest declares — the installer can grant
 * *less* than the manifest asks for (the plugin then simply gets denied by
 * the broker on anything beyond that at runtime — see broker.js) but never
 * more. This is the explicit-grant half of "a plugin declares what it
 * needs and the installing user grants it explicitly."
 */
async function installPlugin({ pluginId, installerAddress, requestedPermissions, config }) {
  const { rows: pluginRows } = await pool.query(
    `SELECT p.id, p.visibility, p.org_address, p.active_version_id, v.manifest
     FROM plugins p LEFT JOIN plugin_versions v ON v.id = p.active_version_id
     WHERE p.id = $1 AND p.status = 'published'`,
    [pluginId]
  );
  if (!pluginRows.length || !pluginRows[0].active_version_id) {
    const e = new Error("Plugin not found or has no published version");
    e.status = 404;
    throw e;
  }
  const plugin = pluginRows[0];
  if (plugin.visibility === "private" && plugin.org_address !== installerAddress) {
    const e = new Error("Forbidden: this plugin is private to another organisation");
    e.status = 403;
    throw e;
  }

  const manifestPermissions = plugin.manifest.permissions || [];
  const granted = (requestedPermissions || []).filter((p) => manifestPermissions.includes(p));
  const rejectedExtras = (requestedPermissions || []).filter(
    (p) => !manifestPermissions.includes(p)
  );
  if (rejectedExtras.length) {
    const e = new Error(
      `cannot grant permissions the plugin did not declare: ${rejectedExtras.join(", ")}`
    );
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `INSERT INTO plugin_installations (plugin_id, plugin_version_id, installer_address, granted_permissions, config)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (plugin_id, installer_address) DO UPDATE SET
       plugin_version_id = EXCLUDED.plugin_version_id,
       granted_permissions = EXCLUDED.granted_permissions,
       config = EXCLUDED.config,
       enabled = TRUE,
       uninstalled_at = NULL,
       installed_at = NOW()
     RETURNING id, plugin_id, granted_permissions, installed_at`,
    [
      pluginId,
      plugin.active_version_id,
      installerAddress,
      JSON.stringify(granted),
      JSON.stringify(config || {}),
    ]
  );
  logger.info({ pluginId, installerAddress, granted }, "Plugin installed");
  return rows[0];
}

/** Uninstall cleanly: disables the row and clears any plugin-specific
 *  config (Issue #322: "including data removal"). The installation row
 *  itself is kept, soft-deleted, so invocation history stays attributable —
 *  a fresh install is a new grant, not a resurrection of the old one. */
async function uninstallPlugin({ pluginId, installerAddress }) {
  const { rows } = await pool.query(
    `UPDATE plugin_installations
     SET enabled = FALSE, uninstalled_at = NOW(), config = '{}'::jsonb, granted_permissions = '[]'::jsonb
     WHERE plugin_id = $1 AND installer_address = $2 AND uninstalled_at IS NULL
     RETURNING id`,
    [pluginId, installerAddress]
  );
  if (!rows.length) {
    const e = new Error("Installation not found");
    e.status = 404;
    throw e;
  }
  logger.info({ pluginId, installerAddress }, "Plugin uninstalled");
  return { uninstalled: true };
}

async function listInstallationsForInstaller(installerAddress) {
  const { rows } = await pool.query(
    `SELECT i.id, i.plugin_id, i.granted_permissions, i.config, i.installed_at,
            p.name, v.version
     FROM plugin_installations i
     JOIN plugins p ON p.id = i.plugin_id
     JOIN plugin_versions v ON v.id = i.plugin_version_id
     WHERE i.installer_address = $1 AND i.enabled = TRUE AND i.uninstalled_at IS NULL
     ORDER BY i.installed_at DESC`,
    [installerAddress]
  );
  return rows;
}

/**
 * Invoke one installed plugin's hook against a real event, end to end:
 * loads the installation + its exact pinned version's source, runs it in
 * the sandbox with a permission-checked broker, and logs the outcome
 * either way. Never throws past a contained, logged failure — the caller
 * (e.g. the workflow-event dispatcher) gets a result object, not an
 * exception that could take down whatever triggered the hook.
 */
async function invokeInstalledPlugin({ installationId, hookName, payload }) {
  const { rows } = await pool.query(
    `SELECT i.id, i.plugin_id, i.granted_permissions, i.installer_address,
            v.source, v.manifest, p.name
     FROM plugin_installations i
     JOIN plugin_versions v ON v.id = i.plugin_version_id
     JOIN plugins p ON p.id = i.plugin_id
     WHERE i.id = $1 AND i.enabled = TRUE AND i.uninstalled_at IS NULL`,
    [installationId]
  );
  if (!rows.length) {
    return {
      status: "error",
      errorCode: "NOT_INSTALLED",
      errorMessage: "installation not found or disabled",
    };
  }
  const installation = rows[0];
  const broker = createBroker({
    pluginId: installation.plugin_id,
    pluginName: installation.name,
    grantedScopes: installation.granted_permissions,
  });

  const startedAt = Date.now();
  let outcome;
  try {
    const value = await runPlugin({
      source: installation.source,
      hookName,
      payload,
      pluginId: installation.plugin_id,
      onBrokerCall: (method, params) => broker(method, params),
    });
    outcome = { status: "success", value };
  } catch (err) {
    const isPluginError = err instanceof PluginError;
    outcome = {
      status: err?.code === "TIMEOUT" ? "timeout" : "error",
      errorCode: isPluginError ? err.code : "UNKNOWN",
      errorMessage: err?.message || String(err),
    };
    logger.warn(
      { pluginId: installation.plugin_id, installationId, hookName, error: outcome.errorMessage },
      "Plugin invocation failed (contained)"
    );
  }
  const durationMs = Date.now() - startedAt;

  await pool.query(
    `INSERT INTO plugin_invocation_logs (installation_id, hook_name, status, duration_ms, error_code, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      installationId,
      hookName,
      outcome.status,
      durationMs,
      outcome.errorCode || null,
      outcome.errorMessage || null,
    ]
  );

  return { ...outcome, durationMs };
}

/**
 * Dispatch a platform workflow event to every enabled installation whose
 * plugin subscribes to it. Called from route handlers at the moment an
 * event happens (e.g. after a job is created) — see routes/plugins.js's
 * dispatch helper and docs/ADR-011-plugin-platform.md for which events are
 * wired in this PR versus left for a follow-up.
 */
async function dispatchWorkflowEvent(eventName, payload) {
  const { rows } = await pool.query(
    `SELECT i.id
     FROM plugin_installations i
     JOIN plugin_versions v ON v.id = i.plugin_version_id
     WHERE i.enabled = TRUE AND i.uninstalled_at IS NULL
       AND v.manifest->'extensionPoints' ? 'workflow_hook'
       AND v.manifest->'workflowEvents' ? $1`,
    [eventName]
  );
  const results = [];
  for (const row of rows) {
    results.push(
      await invokeInstalledPlugin({ installationId: row.id, hookName: eventName, payload })
    );
  }
  return results;
}

module.exports = {
  submitPluginVersion,
  reviewPluginVersion,
  publishVersion,
  listPlugins,
  installPlugin,
  uninstallPlugin,
  listInstallationsForInstaller,
  invokeInstalledPlugin,
  dispatchWorkflowEvent,
};
