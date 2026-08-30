/**
 * backend/src/routes/insurance.js
 * Insurance API Routes
 * Endpoints for managing storage insurance policies and claims
 */
"use strict";

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const slaMonitor = require("../services/sla_monitor");
const { createServiceLogger } = require("../utils/logger");

const router = express.Router();
const logger = createServiceLogger("insurance_routes");

/**
 * @swagger
 * /api/insurance/policies:
 *   post:
 *     summary: Create a new insurance policy for a file
 *     description: >
 *       Creates an insurance policy for a file stored on IPFS or Arweave. The premium is
 *       calculated as 2% of the declared file value, scaled up to 2x for files larger than
 *       10MB. Files over 100MB are rejected by the underlying service as a plain error, which
 *       surfaces as a 500 response rather than a 400 since it isn't caught by this route.
 *     tags: [Insurance]
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
 *               - cid
 *               - fileSize
 *               - fileValue
 *               - storageType
 *             properties:
 *               cid:
 *                 type: string
 *                 description: Content identifier (IPFS CID or Arweave transaction ID) of the file to insure
 *                 example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy
 *               fileSize:
 *                 type: number
 *                 description: File size in megabytes (must be > 0, max 100 MB)
 *                 example: 5.2
 *               fileValue:
 *                 type: number
 *                 description: Declared value of the file in XLM (must be > 0); the premium is 2% of this value, scaled by file size
 *                 example: 500
 *               storageType:
 *                 type: string
 *                 enum: [ipfs, arweave]
 *                 description: Storage backend the file is pinned on
 *                 example: ipfs
 *     responses:
 *       201:
 *         description: Policy created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 policy:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 42 }
 *                     cid: { type: string, example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy }
 *                     premium: { type: number, example: 10 }
 *                     fileValue: { type: number, example: 500 }
 *                     status: { type: string, example: active }
 *                     createdAt: { type: string, format: date-time, example: "2026-08-21T12:00:00.000Z" }
 *       400:
 *         description: Missing/invalid `cid`, `fileSize`, `fileValue`, or an unsupported `storageType`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *             example:
 *               error: Invalid storage type
 *               message: Storage type must be 'ipfs' or 'arweave'
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       500:
 *         description: Policy creation failed (e.g. file exceeds the 100MB insurable size limit, or the database insert failed)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: File size exceeds maximum insurable size of 100MB
 */
router.post("/policies", requireAuth, async (req, res, next) => {
  try {
    const { cid, fileSize, fileValue, storageType } = req.body;
    const ownerAddress = req.user.address;

    if (!cid || fileSize <= 0 || fileValue <= 0) {
      return res.status(400).json({
        error: "Invalid parameters",
        message: "CID, file size, and file value are required",
      });
    }

    if (!["ipfs", "arweave"].includes(storageType)) {
      return res.status(400).json({
        error: "Invalid storage type",
        message: "Storage type must be 'ipfs' or 'arweave'",
      });
    }

    const policy = await slaMonitor.createInsuredFile(
      cid,
      ownerAddress,
      fileSize,
      fileValue,
      storageType
    );

    logger.info({
      event: "policy_created_via_api",
      policyId: policy.id,
      ownerAddress,
      cid,
    });

    res.status(201).json({
      success: true,
      policy: {
        id: policy.id,
        cid: policy.cid,
        premium: policy.premium,
        fileValue: policy.file_value,
        status: policy.status,
        createdAt: policy.created_at,
      },
    });
  } catch (error) {
    logger.error({
      event: "policy_creation_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/policies:
 *   get:
 *     summary: List the authenticated user's insurance policies
 *     description: Returns every insured file owned by the authenticated Stellar address.
 *     tags: [Insurance]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Policies retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 policies:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, example: 42 }
 *                       cid: { type: string, example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy }
 *                       fileSize: { type: number, example: 5.2 }
 *                       fileValue: { type: number, example: 500 }
 *                       premium: { type: number, example: 10 }
 *                       status: { type: string, example: active }
 *                       availabilityScore: { type: number, example: 0.995 }
 *                       storageType: { type: string, enum: [ipfs, arweave], example: ipfs }
 *                       lastChecked: { type: string, format: date-time, nullable: true, example: "2026-08-21T11:00:00.000Z" }
 *                       createdAt: { type: string, format: date-time, example: "2026-08-20T09:00:00.000Z" }
 *                 count: { type: integer, example: 1 }
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       500:
 *         description: Unexpected error while retrieving policies
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/policies", requireAuth, async (req, res, next) => {
  try {
    const ownerAddress = req.user.address;

    const policies = await slaMonitor.getUserInsuredFiles(ownerAddress);

    res.json({
      success: true,
      policies: policies.map((p) => ({
        id: p.id,
        cid: p.cid,
        fileSize: p.file_size,
        fileValue: p.file_value,
        premium: p.premium,
        status: p.status,
        availabilityScore: p.availability_score,
        storageType: p.storage_type,
        lastChecked: p.last_checked,
        createdAt: p.created_at,
      })),
      count: policies.length,
    });
  } catch (error) {
    logger.error({
      event: "get_policies_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/policies/{id}:
 *   get:
 *     summary: Get a specific insurance policy
 *     description: Returns full details for one insured file owned by the authenticated user, including check history.
 *     tags: [Insurance]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Insured file (policy) ID
 *         example: 42
 *     responses:
 *       200:
 *         description: Policy details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 policy:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 42 }
 *                     cid: { type: string, example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy }
 *                     fileSize: { type: number, example: 5.2 }
 *                     fileValue: { type: number, example: 500 }
 *                     premium: { type: number, example: 10 }
 *                     status: { type: string, example: active }
 *                     availabilityScore: { type: number, example: 0.995 }
 *                     storageType: { type: string, enum: [ipfs, arweave], example: ipfs }
 *                     checksTotal: { type: integer, example: 48 }
 *                     checksPassed: { type: integer, example: 47 }
 *                     lastChecked: { type: string, format: date-time, nullable: true, example: "2026-08-21T11:00:00.000Z" }
 *                     createdAt: { type: string, format: date-time, example: "2026-08-20T09:00:00.000Z" }
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       404:
 *         description: Policy not found, or it does not belong to the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *             example:
 *               error: Not found
 *               message: Policy not found or you don't have permission to view it
 *       500:
 *         description: Unexpected error while retrieving the policy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/policies/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const ownerAddress = req.user.address;

    // Verify ownership
    const query = `
      SELECT * FROM insured_files
      WHERE id = $1 AND owner_address = $2
    `;

    const pool = require("../db/pool");
    const result = await pool.query(query, [id, ownerAddress]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Not found",
        message: "Policy not found or you don't have permission to view it",
      });
    }

    const policy = result.rows[0];

    res.json({
      success: true,
      policy: {
        id: policy.id,
        cid: policy.cid,
        fileSize: policy.file_size,
        fileValue: policy.file_value,
        premium: policy.premium,
        status: policy.status,
        availabilityScore: policy.availability_score,
        storageType: policy.storage_type,
        checksTotal: policy.checks_total,
        checksPassed: policy.checks_passed,
        lastChecked: policy.last_checked,
        createdAt: policy.created_at,
      },
    });
  } catch (error) {
    logger.error({
      event: "get_policy_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/claims:
 *   post:
 *     summary: Submit an insurance claim for an insured file
 *     description: >
 *       Verifies the caller owns the file, checks the file's current availability score is
 *       below the 99% SLA threshold, then evaluates and (if eligible) creates a claim via the
 *       SLA monitor. If the file already has a non-rejected claim, that existing claim is
 *       returned instead of creating a duplicate.
 *     tags: [Insurance]
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
 *               - fileId
 *             properties:
 *               fileId:
 *                 type: integer
 *                 description: ID of the insured file to claim against
 *                 example: 42
 *     responses:
 *       201:
 *         description: Claim submitted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 claim:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 7 }
 *                     fileId: { type: integer, example: 42 }
 *                     claimAmount: { type: number, example: 500 }
 *                     status: { type: string, example: pending }
 *                     createdAt: { type: string, format: date-time, example: "2026-08-21T12:00:00.000Z" }
 *       400:
 *         description: Missing `fileId`, file availability is still above the 99% threshold, or claim evaluation determined the file is not eligible
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *                 availabilityScore: { type: number }
 *             example:
 *               error: Not eligible
 *               message: File availability is above threshold. No claim can be made.
 *               availabilityScore: 0.995
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       404:
 *         description: File not found, or it does not belong to the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *             example:
 *               error: Not found
 *               message: File not found or you don't have permission
 *       500:
 *         description: Unexpected error while submitting the claim
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post("/claims", requireAuth, async (req, res, next) => {
  try {
    const { fileId } = req.body;
    const ownerAddress = req.user.address;

    if (!fileId) {
      return res.status(400).json({
        error: "Missing parameter",
        message: "fileId is required",
      });
    }

    // Verify ownership
    const pool = require("../db/pool");
    const fileQuery = `
      SELECT * FROM insured_files
      WHERE id = $1 AND owner_address = $2
    `;

    const fileResult = await pool.query(fileQuery, [fileId, ownerAddress]);

    if (fileResult.rows.length === 0) {
      return res.status(404).json({
        error: "Not found",
        message: "File not found or you don't have permission",
      });
    }

    const file = fileResult.rows[0];

    // Check if eligible for claim (availability < 99%)
    if (file.availability_score >= 0.99) {
      return res.status(400).json({
        error: "Not eligible",
        message: "File availability is above threshold. No claim can be made.",
        availabilityScore: file.availability_score,
      });
    }

    // Evaluate and create claim
    const claim = await slaMonitor.evaluateInsuranceClaim(fileId);

    if (!claim) {
      return res.status(400).json({
        error: "Not eligible",
        message: "Claim evaluation determined this file is not eligible",
      });
    }

    logger.info({
      event: "claim_submitted_via_api",
      claimId: claim.id,
      fileId,
      ownerAddress,
    });

    res.status(201).json({
      success: true,
      claim: {
        id: claim.id,
        fileId: claim.file_id,
        claimAmount: claim.claim_amount,
        status: claim.status,
        createdAt: claim.created_at,
      },
    });
  } catch (error) {
    logger.error({
      event: "claim_submission_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/claims:
 *   get:
 *     summary: List the authenticated user's insurance claims
 *     description: Returns every insurance claim owned by the authenticated address, newest first, joined with basic file info.
 *     tags: [Insurance]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Claims retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 claims:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, example: 7 }
 *                       fileId: { type: integer, example: 42 }
 *                       cid: { type: string, example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy }
 *                       claimAmount: { type: number, example: 500 }
 *                       status: { type: string, example: pending }
 *                       availabilityScore: { type: number, example: 0.95 }
 *                       createdAt: { type: string, format: date-time, example: "2026-08-21T12:00:00.000Z" }
 *                       paidAt: { type: string, format: date-time, nullable: true, example: null }
 *                 count: { type: integer, example: 1 }
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       500:
 *         description: Unexpected error while retrieving claims
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/claims", requireAuth, async (req, res, next) => {
  try {
    const ownerAddress = req.user.address;

    const pool = require("../db/pool");
    const query = `
      SELECT
        ic.id, ic.file_id, ic.owner_address, ic.claim_amount,
        ic.status, ic.created_at, ic.paid_at,
        IF.cid, IF.file_size, IF.availability_score
      FROM insurance_claims ic
      JOIN insured_files IF ON ic.file_id = IF.id
      WHERE ic.owner_address = $1
      ORDER BY ic.created_at DESC
    `;

    const result = await pool.query(query, [ownerAddress]);

    res.json({
      success: true,
      claims: result.rows.map((c) => ({
        id: c.id,
        fileId: c.file_id,
        cid: c.cid,
        claimAmount: c.claim_amount,
        status: c.status,
        availabilityScore: c.availability_score,
        createdAt: c.created_at,
        paidAt: c.paid_at,
      })),
      count: result.rows.length,
    });
  } catch (error) {
    logger.error({
      event: "get_claims_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/claims/{id}:
 *   get:
 *     summary: Get a specific insurance claim
 *     description: >
 *       Returns full claim details, including oracle proof and payout info. Note: if the claim
 *       ID does not exist, the underlying lookup throws a plain error which is handled by the
 *       generic error handler as a 500 response rather than a 404.
 *     tags: [Insurance]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Insurance claim ID
 *         example: 7
 *     responses:
 *       200:
 *         description: Claim details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 claim:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 7 }
 *                     fileId: { type: integer, example: 42 }
 *                     cid: { type: string, example: QmT8x1sVjnG6Kn6h8SbXZjZzZzYFq5J5rB6f8Q9Ekz9uVy }
 *                     claimAmount: { type: number, example: 500 }
 *                     status: { type: string, example: proof_submitted }
 *                     evidence: { type: object, nullable: true, example: null }
 *                     oracleProof: { type: string, nullable: true, example: "ipfs-proof-hash-abc123" }
 *                     oracleAddress: { type: string, nullable: true, example: GORACLEADDRXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX }
 *                     payoutTxHash: { type: string, nullable: true, example: null }
 *                     createdAt: { type: string, format: date-time, example: "2026-08-21T12:00:00.000Z" }
 *                     proofSubmittedAt: { type: string, format: date-time, nullable: true, example: "2026-08-21T13:00:00.000Z" }
 *                     paidAt: { type: string, format: date-time, nullable: true, example: null }
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       403:
 *         description: The claim exists but does not belong to the authenticated user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *             example:
 *               error: Forbidden
 *               message: You don't have permission to view this claim
 *       500:
 *         description: Claim not found, or an unexpected error occurred
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Claim 999 not found"
 */
router.get("/claims/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const ownerAddress = req.user.address;

    const claim = await slaMonitor.getInsuranceClaim(id);

    if (claim.owner_address !== ownerAddress) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You don't have permission to view this claim",
      });
    }

    res.json({
      success: true,
      claim: {
        id: claim.id,
        fileId: claim.file_id,
        cid: claim.cid,
        claimAmount: claim.claim_amount,
        status: claim.status,
        evidence: claim.evidence,
        oracleProof: claim.oracle_proof,
        oracleAddress: claim.oracle_address,
        payoutTxHash: claim.payout_tx_hash,
        createdAt: claim.created_at,
        proofSubmittedAt: claim.proof_submitted_at,
        paidAt: claim.paid_at,
      },
    });
  } catch (error) {
    logger.error({
      event: "get_claim_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/claims/{id}/submit-proof:
 *   post:
 *     summary: Submit oracle proof for a claim
 *     description: >
 *       Records proof (e.g. an availability-check attestation) against a claim and moves its
 *       status to `proof_submitted`. The authenticated caller's address is stored as the
 *       oracle address; the route does not verify the caller holds any special oracle role.
 *     tags: [Insurance]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Insurance claim ID
 *         example: 7
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - oracleProof
 *             properties:
 *               oracleProof:
 *                 type: string
 *                 description: Proof payload/hash attesting to the file's (un)availability
 *                 example: "ipfs-proof-hash-abc123"
 *     responses:
 *       200:
 *         description: Proof recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 claim:
 *                   type: object
 *                   properties:
 *                     id: { type: integer, example: 7 }
 *                     status: { type: string, example: proof_submitted }
 *                     oracleAddress: { type: string, example: GORACLEADDRXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX }
 *                     proofSubmittedAt: { type: string, format: date-time, example: "2026-08-21T13:00:00.000Z" }
 *       400:
 *         description: Missing `oracleProof`
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error: { type: string }
 *                 message: { type: string }
 *             example:
 *               error: Missing parameter
 *               message: oracleProof is required
 *       401:
 *         description: Missing or invalid authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Unauthorized
 *       500:
 *         description: Claim not found, or an unexpected error occurred
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Claim 999 not found"
 */
router.post("/claims/:id/submit-proof", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { oracleProof } = req.body;
    const oracleAddress = req.user.address;

    if (!oracleProof) {
      return res.status(400).json({
        error: "Missing parameter",
        message: "oracleProof is required",
      });
    }

    const claim = await slaMonitor.submitOracleProof(id, oracleProof, oracleAddress);

    logger.info({
      event: "oracle_proof_submitted_via_api",
      claimId: id,
      oracleAddress,
    });

    res.json({
      success: true,
      claim: {
        id: claim.id,
        status: claim.status,
        oracleAddress: claim.oracle_address,
        proofSubmittedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error({
      event: "proof_submission_failed",
      error: error.message,
    });
    next(error);
  }
});

/**
 * @swagger
 * /api/insurance/stats:
 *   get:
 *     summary: Get insurance program statistics
 *     description: Public, unauthenticated endpoint returning aggregate stats across all insured files and claims.
 *     tags: [Insurance]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 stats:
 *                   type: object
 *                   properties:
 *                     activeInsuredFiles: { type: integer, example: 128 }
 *                     pendingClaims: { type: integer, example: 3 }
 *                     approvedClaims: { type: integer, example: 12 }
 *                     totalPremiumsActive: { type: number, example: 640.5 }
 *                     totalPayoutsIssued: { type: number, example: 1500 }
 *                     systemAverageAvailability: { type: number, example: 0.998 }
 *       500:
 *         description: Unexpected error while retrieving statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get("/stats", async (req, res, next) => {
  try {
    const stats = await slaMonitor.getInsuranceStats();

    res.json({
      success: true,
      stats: {
        activeInsuredFiles: stats.activeFiles,
        pendingClaims: stats.pendingClaims,
        approvedClaims: stats.approvedClaims,
        totalPremiumsActive: stats.totalPremiums,
        totalPayoutsIssued: stats.totalPayouts,
        systemAverageAvailability: stats.avgAvailability,
      },
    });
  } catch (error) {
    logger.error({
      event: "stats_retrieval_failed",
      error: error.message,
    });
    next(error);
  }
});

module.exports = router;
