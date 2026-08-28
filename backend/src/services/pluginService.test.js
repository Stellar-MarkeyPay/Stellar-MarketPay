"use strict";

/**
 * src/services/pluginService.test.js
 *
 * Hermetic against Postgres (in-memory fake pool, following this repo's
 * pgMock.js convention), but exercises the *real* sandbox — submission,
 * scanning, review, install, and invocation run actual worker/child
 * processes end to end. This is intentionally slower than a typical unit
 * suite for the same reason sandbox.test.js is: mocking the sandbox away
 * would test nothing about whether an installed plugin is actually
 * contained.
 */

jest.setTimeout(20000);

function createFakePool() {
  const plugins = new Map();
  const versions = new Map();
  const installations = new Map();
  const logs = [];
  let versionSeq = 0;
  let installSeq = 0;

  function runQuery(sql, params) {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") return { rows: [] };

    if (text.startsWith("INSERT INTO plugins")) {
      const [id, name, description, authorAddress, visibility, orgAddress] = params;
      const existing = plugins.get(id);
      if (!existing) {
        plugins.set(id, {
          id,
          name,
          description,
          author_address: authorAddress,
          visibility,
          org_address: orgAddress,
          status: "draft",
          active_version_id: null,
        });
      } else if (existing.author_address === authorAddress) {
        existing.name = name;
        existing.description = description;
      }
      return { rows: [] };
    }

    if (text.startsWith("SELECT author_address FROM plugins WHERE id = $1")) {
      const p = plugins.get(params[0]);
      return { rows: p ? [{ author_address: p.author_address }] : [] };
    }

    if (text.startsWith("INSERT INTO plugin_versions")) {
      const [pluginId, version, manifestJson, source, scanPassed, findingsJson, reviewStatus] =
        params;
      const id = `version-${versionSeq++}`;
      const row = {
        id,
        plugin_id: pluginId,
        version,
        manifest: JSON.parse(manifestJson),
        source,
        scan_passed: scanPassed,
        scan_findings: JSON.parse(findingsJson),
        review_status: reviewStatus,
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        published_at: null,
        created_at: new Date().toISOString(),
      };
      versions.set(id, row);
      return {
        rows: [
          {
            id,
            version,
            scan_passed: scanPassed,
            scan_findings: row.scan_findings,
            review_status: reviewStatus,
            created_at: row.created_at,
          },
        ],
      };
    }

    if (text.startsWith("UPDATE plugin_versions") && text.includes("review_status = $2")) {
      const [id, reviewStatus, reviewerAddress, notes] = params;
      const row = versions.get(id);
      if (!row || row.review_status !== "pending") return { rows: [] };
      row.review_status = reviewStatus;
      row.reviewed_by = reviewerAddress;
      row.review_notes = notes;
      return {
        rows: [
          {
            id: row.id,
            plugin_id: row.plugin_id,
            version: row.version,
            review_status: row.review_status,
          },
        ],
      };
    }

    if (
      text.startsWith(
        "SELECT id FROM plugin_versions WHERE id = $1 AND plugin_id = $2 AND review_status = 'approved'"
      )
    ) {
      const row = versions.get(params[0]);
      return {
        rows:
          row && row.plugin_id === params[1] && row.review_status === "approved"
            ? [{ id: row.id }]
            : [],
      };
    }

    if (text.startsWith("UPDATE plugins SET active_version_id")) {
      const [pluginId, versionId] = params;
      const p = plugins.get(pluginId);
      p.active_version_id = versionId;
      p.status = "published";
      return { rows: [] };
    }

    if (text.startsWith("UPDATE plugin_versions SET published_at")) {
      const row = versions.get(params[0]);
      if (row && !row.published_at) row.published_at = new Date().toISOString();
      return { rows: [] };
    }

    if (
      text.includes("FROM plugins p LEFT JOIN plugin_versions v ON v.id = p.active_version_id") &&
      text.includes("WHERE p.id = $1 AND p.status = 'published'")
    ) {
      const p = plugins.get(params[0]);
      if (!p || p.status !== "published") return { rows: [] };
      const v = versions.get(p.active_version_id);
      return {
        rows: [
          {
            id: p.id,
            visibility: p.visibility,
            org_address: p.org_address,
            active_version_id: p.active_version_id,
            manifest: v.manifest,
          },
        ],
      };
    }

    if (text.startsWith("INSERT INTO plugin_installations")) {
      const [pluginId, versionId, installerAddress, grantedJson, configJson] = params;
      const key = `${pluginId}::${installerAddress}`;
      const id = installations.has(key) ? installations.get(key).id : `install-${installSeq++}`;
      const row = {
        id,
        plugin_id: pluginId,
        plugin_version_id: versionId,
        installer_address: installerAddress,
        granted_permissions: JSON.parse(grantedJson),
        config: JSON.parse(configJson),
        enabled: true,
        installed_at: new Date().toISOString(),
        uninstalled_at: null,
      };
      installations.set(key, row);
      return {
        rows: [
          {
            id: row.id,
            plugin_id: row.plugin_id,
            granted_permissions: row.granted_permissions,
            installed_at: row.installed_at,
          },
        ],
      };
    }

    if (text.startsWith("UPDATE plugin_installations") && text.includes("SET enabled = FALSE")) {
      const [pluginId, installerAddress] = params;
      const key = `${pluginId}::${installerAddress}`;
      const row = installations.get(key);
      if (!row || row.uninstalled_at) return { rows: [] };
      row.enabled = false;
      row.uninstalled_at = new Date().toISOString();
      row.config = {};
      row.granted_permissions = [];
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith("SELECT i.id, i.plugin_id, i.granted_permissions, i.installer_address")) {
      const row = [...installations.values()].find(
        (r) => r.id === params[0] && r.enabled && !r.uninstalled_at
      );
      if (!row) return { rows: [] };
      const v = versions.get(row.plugin_version_id);
      const p = plugins.get(row.plugin_id);
      return {
        rows: [
          {
            id: row.id,
            plugin_id: row.plugin_id,
            granted_permissions: row.granted_permissions,
            installer_address: row.installer_address,
            source: v.source,
            manifest: v.manifest,
            name: p.name,
          },
        ],
      };
    }

    if (text.startsWith("INSERT INTO plugin_invocation_logs")) {
      logs.push(params);
      return { rows: [] };
    }

    if (text.startsWith("SELECT id, plugin_id, granted_permissions, config, installed_at")) {
      const rows = [...installations.values()]
        .filter((r) => r.installer_address === params[0] && r.enabled && !r.uninstalled_at)
        .map((r) => ({
          ...r,
          name: plugins.get(r.plugin_id).name,
          version: versions.get(r.plugin_version_id).version,
        }));
      return { rows };
    }

    throw new Error(`fakePool: unhandled query: ${text}`);
  }

  return {
    plugins,
    versions,
    installations,
    logs,
    async connect() {
      return { query: async (sql, params) => runQuery(sql, params), release() {} };
    },
    async query(sql, params) {
      return runQuery(sql, params);
    },
  };
}

jest.mock("../db/pool", () => {
  let current = null;
  return {
    __setFake(p) {
      current = p;
    },
    connect: (...args) => current.connect(...args),
    query: (...args) => current.query(...args),
  };
});

const pool = require("../db/pool");
const pluginService = require("./pluginService");

const AUTHOR = "GAUTHOR1234567890";
const INSTALLER = "GINSTALLER1234567890";
const REVIEWER = "GADMINREVIEWER1234567890";

function cleanManifest(overrides = {}) {
  return {
    id: "hello-plugin",
    name: "Hello Plugin",
    version: "1.0.0",
    apiVersion: "1.0",
    extensionPoints: ["workflow_hook"],
    workflowEvents: ["job.created"],
    permissions: ["read:jobs"],
    entry: "index.js",
    ...overrides,
  };
}

const CLEAN_SOURCE = `
  globalThis.plugin = {
    async onEvent(payload) {
      const job = await marketpay.call("jobs.get", { jobId: payload.jobId });
      return { sawJob: job ? job.id : null };
    }
  };
`;

describe("pluginService — full lifecycle", () => {
  let fake;

  beforeEach(() => {
    fake = createFakePool();
    pool.__setFake(fake);
  });

  test("submit -> review -> publish -> install -> invoke (real sandbox) -> uninstall", async () => {
    const submitted = await pluginService.submitPluginVersion({
      authorAddress: AUTHOR,
      manifestJson: JSON.stringify(cleanManifest()),
      source: CLEAN_SOURCE,
    });
    expect(submitted.scan_passed).toBe(true);
    expect(submitted.review_status).toBe("pending");

    const reviewed = await pluginService.reviewPluginVersion({
      versionId: submitted.id,
      approve: true,
      reviewerAddress: REVIEWER,
    });
    expect(reviewed.review_status).toBe("approved");

    const published = await pluginService.publishVersion({
      pluginId: "hello-plugin",
      versionId: submitted.id,
      publisherAddress: AUTHOR,
    });
    expect(published.activeVersionId).toBe(submitted.id);

    const installed = await pluginService.installPlugin({
      pluginId: "hello-plugin",
      installerAddress: INSTALLER,
      requestedPermissions: ["read:jobs"],
    });
    expect(installed.granted_permissions).toEqual(["read:jobs"]);

    // Real sandboxed invocation, mediated through the real broker, which
    // hits the pool for jobs.get (broker.js's own query, not covered by
    // runQuery above) — swap in a fake whose query() also serves that,
    // carrying over the state already built up by submit/review/publish/install.
    const jobsAwareFake = createFakePool();
    for (const [k, v] of fake.plugins) jobsAwareFake.plugins.set(k, v);
    for (const [k, v] of fake.versions) jobsAwareFake.versions.set(k, v);
    for (const [k, v] of fake.installations) jobsAwareFake.installations.set(k, v);
    const originalQuery = jobsAwareFake.query.bind(jobsAwareFake);
    jobsAwareFake.query = async (sql, params) => {
      if (sql.includes("FROM jobs WHERE id = $1")) {
        return { rows: [{ id: params[0], title: "A real job" }] };
      }
      return originalQuery(sql, params);
    };
    pool.__setFake(jobsAwareFake);

    const invocation = await pluginService.invokeInstalledPlugin({
      installationId: installed.id,
      hookName: "job.created",
      payload: { jobId: "job-xyz" },
    });
    expect(invocation.status).toBe("success");
    expect(invocation.value).toEqual({ sawJob: "job-xyz" });

    const uninstalled = await pluginService.uninstallPlugin({
      pluginId: "hello-plugin",
      installerAddress: INSTALLER,
    });
    expect(uninstalled.uninstalled).toBe(true);
  });

  test("NEGATIVE: a submission that fails the security scan is auto-rejected, never reaches review", async () => {
    const malicious = `
      globalThis.plugin = {
        async onEvent() {
          const fs = require("fs");
          return fs.readFileSync("/etc/passwd", "utf8");
        }
      };
    `;
    const submitted = await pluginService.submitPluginVersion({
      authorAddress: AUTHOR,
      manifestJson: JSON.stringify(cleanManifest({ id: "evil-plugin" })),
      source: malicious,
    });
    expect(submitted.scan_passed).toBe(false);
    expect(submitted.review_status).toBe("rejected");

    await expect(
      pluginService.reviewPluginVersion({
        versionId: submitted.id,
        approve: true,
        reviewerAddress: REVIEWER,
      })
    ).rejects.toThrow(/not found or not pending/);
  });

  test("NEGATIVE: rejects a manifest that fails validation before any scan runs", async () => {
    await expect(
      pluginService.submitPluginVersion({
        authorAddress: AUTHOR,
        manifestJson: JSON.stringify(cleanManifest({ permissions: ["read:everything"] })),
        source: CLEAN_SOURCE,
      })
    ).rejects.toThrow(/manifest validation failed/);
  });

  test("NEGATIVE: installing cannot grant a permission the manifest did not declare", async () => {
    const submitted = await pluginService.submitPluginVersion({
      authorAddress: AUTHOR,
      manifestJson: JSON.stringify(
        cleanManifest({ id: "scoped-plugin", permissions: ["read:jobs"] })
      ),
      source: CLEAN_SOURCE,
    });
    await pluginService.reviewPluginVersion({
      versionId: submitted.id,
      approve: true,
      reviewerAddress: REVIEWER,
    });
    await pluginService.publishVersion({
      pluginId: "scoped-plugin",
      versionId: submitted.id,
      publisherAddress: AUTHOR,
    });

    await expect(
      pluginService.installPlugin({
        pluginId: "scoped-plugin",
        installerAddress: INSTALLER,
        requestedPermissions: ["read:jobs", "write:notifications"],
      })
    ).rejects.toThrow(/did not declare/);
  });

  test("a plugin that throws is contained and reported as a failed invocation, not an exception", async () => {
    const throwingSource = `globalThis.plugin = { async onEvent() { throw new Error("deliberate"); } };`;
    const submitted = await pluginService.submitPluginVersion({
      authorAddress: AUTHOR,
      manifestJson: JSON.stringify(cleanManifest({ id: "throwing-plugin", permissions: [] })),
      source: throwingSource,
    });
    await pluginService.reviewPluginVersion({
      versionId: submitted.id,
      approve: true,
      reviewerAddress: REVIEWER,
    });
    await pluginService.publishVersion({
      pluginId: "throwing-plugin",
      versionId: submitted.id,
      publisherAddress: AUTHOR,
    });
    const installed = await pluginService.installPlugin({
      pluginId: "throwing-plugin",
      installerAddress: INSTALLER,
      requestedPermissions: [],
    });

    const invocation = await pluginService.invokeInstalledPlugin({
      installationId: installed.id,
      hookName: "job.created",
      payload: {},
    });
    expect(invocation.status).toBe("error");
    expect(invocation.errorCode).toBe("PLUGIN_THREW");
  });
});
