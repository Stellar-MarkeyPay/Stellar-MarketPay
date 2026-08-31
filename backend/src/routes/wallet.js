"use strict";

/**
 * backend/src/routes/wallet.js
 *
 * HTTP routes for the holder wallet: list credentials, create verifiable
 * presentations, import external credentials, and backup/recovery.
 */

const express = require("express");
const router = express.Router();

/**
 * @param {object} deps
 * @param {import("../services/walletService")} deps.walletService
 * @param {function} deps.requireAuth
 */
function createWalletRoutes({ walletService, requireAuth }) {
  /**
   * GET /api/wallet/credentials
   * List credentials held by the authenticated user.
   */
  router.get("/credentials", requireAuth, async (req, res) => {
    try {
      const holderDid = req.user.did;
      const { type, includeRevoked } = req.query;

      const credentials = await walletService.listCredentials(holderDid, {
        type,
        includeRevoked: includeRevoked === "true",
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
   * POST /api/wallet/presentation
   * Create a verifiable presentation from selected credentials.
   */
  router.post("/presentation", requireAuth, async (req, res) => {
    try {
      const {
        credentialIds,
        selectiveDisclosure,
        purpose,
        nonce,
        domain,
      } = req.body;

      if (!credentialIds || !Array.isArray(credentialIds) || credentialIds.length === 0) {
        return res.status(400).json({ error: "credentialIds array is required" });
      }

      // In production, retrieve the holder's private key from secure storage
      // (e.g., Freighter wallet or HSM). For the API endpoint, the client
      // signs the presentation locally and submits it. This endpoint returns
      // the unsigned template for the client to sign.
      const presentation = await walletService.createPresentation({
        holderDid: req.user.did,
        holderPrivateKey: req.holderPrivateKey, // injected by auth middleware
        holderVerificationMethod: `${req.user.did}#key-1`,
        credentialIds,
        selectiveDisclosure,
        purpose,
        nonce,
        domain,
      });

      res.json({
        success: true,
        data: presentation,
      });
    } catch (err) {
      if (err.message.includes("not found") || err.message.includes("not owned")) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes("revoked")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/wallet/import
   * Import a credential from an external issuer.
   */
  router.post("/import", requireAuth, async (req, res) => {
    try {
      const { credential } = req.body;

      if (!credential) {
        return res.status(400).json({ error: "credential is required" });
      }

      const result = await walletService.importCredential({
        holderDid: req.user.did,
        credential,
      });

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err.message.includes("Invalid")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/wallet/backup
   * Create a backup of all held credentials.
   */
  router.get("/backup", requireAuth, async (req, res) => {
    try {
      const backup = await walletService.createBackup(req.user.did);

      res.json({
        success: true,
        data: backup,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createWalletRoutes;
