"use strict";

const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const insightsService = require("../services/insightsService");

const insightsRateLimiter = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/insights/categories:
 *   get:
 *     summary: Get market insights by job category
 *     description: Returns aggregate stats per job category (total jobs, average budget, average applications per job, acceptance rate, count of low-competition jobs, and unique clients), plus overall client-mix stats (new vs. returning clients). Results are cached server-side for 24 hours per day/limit combination.
 *     tags: [Insights]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of categories to return (capped at 50)
 *         example: 10
 *     responses:
 *       200:
 *         description: Category insights retrieved successfully
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
 *                     categories:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           category:
 *                             type: string
 *                           totalJobs:
 *                             type: integer
 *                           avgBudget:
 *                             type: number
 *                           avgApplicationsPerJob:
 *                             type: number
 *                           acceptanceRate:
 *                             type: number
 *                             description: Percentage of applications that were accepted
 *                           lowCompetitionJobs:
 *                             type: integer
 *                             description: Number of jobs in this category with fewer than 5 applications
 *                           uniqueClients:
 *                             type: integer
 *                     clientMix:
 *                       type: object
 *                       properties:
 *                         newClients:
 *                           type: integer
 *                           description: Clients whose first job post was within the last 30 days
 *                         returningClients:
 *                           type: integer
 *                         totalClients:
 *                           type: integer
 *             example:
 *               success: true
 *               data:
 *                 categories:
 *                   - category: web-development
 *                     totalJobs: 128
 *                     avgBudget: 450.5
 *                     avgApplicationsPerJob: 6.4
 *                     acceptanceRate: 18.2
 *                     lowCompetitionJobs: 31
 *                     uniqueClients: 54
 *                 clientMix:
 *                   newClients: 12
 *                   returningClients: 88
 *                   totalClients: 100
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/categories", insightsRateLimiter, async (req, res, next) => {
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

/**
 * @swagger
 * /api/insights/skills:
 *   get:
 *     summary: Get market insights by skill
 *     description: Returns aggregate demand stats per skill tag used across job postings (how many jobs require it, average applications per job, and how many are low-competition), ordered by demand descending. Results are cached server-side for 24 hours per day/limit combination.
 *     tags: [Insights]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of skills to return (capped at 50)
 *         example: 10
 *     responses:
 *       200:
 *         description: Skill insights retrieved successfully
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
 *                       skill:
 *                         type: string
 *                       demandCount:
 *                         type: integer
 *                         description: Number of jobs requiring this skill
 *                       avgApplicationsPerJob:
 *                         type: number
 *                       lowCompetitionJobs:
 *                         type: integer
 *                         description: Number of jobs requiring this skill with fewer than 5 applications
 *             example:
 *               success: true
 *               data:
 *                 - skill: solidity
 *                   demandCount: 42
 *                   avgApplicationsPerJob: 3.1
 *                   lowCompetitionJobs: 19
 *                 - skill: react
 *                   demandCount: 97
 *                   avgApplicationsPerJob: 8.7
 *                   lowCompetitionJobs: 12
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/skills", insightsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const skills = await insightsService.getSkillInsights(limit);
    res.json({ success: true, data: skills });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/competitive:
 *   get:
 *     summary: Get low-competition open jobs
 *     description: Returns open jobs with fewer than 5 applications, ordered by fewest applications first (then highest budget, then newest), tagging each with a competitionLevel of "uncontested" (0 applications), "light" (1-2), or "active" (3-4). Results are cached server-side for 24 hours per day/limit combination.
 *     tags: [Insights]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           maximum: 50
 *           default: 20
 *         description: Maximum number of jobs to return (capped at 50)
 *         example: 10
 *     responses:
 *       200:
 *         description: Low-competition jobs retrieved successfully
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
 *                       title:
 *                         type: string
 *                       category:
 *                         type: string
 *                       budget:
 *                         type: number
 *                       currency:
 *                         type: string
 *                       clientAddress:
 *                         type: string
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                       applicationCount:
 *                         type: integer
 *                       competitionLevel:
 *                         type: string
 *                         enum: [uncontested, light, active]
 *             example:
 *               success: true
 *               data:
 *                 - id: 9c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f
 *                   title: Build a Soroban escrow contract
 *                   category: blockchain
 *                   budget: 450
 *                   currency: XLM
 *                   clientAddress: GCLIENT7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O
 *                   createdAt: "2026-08-18T12:00:00.000Z"
 *                   applicationCount: 1
 *                   competitionLevel: light
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/competitive", insightsRateLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const jobs = await insightsService.getCompetitiveJobs(limit);
    res.json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/insights/trends/pay:
 *   get:
 *     summary: Get daily pay trends by category
 *     description: Returns the average job budget and job count per day per category, for jobs created within the requested trailing window. Results are cached server-side for 24 hours per day/window combination.
 *     tags: [Insights]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           maximum: 90
 *           default: 30
 *         description: Size of the trailing window in days (capped at 90)
 *         example: 30
 *     responses:
 *       200:
 *         description: Pay trends retrieved successfully
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
 *                       date:
 *                         type: string
 *                         format: date
 *                       category:
 *                         type: string
 *                       avgBudget:
 *                         type: number
 *                       jobCount:
 *                         type: integer
 *             example:
 *               success: true
 *               data:
 *                 - date: "2026-08-15"
 *                   category: web-development
 *                   avgBudget: 380.5
 *                   jobCount: 6
 *                 - date: "2026-08-15"
 *                   category: blockchain
 *                   avgBudget: 620
 *                   jobCount: 3
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/trends/pay", insightsRateLimiter, async (req, res, next) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 30, 90);
    const trends = await insightsService.getPayTrends(days);
    res.json({ success: true, data: trends });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
