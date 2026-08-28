"use strict";

/**
 * backend/src/routes/dids.js
 *
 * HTTP routes for DID management under the did:stellarmarket method.
 * All authenticated routes require a valid session/JWT.
 * Resolution is public (no auth required).
 */

const express = require("express");
const router = express.Router();

/**
 * @param {object} deps
 * @param {import("../services/didService")} deps.didService
 * @param {function} deps.requireAuth - Authentication middleware
 */
function createDidRoutes({ didService, requireAuth }) {
  /**
   * POST /api/dids
   * Create a new DID for the authenticated user's Stellar public key.
   */
  router.post("/", requireAuth, async (req, res) => {
    try {
      const { publicKey } = req.body;

      if (!publicKey) {
        return res.status(400).json({ error: "publicKey is required" });
      }

      const result = await didService.create(publicKey);

      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err.message.includes("already exists")) {
        return res.status(409).json({ error: err.message });
      }
      if (err.message.includes("Invalid Stellar public key")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/dids/:did
   * Resolve a DID to its DID Document. Public endpoint.
   */
  router.get("/:did", async (req, res) => {
    try {
      const { did } = req.params;

      if (!did.startsWith("did:stellarmarket:")) {
        return res.status(400).json({ error: "Only did:stellarmarket DIDs are supported" });
      }

      const document = await didService.resolve(did);

      if (!document) {
        return res.status(404).json({ error: "DID not found" });
      }

      res.json({
        success: true,
        data: document,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/dids/:did/rotate
   * Rotate the key for a DID. Requires authentication.
   */
  router.post("/:did/rotate", requireAuth, async (req, res) => {
    try {
      const { did } = req.params;
      const { newPublicKey, reason } = req.body;

      if (!newPublicKey) {
        return res.status(400).json({ error: "newPublicKey is required" });
      }

      // Verify the requester controls this DID
      // (In production, verify the request is signed by the current key)
      const result = await didService.rotateKey(did, newPublicKey, reason);

      res.json({
        success: true,
        data: result,
      });
    } catch (err) {
      if (err.message.includes("not found")) {
        return res.status(404).json({ error: err.message });
      }
      if (err.message.includes("Invalid")) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * POST /api/dids/:did/deactivate
   * Deactivate a DID. Requires authentication.
   */
  router.post("/:did/deactivate", requireAuth, async (req, res) => {
    try {
      const { did } = req.params;

      await didService.deactivate(did);

      res.json({
        success: true,
        message: `DID ${did} deactivated`,
      });
    } catch (err) {
      if (err.message.includes("not found")) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: "Internal server error" });
    }
  });

  /**
   * GET /api/dids/:did/history
   * Get the key rotation history for a DID.
   */
  router.get("/:did/history", requireAuth, async (req, res) => {
    try {
      const { did } = req.params;

      const history = await didService.getKeyHistory(did);

      res.json({
        success: true,
        data: history,
      });
    } catch (err) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}

module.exports = createDidRoutes;
