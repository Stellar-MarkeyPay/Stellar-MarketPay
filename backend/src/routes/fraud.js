"use strict";

const express = require("express");
const { verifyJWT, requireAdminRole } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  analyzeBidEvent,
  getJobFraudStats,
} = require("../services/fraudDetectionService");

const router = express.Router();
const fraudRateLimiter = createRateLimiter(60, 1);

router.post("/bids", fraudRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const result = await analyzeBidEvent({
      jobId: req.body.jobId,
      applicationId: req.body.applicationId,
      freelancerAddress: req.body.freelancerAddress,
      bidAmount: req.body.bidAmount,
      currency: req.body.currency,
      jobBudget: req.body.jobBudget,
      sourceIp: req.body.sourceIp,
      userAgent: req.body.userAgent,
    });

    res.status(result.flagged ? 201 : 200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/jobs/:jobId/stats", fraudRateLimiter, verifyJWT, requireAdminRole, async (req, res, next) => {
  try {
    const stats = getJobFraudStats(req.params.jobId);
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
