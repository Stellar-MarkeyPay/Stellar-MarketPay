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
 * src/routes/disputes.js
 * Dispute evidence upload/retrieval with IPFS storage (Issue #223)
 *
 * GET  /api/disputes/:jobId          — dispute detail + evidence list
 * POST /api/disputes/:jobId/evidence — upload one evidence file (multipart/form-data)
 *
 * Constraints:
 *   - Max 10 files per party (client or freelancer)
 *   - Max 5 MB per file
 *   - Allowed MIME types: images, PDF, plain text
 *   - Only job client or freelancer can upload; anyone can read (admin visibility)
 */
("use strict");

const express = require("express");
const router = express.Router();
const multer = require("multer");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");
const ipfsService = require("../services/ipfsService");
const { validateIpfsCid } = require("../services/disputeService");

const MAX_FILES_PER_PARTY = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) cb(null, true);
    else cb(Object.assign(new Error(`File type ${file.mimetype} is not allowed`), { status: 400 }));
  },
});

const readRateLimiter = createRateLimiter(30, 1);
const uploadRateLimiter = createRateLimiter(5, 1);

// GET /api/disputes/:jobId
router.get("/:jobId", readRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { jobId } = req.params;

    const { rows: jobRows } = await rawQuery<JobTable>(
      `SELECT id, title, status, client_address, freelancer_address, created_at
       FROM jobs WHERE id = $1`,
      [jobId]
    );

    if (!jobRows.length) {
      const e = new Error("Job not found");
      e.status = 404;
      throw e;
    }

    const { rows: evidence } = await rawQuery<DisputeEvidenceTable>(
      `SELECT id, uploader_address, file_name, file_size, mime_type, ipfs_cid, created_at
       FROM dispute_evidence
       WHERE job_id = $1
       ORDER BY created_at ASC`,
      [jobId]
    );

    res.json({
      success: true,
      data: {
        job: jobRows[0],
        evidence: evidence.map((ev: any) => ({
          id: ev.id,
          uploaderAddress: ev.uploader_address,
          fileName: ev.file_name,
          fileSize: ev.file_size,
          mimeType: ev.mime_type,
          ipfsCid: ev.ipfs_cid,
          gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
          createdAt: ev.created_at,
        })),
      },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/disputes/{jobId}/evidence:
 *   post:
 *     summary: Upload one dispute evidence file
 *     description: >
 *       Uploads a single evidence file (multipart/form-data, field name
 *       `file`) for a job's dispute. Only the job's client or freelancer
 *       (identified by the authenticated JWT's `publicKey`) may upload.
 *       Enforces a maximum of 10 files per party per job and rejects any
 *       MIME type other than image/jpeg, image/png, image/gif, image/webp,
 *       application/pdf, or text/plain. On success, the file is pinned to
 *       IPFS via Pinata and a `dispute_evidence` row is inserted recording
 *       the returned CID. Note: the 5 MB per-file size limit is enforced by
 *       multer's `limits.fileSize`, which throws a `MulterError` with no
 *       `status`/`statusCode` property — the global error handler therefore
 *       returns 500 (not 400) for oversized files, unlike the MIME-type
 *       check, which explicitly sets `status: 400`.
 *     tags: [Disputes]
 *     x-rate-limit:
 *       limit: 5
 *       windowMinutes: 1
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *         example: "3fa85f64-5717-4562-b3fc-2c963f66afa6"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: >
 *                   Evidence file, max 5 MB. Allowed types: image/jpeg,
 *                   image/png, image/gif, image/webp, application/pdf,
 *                   text/plain.
 *     responses:
 *       201:
 *         description: Evidence uploaded and pinned to IPFS successfully
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
 *                       format: uuid
 *                     uploaderAddress:
 *                       type: string
 *                     fileName:
 *                       type: string
 *                     fileSize:
 *                       type: integer
 *                       description: File size in bytes
 *                     mimeType:
 *                       type: string
 *                     ipfsCid:
 *                       type: string
 *                     gatewayUrl:
 *                       type: string
 *                       description: Public Pinata IPFS gateway URL for the file
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: "1b2c3d4e-5f60-4718-9293-a4b5c6d7e8f9"
 *                 uploaderAddress: "GCLIENT2345EFGH6789IJKL0123MNOP4567QRST8901UVWX2345YZAB6789C"
 *                 fileName: "screenshot.png"
 *                 fileSize: 204800
 *                 mimeType: image/png
 *                 ipfsCid: "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
 *                 gatewayUrl: "https://gateway.pinata.cloud/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
 *                 createdAt: "2026-08-21T00:00:00.000Z"
 *       400:
 *         description: No file provided, disallowed MIME type, or the party's 10-file evidence limit has been reached
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Maximum 10 files allowed per party"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Authenticated user is neither the job's client nor freelancer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Only the client or freelancer can upload evidence
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: The IPFS pinning service returned a CID that failed local format validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Invalid IPFS CID returned from upload service
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       503:
 *         description: The IPFS/Pinata upload service is unavailable, misconfigured, or rate-limited
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Upload service temporarily unavailable. Please try again later.
 */
router.post(
  "/:jobId/evidence",
  verifyJWT,
  uploadRateLimiter,
  upload.single("file"),
  async (req: any, res: any, next: any) => {
    try {
      const { jobId } = req.params;
      const uploaderAddress = req.user.publicKey;

      if (!req.file) {
        const e = new Error("No file provided");
        e.status = 400;
        throw e;
      }

      const { rows: jobRows } = await rawQuery<JobTable>(
        "SELECT client_address, freelancer_address, status FROM jobs WHERE id = $1",
        [jobId]
      );

      if (!jobRows.length) {
        const e = new Error("Job not found");
        e.status = 404;
        throw e;
      }

      const job = jobRows[0];
      if (job.client_address !== uploaderAddress && job.freelancer_address !== uploaderAddress) {
        const e = new Error("Only the client or freelancer can upload evidence");
        e.status = 403;
        throw e;
      }

      const { rows: countRows } = await rawQuery<DisputeEvidenceTable>(
        "SELECT COUNT(*) FROM dispute_evidence WHERE job_id = $1 AND uploader_address = $2",
        [jobId, uploaderAddress]
      );

      if (parseInt(countRows[0].count, 10) >= MAX_FILES_PER_PARTY) {
        const e = new Error(`Maximum ${MAX_FILES_PER_PARTY} files allowed per party`);
        e.status = 400;
        throw e;
      }

      let ipfsResult;
      try {
        ipfsResult = await ipfsService.uploadFile(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype
        );
      } catch (ipfsError: any) {
        // Return user-friendly error for IPFS failures
        const e = new Error(
          ipfsError.message || "Upload service temporarily unavailable. Please try again later."
        );
        e.status = ipfsError.status || 503;
        e.code = ipfsError.code || "IPFS_UPLOAD_FAILED";
        throw e;
      }

      const ipfsCid = validateIpfsCid(ipfsResult?.cid);

      const { rows } = await rawQuery<DisputeEvidenceTable>(
        `INSERT INTO dispute_evidence
           (job_id, uploader_address, file_name, file_size, mime_type, ipfs_cid)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [jobId, uploaderAddress, req.file.originalname, req.file.size, req.file.mimetype, ipfsCid]
      );

      const ev = rows[0];
      res.status(201).json({
        success: true,
        data: {
          id: ev.id,
          uploaderAddress: ev.uploader_address,
          fileName: ev.file_name,
          fileSize: ev.file_size,
          mimeType: ev.mime_type,
          ipfsCid: ev.ipfs_cid,
          gatewayUrl: ipfsService.getGatewayUrl(ev.ipfs_cid),
          createdAt: ev.created_at,
        },
      });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
