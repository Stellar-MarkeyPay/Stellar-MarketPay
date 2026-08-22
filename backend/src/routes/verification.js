const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { createRateLimiter } = require("../middleware/rateLimiter");

const verificationRateLimiter = createRateLimiter(5, 1);

// In-memory store for verification tokens (use database in production)
const verificationTokens = new Map();
const verifications = new Map();

// Send email verification link
/**
 * @swagger
 * /api/verification/email:
 *   post:
 *     summary: Send an email verification link
 *     description: >
 *       Generates a random verification token, stores it in memory with a
 *       24-hour expiry, and logs a verification link (`{FRONTEND_URL}/verify?token=...`)
 *       to the server console. In production this would be sent by email
 *       instead of logged.
 *     tags: [Verification]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - publicKey
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Email address to verify
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key the email is being linked to
 *           example:
 *             email: freelancer@example.com
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Verification email sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Verification email sent
 *       400:
 *         description: Email and/or publicKey missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Email and publicKey required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/email", verificationRateLimiter, async (req, res, next) => {
  try {
    const { email, publicKey } = req.body;
    if (!email || !publicKey) {
      return res.status(400).json({ error: "Email and publicKey required" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    verificationTokens.set(token, { email, publicKey, expiresAt, type: "email" });

    // In production: send email with verification link
    const verificationLink = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify?token=${token}`;
    console.log(`Email verification link: ${verificationLink}`);

    res.json({ success: true, message: "Verification email sent" });
  } catch (error) {
    next(error);
  }
});

// Verify email with token
/**
 * @swagger
 * /api/verification/email/confirm:
 *   post:
 *     summary: Confirm an email verification token
 *     description: >
 *       Validates the token issued by `POST /api/verification/email`. On
 *       success, records `emailVerified: true` (and the email address) for
 *       the associated public key and deletes the one-time token.
 *     tags: [Verification]
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
 *                 description: Token from the verification link
 *           example:
 *             token: 4f3c1e9a7b2d6c8f0a1e3b5d7f9c1a3e5b7d9f1a3c5e7b9d1f3a5c7e9b1d3f5a
 *     responses:
 *       200:
 *         description: Email verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Email verified successfully
 *       400:
 *         description: Token is missing, unknown, expired, or was not an email-verification token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired token
 */
router.post("/email/confirm", async (req, res, next) => {
  try {
    const { token } = req.body;
    const verification = verificationTokens.get(token);

    if (!verification || verification.expiresAt < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    if (verification.type !== "email") {
      return res.status(400).json({ error: "Invalid verification type" });
    }

    verifications.set(verification.publicKey, {
      emailVerified: true,
      phoneVerified: false,
      idVerified: false,
      email: verification.email,
      verifiedAt: new Date(),
    });

    verificationTokens.delete(token);

    res.json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    next(error);
  }
});

// Send phone verification OTP
/**
 * @swagger
 * /api/verification/phone:
 *   post:
 *     summary: Send a phone verification OTP
 *     description: >
 *       Generates a random 6-digit numeric OTP, stores it in memory (keyed by
 *       the OTP code itself) with a 10-minute expiry, and logs it to the
 *       server console. In production this would be sent by SMS instead of
 *       logged.
 *     tags: [Verification]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - publicKey
 *             properties:
 *               phone:
 *                 type: string
 *                 description: Phone number to verify, in any format
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key the phone number is being linked to
 *           example:
 *             phone: "+15551234567"
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: OTP generated and (in production) sent to the phone number
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: OTP sent to phone
 *       400:
 *         description: Phone and/or publicKey missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Phone and publicKey required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/phone", verificationRateLimiter, async (req, res, next) => {
  try {
    const { phone, publicKey } = req.body;
    if (!phone || !publicKey) {
      return res.status(400).json({ error: "Phone and publicKey required" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    verificationTokens.set(otp, { phone, publicKey, expiresAt, type: "phone" });

    // In production: send SMS via Twilio or similar
    console.log(`Phone verification OTP for ${phone}: ${otp}`);

    res.json({ success: true, message: "OTP sent to phone" });
  } catch (error) {
    next(error);
  }
});

// Verify phone OTP
/**
 * @swagger
 * /api/verification/phone/confirm:
 *   post:
 *     summary: Confirm a phone verification OTP
 *     description: >
 *       Validates the OTP issued by `POST /api/verification/phone` and that
 *       it was issued for the given public key. On success, merges
 *       `phoneVerified: true` (and the phone number) into that public key's
 *       verification record and deletes the one-time OTP.
 *     tags: [Verification]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - otp
 *               - publicKey
 *             properties:
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP received via SMS
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key the OTP was issued for
 *           example:
 *             otp: "482913"
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Phone verified successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Phone verified successfully
 *       400:
 *         description: OTP is missing, unknown, expired, or does not match the given publicKey
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid or expired OTP
 */
router.post("/phone/confirm", async (req, res, next) => {
  try {
    const { otp, publicKey } = req.body;
    const verification = verificationTokens.get(otp);

    if (
      !verification ||
      verification.expiresAt < Date.now() ||
      verification.publicKey !== publicKey
    ) {
      return res.status(400).json({ error: "Invalid or expired OTP" });
    }

    const user = verifications.get(publicKey) || {};
    verifications.set(publicKey, { ...user, phoneVerified: true, phone: verification.phone });

    verificationTokens.delete(otp);

    res.json({ success: true, message: "Phone verified successfully" });
  } catch (error) {
    next(error);
  }
});

// Submit ID verification (admin review required)
/**
 * @swagger
 * /api/verification/id/submit:
 *   post:
 *     summary: Submit government ID details for verification
 *     description: >
 *       Records the submitted ID details against the given public key with
 *       `idSubmitted: true` and `idVerified: false`, pending manual admin
 *       review. This endpoint only stores the submission; it does not itself
 *       perform or require admin approval.
 *     tags: [Verification]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - publicKey
 *               - idType
 *               - idNumber
 *               - fullName
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key the ID is being linked to
 *               idType:
 *                 type: string
 *                 description: Type of government-issued ID
 *                 example: passport
 *               idNumber:
 *                 type: string
 *                 description: ID document number
 *               fullName:
 *                 type: string
 *                 description: Full legal name as shown on the ID
 *           example:
 *             publicKey: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *             idType: passport
 *             idNumber: P1234567
 *             fullName: Jane Doe
 *     responses:
 *       200:
 *         description: ID submitted for review
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: ID submitted for review
 *       400:
 *         description: One or more required fields are missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: All fields required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/id/submit", verificationRateLimiter, async (req, res, next) => {
  try {
    const { publicKey, idType, idNumber, fullName } = req.body;
    if (!publicKey || !idType || !idNumber || !fullName) {
      return res.status(400).json({ error: "All fields required" });
    }

    const user = verifications.get(publicKey) || {};
    verifications.set(publicKey, {
      ...user,
      idSubmitted: true,
      idVerified: false,
      idType,
      idNumber,
      fullName,
      idSubmittedAt: new Date(),
    });

    res.json({ success: true, message: "ID submitted for review" });
  } catch (error) {
    next(error);
  }
});

// Get verification status for a user
/**
 * @swagger
 * /api/verification/{publicKey}:
 *   get:
 *     summary: Get verification status for a user
 *     description: >
 *       Returns the stored verification record for the given Stellar public
 *       key. If no record exists yet, returns the default unverified state
 *       (`emailVerified`, `phoneVerified`, and `idVerified` all `false`).
 *     tags: [Verification]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) to look up
 *         example: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *     responses:
 *       200:
 *         description: Verification status retrieved successfully
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
 *                     emailVerified:
 *                       type: boolean
 *                     phoneVerified:
 *                       type: boolean
 *                     idVerified:
 *                       type: boolean
 *                     email:
 *                       type: string
 *                       description: Present once an email has been verified
 *                     phone:
 *                       type: string
 *                       description: Present once a phone number has been verified
 *                     idSubmitted:
 *                       type: boolean
 *                       description: Present once ID details have been submitted
 *                     idType:
 *                       type: string
 *                     fullName:
 *                       type: string
 *             examples:
 *               unverified:
 *                 value:
 *                   success: true
 *                   data:
 *                     emailVerified: false
 *                     phoneVerified: false
 *                     idVerified: false
 *               partiallyVerified:
 *                 value:
 *                   success: true
 *                   data:
 *                     emailVerified: true
 *                     phoneVerified: true
 *                     idVerified: false
 *                     email: freelancer@example.com
 *                     phone: "+15551234567"
 *                     idSubmitted: true
 *                     idType: passport
 *                     fullName: Jane Doe
 */
router.get("/:publicKey", async (req, res, next) => {
  try {
    const user = verifications.get(req.params.publicKey) || {
      emailVerified: false,
      phoneVerified: false,
      idVerified: false,
    };

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
