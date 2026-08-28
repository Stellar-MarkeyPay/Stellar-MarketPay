"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const insightsService = require("../services/insightsService");

const insightsRateLimiter = createRateLimiter(30, 1);

router.get("/categories", insightsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const [categories, clientMix] = await Promise.all([
      insightsService.getCategoryInsights(limit),
      insightsService.getClientMix(),
    ]);

    res.json({
      success: true,
      data: {
        categories,
        clientMix,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/skills", insightsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skills = await insightsService.getSkillInsights(limit);
    res.json({ success: true, data: skills });
  } catch (error) {
    next(error);
  }
});

router.get("/competitive", insightsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const jobs = await insightsService.getCompetitiveJobs(limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

router.get("/trends/pay", insightsRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const trends = await insightsService.getPayTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

export {};
