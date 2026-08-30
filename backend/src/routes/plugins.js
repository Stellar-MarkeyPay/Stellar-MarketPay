/**
 * src/routes/plugins.js
 *
 * Plugin platform API (Issue #322): submission, review, publish/rollback,
 * install/uninstall, and listing. The actual sandboxed execution lives in
 * src/plugins/ and src/services/pluginService.js; this file is thin
 * routing + auth, matching the rest of this codebase's route layer.
 */
"use strict";

const express = require("express");
const router = express.Router();
const { verifyJWT, requireAdminRole, requireAdmin2FA } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const pluginService = require("../services/pluginService");
const { EXTENSION_POINTS, WORKFLOW_EVENTS, PERMISSION_KINDS } = require("../plugins/manifest");

const submitRateLimiter = createRateLimiter(10, 60); // 10 submissions/hour — deters scan-bombing
const generalPluginRateLimiter = createRateLimiter(60, 1);

/**
 * @swagger
 * /api/plugins/meta:
 *   get:
 *     summary: Extension points, workflow events, and permission kinds a plugin manifest may declare
 *     description: >
 *       The plugin platform's closed vocabulary (Issue #322) — a manifest
 *       may only reference these; anything else fails validation at
 *       submission time. Useful for building a manifest editor.
 *     tags: [Plugins]
 *     responses:
 *       200: { description: Metadata }
 */
router.get("/meta", (req, res) => {
  res.json({
    success: true,
    data: {
      extensionPoints: EXTENSION_POINTS,
      workflowEvents: WORKFLOW_EVENTS,
      permissionKinds: PERMISSION_KINDS,
    },
  });
});

/**
 * @swagger
 * /api/plugins:
 *   get:
 *     summary: List published plugins
 *     description: >
 *       Public plugins by default. Pass `visibility=private` (requires
 *       auth) to list the caller's own organisation's private plugins
 *       instead — a private plugin never appears in the public list.
 *     tags: [Plugins]
 *     responses:
 *       200: { description: Plugins }
 */
router.get("/", generalPluginRateLimiter, async (req, res, next) => {
  try {
    if (req.query.visibility === "private") {
      return res.status(401).json({ error: "Authentication required to list private plugins" });
    }
    const plugins = await pluginService.listPlugins({ visibility: "public" });
    res.json({ success: true, data: plugins });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/private:
 *   get:
 *     summary: List the caller's own organisation's private plugins
 *     description: >
 *       Private plugins are visible only to the one organisation
 *       (`plugins.org_address`) they belong to — never in the public
 *       listing (`GET /api/plugins`), and never to a different caller.
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Private plugins }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get("/private", generalPluginRateLimiter, verifyJWT, async (req, res, next) => {
  try {
    const plugins = await pluginService.listPlugins({
      visibility: "private",
      installerAddress: req.user.publicKey,
    });
    res.json({ success: true, data: plugins });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/submit:
 *   post:
 *     summary: Submit a new plugin version for review
 *     description: >
 *       Runs manifest validation and the automated security scan
 *       synchronously; a submission that fails either is recorded as
 *       rejected and never reaches human review (Issue #322). The plugin id
 *       in the manifest is claimed by the first submitter and is thereafter
 *       fixed to that author's wallet.
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [manifest, source]
 *             properties:
 *               manifest: { type: object }
 *               source: { type: string, description: "index.js contents" }
 *               visibility: { type: string, enum: [public, private] }
 *               orgAddress: { type: string }
 *     responses:
 *       201: { description: Version submitted (may be auto-rejected by the scan) }
 *       400: { description: Bad request }
 *       403: { description: Forbidden — plugin id owned by another author }
 */
router.post("/submit", submitRateLimiter, verifyJWT, async (req, res, next) => {
  try {
    const { manifest, source, visibility, orgAddress } = req.body || {};
    if (!manifest || typeof source !== "string") {
      return res.status(400).json({ error: "manifest and source are required" });
    }
    const result = await pluginService.submitPluginVersion({
      authorAddress: req.user.publicKey,
      manifestJson: JSON.stringify(manifest),
      source,
      visibility,
      orgAddress,
    });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/versions/{versionId}/review:
 *   post:
 *     summary: Approve or reject a pending plugin version
 *     description: Admin-only review step (Issue #322's "review process").
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Reviewed }
 */
router.post(
  "/versions/:versionId/review",
  verifyJWT,
  requireAdminRole,
  requireAdmin2FA,
  async (req, res, next) => {
    try {
      const { approve, notes } = req.body || {};
      const result = await pluginService.reviewPluginVersion({
        versionId: req.params.versionId,
        approve: Boolean(approve),
        reviewerAddress: req.user.publicKey,
        notes,
      });
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/plugins/{pluginId}/publish:
 *   post:
 *     summary: Publish (or roll back to) an approved version
 *     description: >
 *       Author-only. Moves the plugin's active-version pointer to any
 *       approved version — publishing a new release and rolling back to an
 *       older one are the same operation (Issue #322).
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Published }
 */
router.post("/:pluginId/publish", verifyJWT, generalPluginRateLimiter, async (req, res, next) => {
  try {
    const { versionId } = req.body || {};
    if (!versionId) return res.status(400).json({ error: "versionId is required" });
    const result = await pluginService.publishVersion({
      pluginId: req.params.pluginId,
      versionId,
      publisherAddress: req.user.publicKey,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/{pluginId}/install:
 *   post:
 *     summary: Install a plugin, granting a subset of its declared permissions
 *     description: >
 *       The installer explicitly grants each permission scope; granting
 *       more than the manifest declares is rejected, granting less is
 *       always allowed (Issue #322's "declares... grants... explicitly").
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201: { description: Installed }
 *       400: { description: Requested a permission the plugin did not declare }
 *       403: { description: "Forbidden — private plugin, different organisation" }
 */
router.post("/:pluginId/install", verifyJWT, generalPluginRateLimiter, async (req, res, next) => {
  try {
    const { permissions, config } = req.body || {};
    const result = await pluginService.installPlugin({
      pluginId: req.params.pluginId,
      installerAddress: req.user.publicKey,
      requestedPermissions: Array.isArray(permissions) ? permissions : [],
      config,
    });
    res.status(201).json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/{pluginId}/install:
 *   delete:
 *     summary: Uninstall a plugin, clearing its granted permissions and config
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Uninstalled }
 */
router.delete("/:pluginId/install", verifyJWT, generalPluginRateLimiter, async (req, res, next) => {
  try {
    const result = await pluginService.uninstallPlugin({
      pluginId: req.params.pluginId,
      installerAddress: req.user.publicKey,
    });
    res.json({ success: true, data: result });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/installed:
 *   get:
 *     summary: List the caller's own installed plugins
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Installed plugins }
 */
router.get("/installed", verifyJWT, generalPluginRateLimiter, async (req, res, next) => {
  try {
    const installs = await pluginService.listInstallationsForInstaller(req.user.publicKey);
    res.json({ success: true, data: installs });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/plugins/installations/{installationId}/invoke:
 *   post:
 *     summary: Manually invoke an installed plugin's hook (developer testing)
 *     description: >
 *       Runs the plugin in the real sandbox against a caller-supplied test
 *       payload and returns the outcome, including containment detail on
 *       failure — this is the local dev/test harness endpoint (Issue #322's
 *       "testing harness so a plugin can be tested without a live
 *       marketplace"), usable against a real install for interactive
 *       debugging as well.
 *     tags: [Plugins]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: "Invocation outcome (success, error, or timeout — all HTTP 200; the outcome is in the body)" }
 *       403: { description: Forbidden — not this installation's owner }
 */
router.post(
  "/installations/:installationId/invoke",
  verifyJWT,
  generalPluginRateLimiter,
  async (req, res, next) => {
    try {
      const pool = require("../db/pool");
      const { rows } = await pool.query(
        "SELECT installer_address FROM plugin_installations WHERE id = $1",
        [req.params.installationId]
      );
      if (!rows.length) return res.status(404).json({ error: "Installation not found" });
      if (rows[0].installer_address !== req.user.publicKey) {
        return res.status(403).json({ error: "Forbidden: not this installation's owner" });
      }
      const { hookName, payload } = req.body || {};
      const result = await pluginService.invokeInstalledPlugin({
        installationId: req.params.installationId,
        hookName: hookName || "manual.test",
        payload: payload || {},
      });
      res.json({ success: true, data: result });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
