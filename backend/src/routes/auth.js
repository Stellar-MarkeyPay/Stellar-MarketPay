/**
 * src/routes/auth.js
 */
"use strict";
const express = require("express");
const { Utils, Keypair } = require("@stellar/stellar-sdk");
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
const NETWORK_PASSPHRASE =
  process.env.STELLAR_NETWORK === "mainnet"
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
    const challenge = Utils.buildChallengeTx(
      serverKeypair,
      accountId,
      HOME_DOMAIN,
      300, // 5 minutes timeout
      NETWORK_PASSPHRASE
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
    const accountId = Utils.verifyChallengeTx(
      transaction,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      "" // webAuthEndpoint is optional or typically HOME_DOMAIN if not specified differently
    );

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

    // Stamp last_login_at so the weekly digest knows this user is active.
    // Uses ON CONFLICT to handle the case where the profile row may not yet
    // exist (it will be created by profileService on first access).
    try {
      await pool.query(`UPDATE profiles SET last_login_at = NOW() WHERE public_key = $1`, [
        accountId,
      ]);
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

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Rotate an access token using the refresh-token cookie
 *     description: >
 *       Reads the httpOnly `refreshToken` cookie, and if it corresponds to a valid, unexpired
 *       refresh session, issues a brand new access/refresh token pair (rotating the refresh
 *       token so the old one can no longer be reused) and sets them as the `jwt` and
 *       `refreshToken` httpOnly cookies. Does not require an `Authorization` header.
 *     tags: [Authentication]
 *     parameters:
 *       - in: cookie
 *         name: refreshToken
 *         required: false
 *         schema:
 *           type: string
 *         description: >
 *           Opaque refresh token previously set by POST /api/auth or a prior call to this
 *           endpoint. Missing, unknown, or expired/already-rotated tokens result in a 401.
 *         example: "3q2-7w15QmN2K8x9pL0vR1sT4uY6zA8bC0dE2fG4hI6j"
 *     responses:
 *       200:
 *         description: >
 *           New access token issued. A new `jwt` cookie and a rotated `refreshToken` cookie are
 *           also set on the response.
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
 *                   description: New JWT access token (same claims as the original session).
 *             example:
 *               success: true
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *       401:
 *         description: Missing, invalid, expired, or already-rotated refresh token. Auth cookies are cleared.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Unauthorized: Invalid refresh token"
 */
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

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Log out and revoke the current refresh session
 *     description: >
 *       Revokes the refresh session identified by the httpOnly `refreshToken` cookie (a no-op
 *       if it is missing or already invalid) and clears both the `jwt` and `refreshToken`
 *       cookies. Always succeeds. Does not require an `Authorization` header.
 *     tags: [Authentication]
 *     parameters:
 *       - in: cookie
 *         name: refreshToken
 *         required: false
 *         schema:
 *           type: string
 *         description: Opaque refresh token to revoke, previously set by POST /api/auth or POST /api/auth/refresh.
 *         example: "3q2-7w15QmN2K8x9pL0vR1sT4uY6zA8bC0dE2fG4hI6j"
 *     responses:
 *       200:
 *         description: Logout succeeded. Auth cookies are cleared on the response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 */
router.post("/logout", (req, res) => {
  revokeRefreshToken(getRefreshTokenFromRequest(req));
  clearAuthCookies(res);
  res.json({ success: true });
});

module.exports = router;
