/**
 * src/routes/twoFactor.js
 * TOTP 2FA routes for admin accounts
 */
"use strict";
const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const { createSensitiveRateLimiters } = require("../middleware/rateLimiter");
const {
  generateSecret,
  enable2FA,
  verify2FA,
  verifyBackupCode,
  disable2FA,
  get2FAStatus,
} = require("../services/twoFactorService");
const QRCode = require("qrcode");
const speakeasy = require("speakeasy");

const { pool } = require("../db/pool");

const [twoFactorIpLimiter, twoFactorPrincipalLimiter] = createSensitiveRateLimiters({
  namespace: "two-factor",
  windowMinutes: 5,
  maxRequestsPerIp: 15,
  maxRequestsPerPrincipal: 6,
  principalKeyGenerator: (req) => req.user?.publicKey,
});

// GET /api/2fa/status — check if 2FA is enabled
/**
 * @swagger
 * /api/2fa/status:
 *   get:
 *     summary: Check whether TOTP 2FA is enabled
 *     description: >
 *       Looks up the `admin_profiles` row for the authenticated user's public
 *       key and returns its `totp_enabled` flag. If no admin profile exists
 *       yet, returns `{ totp_enabled: false }`.
 *     tags: [TwoFactor]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 2FA status retrieved successfully
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
 *                   properties:
 *                     totp_enabled:
 *                       type: boolean
 *             example:
 *               success: true
 *               data:
 *                 totp_enabled: false
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get(
  "/status",
  twoFactorIpLimiter,
  verifyJWT,
  twoFactorPrincipalLimiter,
  async (req, res, next) => {
    try {
      const status = await get2FAStatus(req.user.publicKey);
      res.json({ success: true, data: status });
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/2fa/setup — generate secret and QR code
/**
 * @swagger
 * /api/2fa/setup:
 *   post:
 *     summary: Start TOTP 2FA setup (admin-only)
 *     description: >
 *       Admin-only. Verifies the authenticated public key has a row in
 *       `admin_profiles`, generates a new TOTP secret (`speakeasy`) and a QR
 *       code data URL encoding its `otpauth://` URI (`qrcode`), and stores
 *       the secret on the admin profile with `totp_enabled = false`. 2FA is
 *       not actually enabled until the code is confirmed via
 *       `POST /api/2fa/verify`. Calling this again before verifying replaces
 *       the pending secret.
 *     tags: [TwoFactor]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: TOTP secret generated
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
 *                   properties:
 *                     secret:
 *                       type: string
 *                       description: Base32-encoded TOTP secret, for manual entry into an authenticator app
 *                     qrCode:
 *                       type: string
 *                       description: "data: URL (PNG) of a QR code encoding the otpauth:// URI"
 *             example:
 *               success: true
 *               data:
 *                 secret: JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
 *                 qrCode: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA...
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: The authenticated public key has no admin profile
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Admin access required
 */
router.post(
  "/setup",
  twoFactorIpLimiter,
  verifyJWT,
  twoFactorPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.user;

      // Check if admin
      const { rows } = await pool.query("SELECT id, email FROM admin_profiles WHERE id = $1", [
        publicKey,
      ]);
      if (!rows[0]) return res.status(403).json({ success: false, error: "Admin access required" });

      const secret = generateSecret(rows[0].email || publicKey);
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauthURL());

      // Store secret temporarily (not enabled until verified)
      await pool.query(
        "UPDATE admin_profiles SET totp_secret = $1, totp_enabled = false WHERE id = $2",
        [secret.base32, publicKey]
      );

      res.json({
        success: true,
        data: {
          secret: secret.base32,
          qrCode: qrCodeUrl,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/2fa/verify — verify TOTP code and enable 2FA
/**
 * @swagger
 * /api/2fa/verify:
 *   post:
 *     summary: Confirm the TOTP code and enable 2FA
 *     description: >
 *       Verifies the submitted 6-digit TOTP code against the pending secret
 *       stored by `POST /api/2fa/setup` (`speakeasy.totp.verify`, ±1 time
 *       step window). On success, generates 10 single-use backup codes,
 *       enables 2FA on the admin profile (`totp_enabled = true`), and
 *       returns the backup codes once — they are not retrievable again.
 *     tags: [TwoFactor]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code from the authenticator app
 *           example:
 *             token: "123456"
 *     responses:
 *       200:
 *         description: 2FA enabled successfully
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
 *                   properties:
 *                     backupCodes:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: 10 single-use backup codes; shown only this once
 *                     message:
 *                       type: string
 *             example:
 *               success: true
 *               data:
 *                 backupCodes:
 *                   - A1B2C3
 *                   - D4E5F6
 *                   - G7H8I9
 *                   - J1K2L3
 *                   - M4N5O6
 *                   - P7Q8R9
 *                   - S1T2U3
 *                   - V4W5X6
 *                   - Y7Z8A9
 *                   - B1C2D3
 *                 message: 2FA enabled successfully. Save these backup codes!
 *       400:
 *         description: Token missing, 2FA setup was never started, or the code is invalid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             examples:
 *               missingToken:
 *                 value:
 *                   success: false
 *                   error: Token is required
 *               setupNotInitiated:
 *                 value:
 *                   success: false
 *                   error: 2FA setup not initiated
 *               invalidCode:
 *                 value:
 *                   success: false
 *                   error: Invalid verification code
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/verify",
  twoFactorIpLimiter,
  verifyJWT,
  twoFactorPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.user;
      const { token } = req.body;

      if (!token) return res.status(400).json({ success: false, error: "Token is required" });

      const { rows } = await pool.query("SELECT totp_secret FROM admin_profiles WHERE id = $1", [
        publicKey,
      ]);
      if (!rows[0] || !rows[0].totp_secret) {
        return res.status(400).json({ success: false, error: "2FA setup not initiated" });
      }

      const verified = speakeasy.totp.verify({
        secret: rows[0].totp_secret,
        encoding: "base32",
        token,
        window: 1,
      });

      if (!verified) {
        return res.status(400).json({ success: false, error: "Invalid verification code" });
      }

      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () =>
        Math.random().toString(36).substring(2, 8).toUpperCase()
      );

      await enable2FA(publicKey, rows[0].totp_secret, backupCodes);

      res.json({
        success: true,
        data: {
          backupCodes,
          message: "2FA enabled successfully. Save these backup codes!",
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/2fa/disable — disable 2FA (requires wallet + TOTP or backup code)
/**
 * @swagger
 * /api/2fa/disable:
 *   post:
 *     summary: Disable TOTP 2FA
 *     description: >
 *       Disables 2FA for the authenticated admin after confirming ownership
 *       with either a current TOTP `token` or one of the account's unused
 *       `backupCode`s. Exactly one of the two should be provided; if `token`
 *       is present it is checked first. On success, clears the stored
 *       secret, backup codes, and lockout state.
 *     tags: [TwoFactor]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code from the authenticator app
 *               backupCode:
 *                 type: string
 *                 description: An unused backup code, as an alternative to token
 *           example:
 *             token: "123456"
 *     responses:
 *       200:
 *         description: 2FA disabled successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *             example:
 *               success: true
 *               message: 2FA disabled successfully
 *       400:
 *         description: Neither token nor backupCode provided, or the provided code/backup code is invalid
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             examples:
 *               missingCredential:
 *                 value:
 *                   success: false
 *                   error: Token or backup code required
 *               invalidCredential:
 *                 value:
 *                   success: false
 *                   error: Invalid token or backup code
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/disable",
  twoFactorIpLimiter,
  verifyJWT,
  twoFactorPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.user;
      const { token, backupCode } = req.body;

      if (!token && !backupCode) {
        return res.status(400).json({ success: false, error: "Token or backup code required" });
      }

      let verified = false;
      if (token) {
        const result = await verify2FA(publicKey, token);
        verified = result.success;
      } else if (backupCode) {
        const result = await verifyBackupCode(publicKey, backupCode);
        verified = result.success;
      }

      if (!verified) {
        return res.status(400).json({ success: false, error: "Invalid token or backup code" });
      }

      await disable2FA(publicKey);
      res.json({ success: true, message: "2FA disabled successfully" });
    } catch (e) {
      next(e);
    }
  }
);

// POST /api/2fa/validate — validate TOTP during login
/**
 * @swagger
 * /api/2fa/validate:
 *   post:
 *     summary: Validate a TOTP code during login
 *     description: >
 *       Checks a TOTP code against the authenticated admin's enabled 2FA
 *       secret (`speakeasy.totp.verify`, ±1 time step window), tracking
 *       failed attempts and locking the account for 15 minutes after 5
 *       consecutive failures. Unlike `/setup` and `/verify`, this always
 *       responds with HTTP 200 and reports success/failure in the response
 *       body rather than via the status code.
 *     tags: [TwoFactor]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code from the authenticator app
 *           example:
 *             token: "123456"
 *     responses:
 *       200:
 *         description: >
 *           Validation result. `success` is true only if the code matched;
 *           `error` is present only when `success` is false.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *             examples:
 *               valid:
 *                 value:
 *                   success: true
 *               invalid:
 *                 value:
 *                   success: false
 *                   error: Invalid 2FA code
 *               notEnabled:
 *                 value:
 *                   success: false
 *                   error: 2FA not enabled
 *               locked:
 *                 value:
 *                   success: false
 *                   error: Account locked due to too many failed attempts. Try again later.
 *       400:
 *         description: Token missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *             example:
 *               success: false
 *               error: Token is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.post(
  "/validate",
  twoFactorIpLimiter,
  verifyJWT,
  twoFactorPrincipalLimiter,
  async (req, res, next) => {
    try {
      const { publicKey } = req.user;
      const { token } = req.body;

      if (!token) return res.status(400).json({ success: false, error: "Token is required" });

      const result = await verify2FA(publicKey, token);
      res.json({ success: result.success, error: result.error });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
