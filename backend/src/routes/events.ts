"use strict";

const express = require("express");
const router = express.Router();

/**
 * @swagger
 * /api/events/{jobId}:
 *   get:
 *     summary: Get indexed contract events for a job
 *     description: >
 *       Returns every Soroban contract event recorded for the given job, in chronological order
 *       (oldest first), as read from the `contract_events` table by the in-process indexer
 *       service. Returns 500 if the indexer service has not been attached to the app, or if the
 *       underlying query fails.
 *     tags: [Events]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID to fetch contract events for
 *         example: "3f1b2c4d-5678-90ab-cdef-1234567890ab"
 *     responses:
 *       200:
 *         description: Contract events retrieved (may be an empty array)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string, format: uuid, example: "8f14e45f-ceea-467e-bd7c-0d7d1c1c1c1c" }
 *                   job_id: { type: string, example: "3f1b2c4d-5678-90ab-cdef-1234567890ab" }
 *                   event_type: { type: string, example: escrow_created }
 *                   contract_id: { type: string, nullable: true, example: CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ }
 *                   tx_hash: { type: string, nullable: true, example: "a1b2c3d4e5f6" }
 *                   ledger: { type: integer, nullable: true, example: 12345678 }
 *                   data: { type: object, example: { amount: "500.0000000", asset: "XLM" } }
 *                   created_at: { type: string, format: date-time, example: "2026-08-21T12:00:00.000Z" }
 *       500:
 *         description: The indexer service is not available on this instance, or the query failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Indexer service not available
 */
router.get("/:jobId", async (req: any, res: any) => {
  try {
    const { jobId } = req.params;
    const indexerService = req.app.locals.indexerService;

    if (!indexerService) {
      return res.status(500).json({ error: "Indexer service not available" });
    }

    const events = await indexerService.getEventsForJob(jobId);
    res.json(events);
  } catch (error: any) {
    console.error("[Events Route] error:", error.message);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

module.exports = router;

export {};
