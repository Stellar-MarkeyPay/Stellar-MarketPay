/**
 * src/routes/auth.js
 */
"use strict";
const express = require("express");
const { WebAuth, Keypair } = require("@stellar/stellar-sdk");
const { ensureAdminProfile, get2FAStatus } = require("../services/twoFactorService");
const pool = require("../db/pool");
const {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
} = require("../services/authTokens");

const router = express.Router();

let cachedServerKeypair = null;
function getServerKeypair() {
  if (!cachedServerKeypair) {
    const serverPrivateKey = process.env.SERVER_PRIVATE_KEY || Keypair.random().secret();
    cachedServerKeypair = Keypair.fromSecret(serverPrivateKey);
  }
  return cachedServerKeypair;
}

const HOME_DOMAIN = process.env.HOME_DOMAIN || "localhost:4000";
// SEP-10 webAuthDomain: the domain serving this endpoint. Defaults to the
// home domain, which is correct for a single-domain deployment.
const WEB_AUTH_DOMAIN = process.env.WEB_AUTH_DOMAIN || HOME_DOMAIN;
const NETWORK_PASSPHRASE = process.env.STELLAR_NETWORK === "mainnet" 
  ? "Public Global Stellar Network ; September 2015" 
  : "Test SDF Network ; September 2015";

/**
 * @swagger
 * /api/auth:
 *   get:
 *     summary: Get authentication challenge transaction
 *     description: Returns a Stellar challenge transaction for web authentication
 *     tags: [Authentication]
 *     parameters:
 *       - in: query
 *         name: account
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar account address to challenge
 *     responses:
 *       200:
 *         description: Challenge transaction generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: string
 *                   description: Base64-encoded Stellar transaction
 *       400:
 *         description: Bad request - missing account or invalid format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/", (req, res) => {
  try {
    const accountId = req.query.account;
    if (!accountId) {
      return res.status(400).json({ error: "Missing account parameter" });
    }

    const serverKeypair = getServerKeypair();
    const challenge = WebAuth.buildChallengeTx(
      serverKeypair,
      accountId,
      HOME_DOMAIN,
      300, // 5 minutes timeout
      NETWORK_PASSPHRASE,
      WEB_AUTH_DOMAIN
    );

    res.json({ transaction: challenge });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * @swagger
 * /api/auth:
 *   post:
 *     summary: Authenticate with signed challenge transaction
 *     description: Verifies a signed Stellar challenge transaction and issues a JWT token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transaction
 *             properties:
 *               transaction:
 *                 type: string
 *                 description: Base64-encoded signed Stellar transaction
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
 *       400:
 *         description: Bad request - missing transaction or invalid format
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized - invalid signature or expired challenge
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/", async (req, res) => {
  try {
    const { transaction } = req.body;
    if (!transaction) {
      return res.status(400).json({ error: "Missing transaction in request body" });
    }

    const serverKeypair = getServerKeypair();
    // readChallengeTx verifies the server's signature and extracts the client
    // account, but it does NOT verify the client signed anything. Without the
    // verifyChallengeTxSigners call below, any caller could authenticate as
    // any account by replaying an unsigned challenge.
    const { clientAccountID } = WebAuth.readChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    );

    WebAuth.verifyChallengeTxSigners(
      transaction,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      [clientAccountID],
      HOME_DOMAIN,
      WEB_AUTH_DOMAIN
    );

    const accountId = clientAccountID;

    const adminAddresses = (process.env.ADMIN_WALLET_ADDRESSES || "")
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const isAdmin = adminAddresses.includes(accountId);

    const payload = { publicKey: accountId };
    if (isAdmin) {
      await ensureAdminProfile(accountId);
      payload.role = "admin";
      const status = await get2FAStatus(accountId);
      payload["2fa_verified"] = !status.totp_enabled;
    }

    // Stamp last_login_at and ensure profile row exists for authenticated user.
    try {
      await pool.query(
        `INSERT INTO profiles (public_key, last_login_at, created_at, updated_at)
         VALUES ($1, NOW(), NOW(), NOW())
         ON CONFLICT (public_key) DO UPDATE SET last_login_at = NOW()`,
        [accountId]
      );
    } catch (stampErr) {
      // Non-fatal: log and continue issuing the token
      console.warn("[auth] Could not stamp last_login_at:", stampErr.message);
    }

    const { accessToken, refreshToken } = issueTokenPair(payload);
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ success: true, token: accessToken });
  } catch (e) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

router.post("/refresh", (req, res) => {
  const refreshToken = getRefreshTokenFromRequest(req);
  const rotated = rotateRefreshToken(refreshToken);

  if (!rotated) {
    clearAuthCookies(res);
    return res.status(401).json({ error: "Unauthorized: Invalid refresh token" });
  }

  setAuthCookies(res, rotated.accessToken, rotated.refreshToken);
  return res.json({ success: true, token: rotated.accessToken });
});

router.post("/logout", (req, res) => {
  revokeRefreshToken(getRefreshTokenFromRequest(req));
  clearAuthCookies(res);
  res.json({ success: true });
});

module.exports = router;
