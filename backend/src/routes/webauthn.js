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
"use strict";

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
  principalKeyGenerator: (req) => req.body?.publicKey,
});

const [webauthnAccountIpLimiter, webauthnAccountPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "webauthn-account",
  windowMinutes: 5,
  maxRequestsPerIp: 30,
  maxRequestsPerPrincipal: 20,
  principalKeyGenerator: (req) => req.user?.publicKey,
});

const webauthnFailureBackoff = createPrincipalBackoff({
  namespace: "webauthn-login",
  principalKeyGenerator: (req) => req.body?.publicKey,
  threshold: 5,
  historyWindowMinutes: 15,
  baseDelaySeconds: 5,
  maxDelaySeconds: 300,
  failureStatusCodes: [400, 401, 404],
});

// ─── Registration ──────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/webauthn/register-options:
 *   post:
 *     summary: Get WebAuthn passkey registration options
 *     description: >
 *       Generates a WebAuthn/FIDO2 `PublicKeyCredentialCreationOptions`
 *       challenge (via `@simplewebauthn/server`) for registering a new
 *       passkey on the authenticated user's account, excluding any
 *       credentials already registered for that account. The challenge is
 *       cached in memory (keyed by public key, 5-minute TTL) to be verified
 *       by `POST /api/webauthn/register-verify`. Pass the returned `data`
 *       object directly to `navigator.credentials.create({ publicKey: data })`.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Registration options generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: PublicKeyCredentialCreationOptionsJSON
 *                   properties:
 *                     rp:
 *                       type: object
 *                       properties:
 *                         name:
 *                           type: string
 *                         id:
 *                           type: string
 *                     user:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         name:
 *                           type: string
 *                         displayName:
 *                           type: string
 *                     challenge:
 *                       type: string
 *                       description: base64url-encoded random challenge
 *                     pubKeyCredParams:
 *                       type: array
 *                       items:
 *                         type: object
 *                     attestation:
 *                       type: string
 *                       example: none
 *                     excludeCredentials:
 *                       type: array
 *                       items:
 *                         type: object
 *                     authenticatorSelection:
 *                       type: object
 *                       properties:
 *                         residentKey:
 *                           type: string
 *                           example: preferred
 *                         userVerification:
 *                           type: string
 *                           example: preferred
 *             example:
 *               success: true
 *               data:
 *                 rp:
 *                   name: Stellar MarketPay
 *                   id: localhost
 *                 user:
 *                   id: R0hDMzJYTU5TMkJTSFBGRUtDMjUyTDROUktCTDJUR1JFN1pXTlhBM0hWNUZLQlBNTzNXVlBEQlg
 *                   name: GHC32XMN…PDBX
 *                   displayName: GHC32XMN…PDBX
 *                 challenge: Y2hhbGxlbmdlLWV4YW1wbGUtYmFzZTY0dXJs
 *                 pubKeyCredParams:
 *                   - alg: -7
 *                     type: public-key
 *                 attestation: none
 *                 excludeCredentials: []
 *                 authenticatorSelection:
 *                   residentKey: preferred
 *                   userVerification: preferred
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post(
  "/register-options",
  webauthnAccountIpLimiter,
  verifyJWT,
  webauthnAccountPrincipalLimiter,
  async (req, res, next) => {
    try {
      const publicKey = req.user.publicKey;

      const { rows: existing } = await pool.query(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
        [publicKey]
      );

      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userID: new TextEncoder().encode(publicKey),
        userName: publicKey.slice(0, 8) + "…" + publicKey.slice(-4),
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({
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

/**
 * @swagger
 * /api/webauthn/register-verify:
 *   post:
 *     summary: Verify a passkey registration and store the credential
 *     description: >
 *       Verifies the browser's `PublicKeyCredential` attestation response
 *       (from `navigator.credentials.create()`) against the challenge
 *       previously issued by `POST /api/webauthn/register-options`, using
 *       `@simplewebauthn/server`'s `verifyRegistrationResponse`. On success,
 *       deletes the pending challenge and inserts the new credential
 *       (credential ID, COSE public key, counter, transports) into
 *       `webauthn_credentials` for the authenticated user.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credential
 *             properties:
 *               credential:
 *                 type: object
 *                 description: RegistrationResponseJSON returned by navigator.credentials.create()
 *                 properties:
 *                   id:
 *                     type: string
 *                   rawId:
 *                     type: string
 *                   type:
 *                     type: string
 *                     example: public-key
 *                   response:
 *                     type: object
 *                     properties:
 *                       clientDataJSON:
 *                         type: string
 *                       attestationObject:
 *                         type: string
 *                       transports:
 *                         type: array
 *                         items:
 *                           type: string
 *               name:
 *                 type: string
 *                 description: Optional display name for the passkey (truncated to 64 chars, defaults to "Passkey")
 *                 example: My iPhone
 *           example:
 *             credential:
 *               id: AVGHb3fzZ9k2Lp1qXwR8tYcNmE
 *               rawId: AVGHb3fzZ9k2Lp1qXwR8tYcNmE
 *               type: public-key
 *               response:
 *                 clientDataJSON: eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiWTJoaGJHeGxibWRsLWVYWXRZbVZ6WVRZMGRYSnMifQ
 *                 attestationObject: o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVjE
 *                 transports:
 *                   - internal
 *                   - hybrid
 *             name: My iPhone
 *     responses:
 *       200:
 *         description: Passkey registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: Passkey registered successfully
 *       400:
 *         description: No pending registration challenge for this account, or the attestation failed verification
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               noChallenge:
 *                 value:
 *                   error: No pending registration challenge. Please try again.
 *               failedVerification:
 *                 value:
 *                   error: Passkey registration verification failed
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post(
  "/register-verify",
  webauthnAccountIpLimiter,
  verifyJWT,
  webauthnAccountPrincipalLimiter,
  async (req, res, next) => {
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
      await pool.query(
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

/**
 * @swagger
 * /api/webauthn/login-options:
 *   post:
 *     summary: Get WebAuthn passkey authentication options
 *     description: >
 *       Generates a WebAuthn `PublicKeyCredentialRequestOptions` challenge
 *       (via `@simplewebauthn/server`) listing the passkeys registered for
 *       the given Stellar public key as `allowCredentials` (empty if the
 *       account has none). The challenge is cached in memory (keyed by
 *       public key, 5-minute TTL) to be verified by
 *       `POST /api/webauthn/login-verify`. This endpoint does not require a
 *       JWT — it is used to start passkey login. Pass the returned `data`
 *       object to `navigator.credentials.get({ publicKey: data })`.
 *     tags: [WebAuthn]
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key (G-address) attempting to log in
 *           example:
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Authentication options generated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   description: PublicKeyCredentialRequestOptionsJSON
 *                   properties:
 *                     challenge:
 *                       type: string
 *                       description: base64url-encoded random challenge
 *                     allowCredentials:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                           type:
 *                             type: string
 *                             example: public-key
 *                           transports:
 *                             type: array
 *                             items:
 *                               type: string
 *                     userVerification:
 *                       type: string
 *                       example: preferred
 *             example:
 *               success: true
 *               data:
 *                 challenge: YXV0aC1jaGFsbGVuZ2UtZXhhbXBsZS1iYXNlNjR1cmw
 *                 allowCredentials:
 *                   - id: AVGHb3fzZ9k2Lp1qXwR8tYcNmE
 *                     type: public-key
 *                     transports:
 *                       - internal
 *                 userVerification: preferred
 *       400:
 *         description: publicKey missing or not a valid Stellar G-address
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid Stellar public key
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post(
  "/login-options",
  webauthnPublicIpLimiter,
  webauthnPublicPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.body;
      if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
        const e = new Error("Invalid Stellar public key");
        e.status = 400;
        throw e;
      }

      const { rows: credentials } = await pool.query(
        "SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1",
        [publicKey]
      );

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials: credentials.map((c) => ({
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
  }
);

/**
 * @swagger
 * /api/webauthn/login-verify:
 *   post:
 *     summary: Verify a passkey assertion and log in
 *     description: >
 *       Verifies the browser's `PublicKeyCredential` assertion response
 *       (from `navigator.credentials.get()`) against the challenge
 *       previously issued by `POST /api/webauthn/login-options`, using
 *       `@simplewebauthn/server`'s `verifyAuthenticationResponse` and the
 *       stored credential's public key/counter. On success, updates the
 *       stored signature counter, issues a fresh access/refresh JWT pair via
 *       the same mechanism as the SEP-10 login flow, sets them as httpOnly
 *       `jwt`/`refreshToken` cookies, and also returns the access token in
 *       the response body.
 *     tags: [WebAuthn]
 *     x-rate-limit:
 *       limit: 10
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - credential
 *               - publicKey
 *             properties:
 *               credential:
 *                 type: object
 *                 description: AuthenticationResponseJSON returned by navigator.credentials.get()
 *                 properties:
 *                   id:
 *                     type: string
 *                   rawId:
 *                     type: string
 *                   type:
 *                     type: string
 *                     example: public-key
 *                   response:
 *                     type: object
 *                     properties:
 *                       clientDataJSON:
 *                         type: string
 *                       authenticatorData:
 *                         type: string
 *                       signature:
 *                         type: string
 *                       userHandle:
 *                         type: string
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key (G-address) logging in
 *           example:
 *             credential:
 *               id: AVGHb3fzZ9k2Lp1qXwR8tYcNmE
 *               rawId: AVGHb3fzZ9k2Lp1qXwR8tYcNmE
 *               type: public-key
 *               response:
 *                 clientDataJSON: eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiWVhWMExXTmhhR3hsYm1kbCJ9
 *                 authenticatorData: SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2M
 *                 signature: MEUCIQDx8oV6P3s2h1zN9m4b6Kx2r5v8s1w3y7z9a1c3e5g7i9k1
 *                 userHandle: R0hDMzJYTU5TMkJTSFBGRUtDMjUyTDROUktCTDJUR1JFN1pXTlhBM0hWNUZLQlBNTzNXVlBEQlg
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Passkey verified; JWT issued
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
 *                   description: Short-lived (15 minute) JWT access token; also set as the httpOnly `jwt` cookie
 *             example:
 *               success: true
 *               token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJwdWJsaWNLZXkiOiJHSEMzMlhNTlMyQlNIUEZFS0MyNTJMNE5SS0JMMlRHUkU3WldOWEEzSFY1RktCUE1PM1dWUERCWCJ9.4Q1p2z9x0w7y8v6u5t4s3r2q1p0o9n8m7l6k5j4i3h2g1f
 *       400:
 *         description: publicKey missing/invalid, or no pending authentication challenge for this account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               invalidPublicKey:
 *                 value:
 *                   error: Invalid Stellar public key
 *               noChallenge:
 *                 value:
 *                   error: No pending authentication challenge. Please try again.
 *       401:
 *         description: Passkey authentication failed or no matching credential exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Passkey authentication failed
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post(
  "/login-verify",
  webauthnPublicIpLimiter,
  webauthnPublicPrincipalLimiter,
  webauthnFailureBackoff,
  async (req, res, next) => {
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
      const { rows } = await pool.query(
        "SELECT * FROM webauthn_credentials WHERE credential_id = $1 AND public_key = $2",
        [credentialId, publicKey]
      );

      if (!rows.length) {
        const e = new Error("Passkey authentication failed");
        e.status = 401;
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

      await pool.query("UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2", [
        verification.authenticationInfo.newCounter,
        credentialId,
      ]);

      const { accessToken, refreshToken } = issueTokenPair({ publicKey });
      setAuthCookies(res, accessToken, refreshToken);

      res.json({ success: true, token: accessToken });
    } catch (e) {
      next(e);
    }
  }
);

// ─── Credential management ─────────────────────────────────────────────────────

/**
 * @swagger
 * /api/webauthn/credentials:
 *   get:
 *     summary: List registered passkeys
 *     description: Lists the authenticated user's registered WebAuthn credentials, newest first.
 *     tags: [WebAuthn]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Passkeys retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         format: uuid
 *                       credential_name:
 *                         type: string
 *                       created_at:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                   credential_name: My iPhone
 *                   created_at: "2026-07-01T10:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  "/credentials",
  webauthnAccountIpLimiter,
  verifyJWT,
  webauthnAccountPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, credential_name, created_at FROM webauthn_credentials WHERE public_key = $1 ORDER BY created_at DESC",
        [req.user.publicKey]
      );
      res.json({ success: true, data: rows });
    } catch (e) {
      next(e);
    }
  }
);

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
  async (req, res, next) => {
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
