/**
 * Admin TOTP 2FA — POST /api/admin/2fa/setup, POST /api/admin/2fa/verify
 */
"use strict";

const express = require("express");
const QRCode = require("qrcode");
const speakeasy = require("speakeasy");
const pool = require("../db/pool");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { signAccessToken } = require("../services/authTokens");
const { encrypt } = require("../utils/encryption");
const {
  generateSecret,
  enable2FA,
  verify2FA,
  get2FAStatus,
  ensureAdminProfile,
  getDecryptedSecret,
} = require("../services/twoFactorService");

const router = express.Router();

function issueAdminToken(publicKey, twoFaVerified) {
  return signAccessToken({ publicKey, role: "admin", "2fa_verified": twoFaVerified });
}

// POST /api/admin/2fa/setup — generate TOTP secret and QR code
/**
 * @swagger
 * /api/admin/2fa/setup:
 *   post:
 *     summary: Generate a new TOTP 2FA secret and QR code
 *     description: >
 *       Admin-only. Ensures an `admin_profiles` row exists for the caller, then generates a new
 *       TOTP secret (speakeasy) and a QR code data URL for it. The secret is persisted encrypted
 *       with `totp_enabled = false` until confirmed via `POST /api/admin/2fa/verify`. Fails with
 *       400 if 2FA is already enabled for this admin.
 *     tags: [Admin2FA]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: TOTP secret generated. Scan the QR code (or enter the key manually) in an authenticator app.
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
 *                     qrCode:
 *                       type: string
 *                       description: Data URL (PNG) of the TOTP QR code, for scanning in an authenticator app.
 *                       example: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *                     manualEntryKey:
 *                       type: string
 *                       description: Base32-encoded TOTP secret for manual entry.
 *                       example: "JBSWY3DPEHPK3PXP"
 *             example:
 *               success: true
 *               data:
 *                 qrCode: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *                 manualEntryKey: "JBSWY3DPEHPK3PXP"
 *       400:
 *         description: 2FA is already enabled for this admin account.
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
 *               error: "2FA is already enabled"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post("/setup", verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    await ensureAdminProfile(publicKey);

    const { rows } = await pool.query("SELECT totp_enabled FROM admin_profiles WHERE id = $1", [
      publicKey,
    ]);
    if (rows[0]?.totp_enabled) {
      return res.status(400).json({ success: false, error: "2FA is already enabled" });
    }

    const secret = generateSecret(publicKey);
    const qrCode = await QRCode.toDataURL(secret.otpauth_url || secret.otpauthURL);

    await pool.query(
      "UPDATE admin_profiles SET totp_secret = $1, totp_enabled = false, updated_at = NOW() WHERE id = $2",
      [encrypt(secret.base32), publicKey]
    );

    res.json({
      success: true,
      data: {
        qrCode,
        manualEntryKey: secret.base32,
      },
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/admin/2fa/verify — verify TOTP, enable 2FA (setup), upgrade JWT
/**
 * @swagger
 * /api/admin/2fa/verify:
 *   post:
 *     summary: Verify a TOTP code and enable/confirm 2FA, or upgrade an existing session
 *     description: >
 *       Admin-only. Requires a 6-digit TOTP `token` in the body. Requires that
 *       `POST /api/admin/2fa/setup` was already called (otherwise 400).
 *       If `setup: true` was passed, or 2FA is not yet enabled, the code is verified against the
 *       pending secret and, on success, 2FA is enabled and a one-time set of 10 backup codes is
 *       generated and returned (shown only this once). Otherwise the code is verified against the
 *       already-enabled secret via `verify2FA` (which enforces a 5-attempt lockout). On success in
 *       either case, a new JWT is issued with `2fa_verified: true`.
 *     tags: [Admin2FA]
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
 *                 description: 6-digit TOTP code from the authenticator app.
 *                 example: "123456"
 *               setup:
 *                 type: boolean
 *                 description: Pass true when confirming initial 2FA setup (generates backup codes).
 *                 example: true
 *           example:
 *             token: "123456"
 *             setup: true
 *     responses:
 *       200:
 *         description: "TOTP code verified. Returns an upgraded JWT with the 2fa_verified claim set to true."
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
 *                   description: New JWT with the `2fa_verified` claim set to true.
 *                 data:
 *                   type: object
 *                   properties:
 *                     backupCodes:
 *                       type: array
 *                       description: Only present when 2FA was just enabled (setup flow). Not shown again.
 *                       items:
 *                         type: string
 *                       example: ["A1B2C3D4", "E5F6G7H8"]
 *                     message:
 *                       type: string
 *                       example: "2FA enabled. Save your backup codes — they will not be shown again."
 *             example:
 *               success: true
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               data:
 *                 backupCodes: ["A1B2C3D4", "E5F6G7H8"]
 *                 message: "2FA enabled. Save your backup codes — they will not be shown again."
 *       400:
 *         description: >
 *           Missing/malformed token, 2FA setup not initiated (call `/setup` first), invalid
 *           verification code, or (for an already-enabled account) a `verify2FA` failure such as
 *           an incorrect code or a temporary lockout after 5 failed attempts.
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
 *                 value: { success: false, error: "A 6-digit TOTP code is required" }
 *               setupNotInitiated:
 *                 value: { success: false, error: "2FA setup not initiated. Call /setup first." }
 *               invalidCode:
 *                 value: { success: false, error: "Invalid verification code" }
 *               lockedOut:
 *                 value: { success: false, error: "Too many failed attempts. Account locked for 15 minutes." }
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.post("/verify", verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const { publicKey } = req.user;
    const { token, setup } = req.body;

    if (!token || String(token).length !== 6) {
      return res.status(400).json({ success: false, error: "A 6-digit TOTP code is required" });
    }

    const status = await get2FAStatus(publicKey);
    const secret = await getDecryptedSecret(publicKey);

    if (!secret) {
      return res
        .status(400)
        .json({ success: false, error: "2FA setup not initiated. Call /setup first." });
    }

    let backupCodes;

    if (setup || !status.totp_enabled) {
      const verified = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: String(token),
        window: 1,
      });

      if (!verified) {
        return res.status(400).json({ success: false, error: "Invalid verification code" });
      }

      backupCodes = Array.from({ length: 10 }, () =>
        Math.random().toString(36).substring(2, 10).toUpperCase()
      );
      await enable2FA(publicKey, secret, backupCodes);
    } else {
      const result = await verify2FA(publicKey, String(token));
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }
    }

    const upgradedToken = issueAdminToken(publicKey, true);

    res.json({
      success: true,
      token: upgradedToken,
      data: {
        backupCodes,
        message: backupCodes
          ? "2FA enabled. Save your backup codes — they will not be shown again."
          : "2FA verified",
      },
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/admin/2fa/status
/**
 * @swagger
 * /api/admin/2fa/status:
 *   get:
 *     summary: Get the current admin's 2FA status
 *     description: >
 *       Admin-only. Returns whether TOTP 2FA is enabled for the caller's admin profile, and
 *       whether the current JWT has already been through the 2FA-verify step
 *       (`req.user["2fa_verified"]`).
 *     tags: [Admin2FA]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: 2FA status retrieved successfully.
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
 *                       description: Whether TOTP 2FA is enabled for this admin.
 *                       example: true
 *                     verified:
 *                       type: boolean
 *                       description: Whether the current JWT has already passed 2FA verification.
 *                       example: false
 *             example:
 *               success: true
 *               data:
 *                 totp_enabled: true
 *                 verified: false
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
router.get("/status", verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const status = await get2FAStatus(req.user.publicKey);
    res.json({
      success: true,
      data: {
        ...status,
        verified: Boolean(req.user["2fa_verified"]),
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
