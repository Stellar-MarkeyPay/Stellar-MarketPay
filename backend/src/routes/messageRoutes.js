/**
 * src/routes/messageRoutes.js
 * Private messaging endpoints for job participants.
 */

"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const { verifyJWT } = require("../middleware/auth");

const messageService = require("../services/messageService");
const generalRateLimiter = createRateLimiter(60, 1); // 60 req/min for message operations

/**
 * @swagger
 * /api/messages/job/{jobId}:
 *   post:
 *     summary: Send a message in a job thread
 *     description: >
 *       Sends a message between the two participants (client and
 *       freelancer) of a job. The caller must be a participant in the
 *       job, and the job must currently be `in_progress`. The message is
 *       uploaded to IPFS (best-effort — if the upload fails, the message
 *       is still stored off-chain) and persisted, and a notification is
 *       sent to the other participant. `contractTxHash`, if provided, is
 *       the Soroban transaction hash for the on-chain `publish_message`
 *       event and is stored alongside the message.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the job thread to send the message in
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Message text (trimmed; must be non-empty and at most 2000 characters)
 *                 example: Hi, I've pushed the first milestone — could you take a look?
 *               contractTxHash:
 *                 type: string
 *                 nullable: true
 *                 description: Soroban transaction hash for the on-chain publish_message event, if already submitted
 *                 example: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *           example:
 *             content: Hi, I've pushed the first milestone — could you take a look?
 *             contractTxHash: null
 *     responses:
 *       201:
 *         description: Message sent successfully
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
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     senderAddress:
 *                       type: string
 *                     receiverAddress:
 *                       type: string
 *                     content:
 *                       type: string
 *                     ipfsCid:
 *                       type: string
 *                       nullable: true
 *                       description: IPFS content ID, or null if the IPFS upload failed
 *                     txHash:
 *                       type: string
 *                       nullable: true
 *                     read:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *                 jobId: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 senderAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 receiverAddress: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 content: Hi, I've pushed the first milestone — could you take a look?
 *                 ipfsCid: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                 txHash: null
 *                 read: false
 *                 createdAt: "2026-08-21T09:00:00.000Z"
 *       400:
 *         description: >
 *           Message content is missing/invalid, or the job has no assigned
 *           freelancer to receive the message. Requests rejected by the
 *           route itself use the `{ success: false, error }` envelope;
 *           requests rejected deeper in message validation are surfaced
 *           by the shared error handler as `{ error }`.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *               required:
 *                 - error
 *             examples:
 *               missingContent:
 *                 summary: content missing or not a string
 *                 value:
 *                   success: false
 *                   error: Message content is required
 *               emptyContent:
 *                 summary: content is empty after trimming
 *                 value:
 *                   error: Message cannot be empty
 *               tooLong:
 *                 summary: content exceeds 2000 characters
 *                 value:
 *                   error: Message exceeds maximum length of 2000 characters
 *               noFreelancer:
 *                 summary: job has no assigned freelancer
 *                 value:
 *                   error: "Cannot send message: job has no assigned freelancer"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not a participant in the job, or the job is not in_progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               notParticipant:
 *                 summary: Caller is neither the client nor the freelancer
 *                 value:
 *                   error: "Unauthorized: You are not a participant in this job"
 *               notInProgress:
 *                 summary: Job status is not in_progress
 *                 value:
 *                   error: Messaging is only allowed for in-progress jobs
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// ─── POST /api/messages/job/:jobId ───────────────────────────────────────────
// Send a message in a job thread.
// Requires authentication. User must be job participant.
router.post("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { content, contractTxHash } = req.body;
    const senderAddress = req.user.publicKey;

    if (!content || typeof content !== "string") {
      return res.status(400).json({ success: false, error: "Message content is required" });
    }

    const message = await messageService.createMessage({
      jobId,
      senderAddress,
      content: content.trim(),
      contractTxHash: contractTxHash || null,
    });

    res.status(201).json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/job/{jobId}:
 *   get:
 *     summary: Get all messages for a job thread
 *     description: >
 *       Returns every message for the job, oldest first. The caller must
 *       be a participant in the job, and the job must currently be
 *       `in_progress`. As a side effect, any unread messages addressed
 *       to the caller in this job are marked as read.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the job thread to fetch messages for
 *         example: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *     responses:
 *       200:
 *         description: Messages retrieved successfully
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
 *                       jobId:
 *                         type: string
 *                         format: uuid
 *                       senderAddress:
 *                         type: string
 *                       receiverAddress:
 *                         type: string
 *                       content:
 *                         type: string
 *                       ipfsCid:
 *                         type: string
 *                         nullable: true
 *                       txHash:
 *                         type: string
 *                         nullable: true
 *                       read:
 *                         type: boolean
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *             example:
 *               success: true
 *               data:
 *                 - id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *                   jobId: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                   senderAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                   receiverAddress: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   content: Hi, I've pushed the first milestone — could you take a look?
 *                   ipfsCid: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                   txHash: null
 *                   read: true
 *                   createdAt: "2026-08-21T09:00:00.000Z"
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         description: Caller is not a participant in the job, or the job is not in_progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             examples:
 *               notParticipant:
 *                 summary: Caller is neither the client nor the freelancer
 *                 value:
 *                   error: "Unauthorized: You are not a participant in this job"
 *               notInProgress:
 *                 summary: Job status is not in_progress
 *                 value:
 *                   error: Messaging is only allowed for in-progress jobs
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// ─── GET /api/messages/job/:jobId ────────────────────────────────────────────
// Retrieve all messages for a job.
// Requires authentication. User must be job participant.
// Marks messages as read for the requesting user.
router.get("/job/:jobId", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const userAddress = req.user.publicKey;

    const messages = await messageService.getMessagesByJob(jobId, userAddress);
    res.json({ success: true, data: messages });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/unread-count:
 *   get:
 *     summary: Get the authenticated user's total unread message count
 *     description: >
 *       Returns the number of messages across all of the caller's jobs
 *       where the caller is the receiver and the message is unread.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Unread count retrieved successfully
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
 *                     unreadCount:
 *                       type: integer
 *                       example: 3
 *             example:
 *               success: true
 *               data:
 *                 unreadCount: 3
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// ─── GET /api/messages/unread-count ─────────────────────────────────────────
// Get total unread message count for the authenticated user.
router.get("/unread-count", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const userAddress = req.user.publicKey;
    const count = await messageService.getUnreadCount(userAddress);
    res.json({ success: true, data: { unreadCount: count } });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/messages/{messageId}/tx-hash:
 *   patch:
 *     summary: Attach an on-chain transaction hash to a message
 *     description: >
 *       Attaches a Soroban transaction hash to an existing message record.
 *       This is called after the frontend signs and submits the
 *       `publish_message` event on-chain, to link the off-chain message
 *       row to its on-chain notarization. Does not verify that the
 *       caller is a participant in the message's job.
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *       - cookieAuth: []
 *     x-rate-limit:
 *       limit: 60
 *       windowMinutes: 1
 *     parameters:
 *       - in: path
 *         name: messageId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: ID of the message to attach the transaction hash to
 *         example: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - txHash
 *             properties:
 *               txHash:
 *                 type: string
 *                 description: Soroban transaction hash for the publish_message event
 *                 example: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *           example:
 *             txHash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *     responses:
 *       200:
 *         description: Transaction hash attached successfully
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
 *                     jobId:
 *                       type: string
 *                       format: uuid
 *                     senderAddress:
 *                       type: string
 *                     receiverAddress:
 *                       type: string
 *                     content:
 *                       type: string
 *                     ipfsCid:
 *                       type: string
 *                       nullable: true
 *                     txHash:
 *                       type: string
 *                     read:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *             example:
 *               success: true
 *               data:
 *                 id: 7c9e6679-7425-40de-944b-e07fc1f90ae7
 *                 jobId: 3fa85f64-5717-4562-b3fc-2c963f66afa6
 *                 senderAddress: GHC32XMNS2BSHPFEKC252L4NRKBL2TGRE7ZWNXA3HV5FKBPMO3WVPDBX
 *                 receiverAddress: GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                 content: Hi, I've pushed the first milestone — could you take a look?
 *                 ipfsCid: bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi
 *                 txHash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
 *                 read: false
 *                 createdAt: "2026-08-21T09:00:00.000Z"
 *       400:
 *         description: txHash is missing or not a string
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
 *               error: txHash is required
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: No message exists with the given ID
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Message not found
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
// ─── PATCH /api/messages/:messageId/tx-hash ──────────────────────────────────
// Attach an on-chain Soroban transaction hash to a message record.
// This is called after the frontend signs and submits the publish_message event.
router.patch("/:messageId/tx-hash", verifyJWT, generalRateLimiter, async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { txHash } = req.body;

    if (!txHash || typeof txHash !== "string") {
      return res.status(400).json({ success: false, error: "txHash is required" });
    }

    const message = await messageService.attachTxHash(messageId, txHash);
    res.json({ success: true, data: message });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
