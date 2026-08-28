"use strict";

/**
 * backend/src/routes/credentials.js
 *
 * HTTP routes for Verifiable Credential management: issue, list, revoke,
 * export, and status checking.
 */

const express = require("express");
const router = express.Router();

/**
 * @param {object} deps
 * @param {import("../services/credentialService")} deps.credentialService
 * @param {import("../services/statusListService")} deps.statusListService
 * @param {function} deps.requireAuth
 * @param {function} deps.requireAdmin
 */
function createCredentialRoutes({ credentialService, statusListService, requireAuth, requireAdmin }) {
  /**
   * POST /api/credentials/issue
   * Issue a new credential. Admin-only.
   */
  router.post("/issue", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { subjectDid, types, claims, expiresAt } = req.body;

      if (!subjectDid || !types || !claims) {
        return res
          .status(400)
          .json({ error: "subjectDid, types, and claims are required" });
      }

      const credential = await credentialService.issue({
        subjectDid,
        types,
        claims,
        expiresAt,
      });

      res.status(201).json({
        success: true,
        data: credential,
      });
    } catch (err) {
      if (err.message.includes("Invalid claims")) {
        return res.status(400).json({ error: err.message });
      }
      if (err.message.includes("No schema found")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/credentials
   * List credentials for the authenticated user.
   */
  router.get("/", requireAuth, async (req, res) => {
    try {
      const holderDid = req.query.did || req.user.did;
      const { type, revoked, limit, offset } = req.query;

      const credentials = await credentialService.listCredentials(holderDid, {
        types: type ? type.split(",") : undefined,
        revoked: revoked !== undefined ? revoked === "true" : undefined,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });

      res.json({
        success: true,
        data: credentials,
        total: credentials.length,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/credentials/:credentialId
   * Get a specific credential.
   */
  router.get("/:credentialId", requireAuth, async (req, res) => {
    try {
      const { credentialId } = req.params;

      const credential = await credentialService.getCredential(credentialId);

      if (!credential) {
        return res.status(404).json({ error: "Credential not found" });
      }

      res.json({
        success: true,
        data: credential,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/credentials/:credentialId/export
   * Export a credential as a signed VC JSON.
   */
  router.get("/:credentialId/export", requireAuth, async (req, res) => {
    try {
      const { credentialId } = req.params;

      const vc = await credentialService.exportCredential(credentialId);

      if (!vc) {
        return res.status(404).json({ error: "Credential not found" });
      }

      res.json({
        success: true,
        data: vc,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/credentials/:credentialId/revoke
   * Revoke a credential. Admin-only.
   */
  router.post("/:credentialId/revoke", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { credentialId } = req.params;
      const { reason } = req.body;

      await credentialService.revoke(credentialId, reason);

      res.json({
        success: true,
        message: "Credential revoked",
      });
    } catch (err) {
      if (err.message.includes("not found")) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/credentials/status/:statusListId
   * Get a status list for verification. Public endpoint.
   */
  router.get("/status/:statusListId", async (req, res) => {
    try {
      const { statusListId } = req.params;

      const statusList = await statusListService.getStatusListCredential(statusListId);

      if (!statusList) {
        return res.status(404).json({ error: "Status list not found" });
      }

      res.json({
        success: true,
        data: statusList,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createCredentialRoutes;
