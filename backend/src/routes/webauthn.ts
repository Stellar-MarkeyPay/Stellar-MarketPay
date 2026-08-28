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
 * src/routes/webauthn.js
 * WebAuthn / Passkey authentication routes (Issue #218)
 *
 * Registration flow:
 *   POST /api/webauthn/register-options  → get options (requires JWT)
 *   POST /api/webauthn/register-verify   → verify & store credential (requires JWT)
 *
 * Authentication flow:
 *   POST /api/webauthn/login-options     → get options (public)
 *   POST /api/webauthn/login-verify      → verify & issue JWT (public)
 *
 * Credential management:
 *   GET    /api/webauthn/credentials     → list passkeys (requires JWT)
 *   DELETE /api/webauthn/credentials/:id → remove passkey (requires JWT)
 */
("use strict");

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");
const { createSensitiveRateLimiters } = require("../middleware/rateLimiter");
const { createPrincipalBackoff } = require("../middleware/principalBackoff");
const { verifyJWT } = require("../middleware/auth");
const { issueTokenPair, setAuthCookies } = require("../services/authTokens");

const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const RP_ID = process.env.WEBAUTHN_RP_ID || "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME || "Stellar MarketPay";
const ORIGIN = process.env.WEBAUTHN_ORIGIN || "http://localhost:3000";

// Temporary in-memory challenge store (TTL 5 minutes)
const challengeStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of challengeStore) {
    if (v.createdAt < cutoff) challengeStore.delete(k);
  }
}, 60 * 1000).unref();

const [webauthnPublicIpLimiter, webauthnPublicPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "webauthn-public",
  windowMinutes: 5,
  maxRequestsPerIp: 20,
  maxRequestsPerPrincipal: 10,
  principalKeyGenerator: (req: any) => req.body?.publicKey,
});

const [webauthnAccountIpLimiter, webauthnAccountPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "webauthn-account",
  windowMinutes: 5,
  maxRequestsPerIp: 30,
  maxRequestsPerPrincipal: 20,
  principalKeyGenerator: (req: any) => req.user?.publicKey,
});

const webauthnFailureBackoff = createPrincipalBackoff({
  namespace: "webauthn-login",
  principalKeyGenerator: (req: any) => req.body?.publicKey,
  threshold: 5,
  historyWindowMinutes: 15,
  baseDelaySeconds: 5,
  maxDelaySeconds: 300,
  failureStatusCodes: [400, 401, 404],
});

// ─── Registration ──────────────────────────────────────────────────────────────

router.post(
  "/register-options",
  verifyJWT,
  webauthnAccountIpLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const publicKey = req.user.publicKey;

      const { rows: existing } = await rawQuery<WebauthnCredentialTable>(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
        [publicKey]
      );

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: new TextEncoder().encode(publicKey),
        userName: publicKey.slice(0, 8) + "…" + publicKey.slice(-4),
        attestationType: "none",
        excludeCredentials: existing.map((c: any) => ({
          id: c.credential_id,
          type: "public-key",
          transports: c.transports || [],
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });

      challengeStore.set(`reg:${publicKey}`, {
        challenge: options.challenge,
        createdAt: Date.now(),
      });
      res.json({ success: true, data: options });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  "/register-verify",
  verifyJWT,
  webauthnPublicIpLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const publicKey = req.user.publicKey;
      const { credential, name } = req.body;

      const stored = challengeStore.get(`reg:${publicKey}`);
      if (!stored) {
        const e = new Error("No pending registration challenge. Please try again.");
        e.status = 400;
        throw e;
      }

      const verification = await verifyRegistrationResponse({
        response: credential,
        expectedChallenge: stored.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        const e = new Error("Passkey registration verification failed");
        e.status = 400;
        throw e;
      }

      challengeStore.delete(`reg:${publicKey}`);

      const { credential: cred } = verification.registrationInfo;
      await rawQuery<WebauthnCredentialTable>(
        `INSERT INTO webauthn_credentials
         (public_key, credential_id, credential_name, public_key_cose, counter, transports)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING`,
        [
          publicKey,
          Buffer.from(cred.id).toString("base64url"),
          (name || "Passkey").slice(0, 64),
          Buffer.from(cred.publicKey).toString("base64"),
          cred.counter,
          credential.response?.transports || [],
        ]
      );

      res.json({ success: true, message: "Passkey registered successfully" });
    } catch (e) {
      next(e);
    }
  }
);

// ─── Authentication ─────────────────────────────────────────────────────────────

router.post("/login-options", webauthnPublicIpLimiter, async (req: any, res: any, next: any) => {
  try {
    const { publicKey } = req.body;
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }

    const { rows: credentials } = await rawQuery<WebauthnCredentialTable>(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
      [publicKey]
    );

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: credentials.map((c: any) => ({
        id: c.credential_id,
        type: "public-key",
        transports: c.transports || [],
      })),
      userVerification: "preferred",
    });

    challengeStore.set(`auth:${publicKey}`, {
      challenge: options.challenge,
      createdAt: Date.now(),
    });
    res.json({ success: true, data: options });
  } catch (e) {
    next(e);
  }
});

router.post("/login-verify", webauthnPublicIpLimiter, async (req: any, res: any, next: any) => {
  try {
    const { credential, publicKey } = req.body;
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
      const e = new Error("Invalid Stellar public key");
      e.status = 400;
      throw e;
    }

    const stored = challengeStore.get(`auth:${publicKey}`);
    if (!stored) {
      const e = new Error("No pending authentication challenge. Please try again.");
      e.status = 400;
      throw e;
    }

    const credentialId = credential.id;
    const { rows } = await rawQuery<WebauthnCredentialTable>(
      "SELECT * FROM webauthn_credentials WHERE credential_id = $1 AND public_key = $2",
      [credentialId, publicKey]
    );

    if (!rows.length) {
      const e = new Error("Passkey not found for this account");
      e.status = 404;
      throw e;
    }

    const storedCred = rows[0];
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: stored.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: storedCred.credential_id,
        publicKey: Buffer.from(storedCred.public_key_cose, "base64"),
        counter: Number(storedCred.counter),
        transports: storedCred.transports,
      },
    });

    if (!verification.verified) {
      const e = new Error("Passkey authentication failed");
      e.status = 401;
      throw e;
    }

    challengeStore.delete(`auth:${publicKey}`);

    await rawQuery<WebauthnCredentialTable>(
      "UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2",
      [verification.authenticationInfo.newCounter, credentialId]
    );

    const { accessToken, refreshToken } = issueTokenPair({ publicKey });
    setAuthCookies(res, accessToken, refreshToken);

    res.json({ success: true, token: accessToken });
  } catch (e) {
    next(e);
  }
});

// ─── Credential management ─────────────────────────────────────────────────────

router.get("/credentials", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const { rows } = await rawQuery<WebauthnCredentialTable>(
      "SELECT id, credential_name, created_at FROM webauthn_credentials WHERE public_key = $1 ORDER BY created_at DESC",
      [req.user.publicKey]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

router.delete("/credentials/:id", verifyJWT, async (req: any, res: any, next: any) => {
  try {
    const { rowCount } = await rawQuery<WebauthnCredentialTable>(
      "DELETE FROM webauthn_credentials WHERE id = $1 AND public_key = $2",
      [req.params.id, req.user.publicKey]
    );
    if (!rowCount) {
      const e = new Error("Passkey not found");
      e.status = 404;
      throw e;
    }
    res.json({ success: true, message: "Passkey removed" });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/webauthn/credentials/{id}:
 *   delete:
 *     summary: Remove a registered passkey
 *     description: Deletes a WebAuthn credential belonging to the authenticated user.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: The credential's internal `id` (from GET /api/webauthn/credentials), not its WebAuthn credential_id
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Passkey removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: Passkey removed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: No passkey with that ID belongs to the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Passkey not found
 */
router.delete(
  "/credentials/:id",
  webauthnAccountIpLimiter,
  verifyJWT,
  webauthnAccountPrincipalLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM webauthn_credentials WHERE id = $1 AND public_key = $2",
        [req.params.id, req.user.publicKey]
      );
      if (!rowCount) {
        const e = new Error("Passkey not found");
        e.status = 404;
        throw e;
      }
      res.json({ success: true, message: "Passkey removed" });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
