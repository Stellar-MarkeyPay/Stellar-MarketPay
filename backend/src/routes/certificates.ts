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
 * src/routes/certificates.js
 * Skill certificate endpoints.
 *
 * GET /api/certificates/:id         — get a certificate by ID
 * GET /api/certificates/user/:publicKey — get all certificates for a user
 */
("use strict");

const express = require("express");
const router = express.Router();
const pool = require("../db/pool");

/**
 * @swagger
 * /api/certificates/{id}:
 *   get:
 *     summary: Get a skill certificate by ID
 *     description: >
 *       Looks up a single skill certificate by its database ID, joined with
 *       the issuing freelancer's profile display name, and adds a
 *       stellar.expert verification link derived from the certificate hash.
 *     tags: [Certificates]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Skill certificate database ID
 *         example: 42
 *     responses:
 *       200:
 *         description: Certificate found
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
 *                     id:
 *                       type: string
 *                       example: "42"
 *                     publicKey:
 *                       type: string
 *                       example: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                     displayName:
 *                       type: string
 *                       nullable: true
 *                       example: Jane Doe
 *                     skill:
 *                       type: string
 *                       example: Solidity
 *                     score:
 *                       type: number
 *                       example: 92
 *                     certificateHash:
 *                       type: string
 *                       example: 3f29a1c9e2b7d4f8
 *                     ipfsCid:
 *                       type: string
 *                       nullable: true
 *                       example: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                     txHash:
 *                       type: string
 *                       nullable: true
 *                       example: a1b2c3d4e5f6
 *                     issuedAt:
 *                       type: string
 *                       format: date-time
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     verifyUrl:
 *                       type: string
 *                       description: stellar.expert search link derived from certificateHash
 *                       example: https://stellar.expert/explorer/testnet/search?q=3f29a1c9e2b7d4f8
 *             example:
 *               success: true
 *               data:
 *                 id: "42"
 *                 publicKey: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 displayName: Jane Doe
 *                 skill: Solidity
 *                 score: 92
 *                 certificateHash: 3f29a1c9e2b7d4f8
 *                 ipfsCid: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                 txHash: a1b2c3d4e5f6
 *                 issuedAt: "2026-01-15T10:30:00.000Z"
 *                 createdAt: "2026-01-15T10:30:00.000Z"
 *                 verifyUrl: https://stellar.expert/explorer/testnet/search?q=3f29a1c9e2b7d4f8
 *       404:
 *         description: Certificate not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Certificate not found
 *       500:
 *         description: Server or database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// ─── GET /api/certificates/:id ──────────────────────────────────────────────
router.get("/:id", async (req: any, res: any, next: any) => {
  try {
    const { rows } = await rawQuery<any>(
      `SELECT
         sc.id,
         sc.public_key,
         sc.skill,
         sc.score,
         sc.certificate_hash,
         sc.ipfs_cid,
         sc.tx_hash,
         sc.issued_at,
         sc.created_at,
         p.display_name
       FROM skill_certificates sc
       LEFT JOIN profiles p ON p.public_key = sc.public_key
       WHERE sc.id = $1`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: "Certificate not found" });
    }

    const cert = rows[0];
    res.json({
      success: true,
      data: {
        id: cert.id,
        publicKey: cert.public_key,
        displayName: cert.display_name,
        skill: cert.skill,
        score: cert.score,
        certificateHash: cert.certificate_hash,
        ipfsCid: cert.ipfs_cid,
        txHash: cert.tx_hash,
        issuedAt: cert.issued_at,
        createdAt: cert.created_at,
        verifyUrl: `https://stellar.expert/explorer/testnet/search?q=${cert.certificate_hash}`,
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/certificates/user/{publicKey}:
 *   get:
 *     summary: List all skill certificates for a user
 *     description: >
 *       Returns every skill certificate issued to the given Stellar public
 *       key, newest first (ordered by issued_at DESC), each with a
 *       stellar.expert verification link. Returns an empty array (still 200)
 *       when the user has no certificates.
 *     tags: [Certificates]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key of the certificate holder
 *         example: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *     responses:
 *       200:
 *         description: Certificates retrieved successfully (may be an empty array)
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
 *                       publicKey:
 *                         type: string
 *                       displayName:
 *                         type: string
 *                         nullable: true
 *                       skill:
 *                         type: string
 *                       score:
 *                         type: number
 *                       certificateHash:
 *                         type: string
 *                       ipfsCid:
 *                         type: string
 *                         nullable: true
 *                       txHash:
 *                         type: string
 *                         nullable: true
 *                       issuedAt:
 *                         type: string
 *                         format: date-time
 *                       verifyUrl:
 *                         type: string
 *             example:
 *               success: true
 *               data:
 *                 - id: "42"
 *                   publicKey: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   displayName: Jane Doe
 *                   skill: Solidity
 *                   score: 92
 *                   certificateHash: 3f29a1c9e2b7d4f8
 *                   ipfsCid: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                   txHash: a1b2c3d4e5f6
 *                   issuedAt: "2026-01-15T10:30:00.000Z"
 *                   verifyUrl: https://stellar.expert/explorer/testnet/search?q=3f29a1c9e2b7d4f8
 *       500:
 *         description: Server or database error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// ─── GET /api/certificates/user/:publicKey ──────────────────────────────────
router.get("/user/:publicKey", async (req: any, res: any, next: any) => {
  try {
    const { rows } = await rawQuery<any>(
      `SELECT
         sc.id,
         sc.public_key,
         sc.skill,
         sc.score,
         sc.certificate_hash,
         sc.ipfs_cid,
         sc.tx_hash,
         sc.issued_at,
         p.display_name
       FROM skill_certificates sc
       LEFT JOIN profiles p ON p.public_key = sc.public_key
       WHERE sc.public_key = $1
       ORDER BY sc.issued_at DESC`,
      [req.params.publicKey]
    );

    res.json({
      success: true,
      data: rows.map((r: any) => ({
        id: r.id,
        publicKey: r.public_key,
        displayName: r.display_name,
        skill: r.skill,
        score: r.score,
        certificateHash: r.certificate_hash,
        ipfsCid: r.ipfs_cid,
        txHash: r.tx_hash,
        issuedAt: r.issued_at,
        verifyUrl: `https://stellar.expert/explorer/testnet/search?q=${r.certificate_hash}`,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
