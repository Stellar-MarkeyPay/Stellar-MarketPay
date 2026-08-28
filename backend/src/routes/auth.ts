import type {
  Database,
  ProfileTable,
  JobTable,
  ApplicationTable,
  JobViewTable,
  PrivateMessageTable,
  EscrowTable,
  ProgressUpdateTable,
  RatingTable,
  MessageTable,
  ReferralTable,
  ReferralPayoutTable,
  ScopeSessionTable,
  WebauthnCredentialTable,
  DisputeEvidenceTable,
  TimeEntryTable,
  TimeInvoiceTable,
  JobInvitationTable,
} from "../db/types";
import { db, rawQuery } from "../db/kysely";
/**
 * src/routes/auth.js
 */
("use strict");
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
const { createSensitiveRateLimiters } = require("../middleware/rateLimiter");
const { createPrincipalBackoff } = require("../middleware/principalBackoff");

const router = express.Router();

let cachedServerKeypair: any = null;
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

function getAuthPrincipal(req: any) {
  const queryAccount = req.query?.account;
  if (queryAccount) return queryAccount;

  const challengeTx = req.body?.transaction;
  if (!challengeTx) return null;

  try {
    const details = Utils.readChallengeTx(
      challengeTx,
      getServerKeypair().publicKey(),
      NETWORK_PASSPHRASE,
      HOME_DOMAIN,
      ""
    );
    return details.clientAccountID || details.clientAccountId || null;
  } catch {
    return null;
  }
}

const [authIpLimiter, authPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "auth",
  windowMinutes: 5,
  maxRequestsPerIp: 20,
  maxRequestsPerPrincipal: 8,
  principalKeyGenerator: getAuthPrincipal,
});

const authFailureBackoff = createPrincipalBackoff({
  namespace: "auth-login",
  principalKeyGenerator: getAuthPrincipal,
  threshold: 5,
  historyWindowMinutes: 15,
  baseDelaySeconds: 5,
  maxDelaySeconds: 300,
  failureStatusCodes: [400, 401],
});

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
router.get("/", (req: any, res: any) => {
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
  } catch (e: any) {
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
router.post("/", async (req: any, res: any) => {
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

    const payload: any = { publicKey: accountId };
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
      await rawQuery<ProfileTable>(
        `UPDATE profiles SET last_login_at = NOW() WHERE public_key = $1`,
        [accountId]
      );
    } catch (stampErr: any) {
      // Non-fatal: log and continue issuing the token
      console.warn("[auth] Could not stamp last_login_at:", stampErr.message);
    }

    const { accessToken, refreshToken } = issueTokenPair(payload);
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ success: true, token: accessToken });
  } catch (e: any) {
    res.status(401).json({ error: "Unauthorized: " + e.message });
  }
});

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh access token using refresh token cookie
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post("/refresh", (req: any, res: any) => {
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
 *     summary: Logout and invalidate refresh token
 *     tags: [Auth]
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 */
router.post("/logout", (req: any, res: any) => {
  revokeRefreshToken(getRefreshTokenFromRequest(req));
  clearAuthCookies(res);
  res.json({ success: true });
});

module.exports = router;
