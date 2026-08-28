const express = require("express");
const router = express.Router();
const axios = require("axios");

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let contributorCache = { data: null, timestamp: 0 };

// Fetch top contributors from GitHub API
async function fetchGitHubContributors() {
  if (Date.now() - contributorCache.timestamp < CACHE_TTL && contributorCache.data) {
    return contributorCache.data;
  }

  try {
    const response = await axios.get(
      "https://api.github.com/repos/Emmy123222/Stellar-MarketPay-/contributors",
      {
        params: { per_page: 20, sort: "contributions" },
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
          : {},
      }
    );

    const contributors = response.data.map((c: any) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      profile_url: c.html_url,
      contributions: c.contributions,
      id: c.id,
    }));

    contributorCache = { data: contributors, timestamp: Date.now() };
    return contributors;
  } catch (error: any) {
    console.error("Error fetching GitHub contributors:", error.message);
    return contributorCache.data || [];
  }
}

/**
 * @swagger
 * /api/contributors:
 *   get:
 *     summary: List top GitHub contributors
 *     description: >
 *       Returns the top 20 contributors (by contribution count) to the
 *       Stellar-MarketPay GitHub repository. Results are cached in-memory for
 *       24 hours; on a cache miss the server calls the GitHub contributors
 *       API (authenticated with GITHUB_TOKEN if set) and repopulates the
 *       cache. If that call fails, the previously cached list (or an empty
 *       array if none exists yet) is returned instead of erroring.
 *     tags: [Contributors]
 *     responses:
 *       200:
 *         description: Contributors retrieved successfully (from cache or GitHub API)
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
 *                       login:
 *                         type: string
 *                         example: octocat
 *                       avatar_url:
 *                         type: string
 *                         example: https://avatars.githubusercontent.com/u/1?v=4
 *                       profile_url:
 *                         type: string
 *                         example: https://github.com/octocat
 *                       contributions:
 *                         type: integer
 *                         example: 128
 *                       id:
 *                         type: integer
 *                         example: 1
 *             example:
 *               success: true
 *               data:
 *                 - login: octocat
 *                   avatar_url: https://avatars.githubusercontent.com/u/1?v=4
 *                   profile_url: https://github.com/octocat
 *                   contributions: 128
 *                   id: 1
 *       500:
 *         description: Unexpected server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// GET /api/contributors
router.get("/", async (req: any, res: any, next: any) => {
  try {
    const contributors = await fetchGitHubContributors();
    res.json({ success: true, data: contributors });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/contributors/refresh:
 *   post:
 *     summary: Force-refresh the cached GitHub contributors list
 *     description: >
 *       Clears the in-memory 24-hour contributors cache and immediately
 *       re-fetches the list from the GitHub contributors API. The route name
 *       and comment suggest this is intended to be admin-only, but no
 *       authentication or authorization middleware (verifyJWT /
 *       requireAdminRole) is currently applied in code, so it is callable by
 *       any client.
 *     tags: [Contributors]
 *     responses:
 *       200:
 *         description: Cache refreshed and contributors returned
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
 *                       login:
 *                         type: string
 *                       avatar_url:
 *                         type: string
 *                       profile_url:
 *                         type: string
 *                       contributions:
 *                         type: integer
 *                       id:
 *                         type: integer
 *                 message:
 *                   type: string
 *                   example: Cache refreshed
 *             example:
 *               success: true
 *               data:
 *                 - login: octocat
 *                   avatar_url: https://avatars.githubusercontent.com/u/1?v=4
 *                   profile_url: https://github.com/octocat
 *                   contributions: 128
 *                   id: 1
 *               message: Cache refreshed
 *       500:
 *         description: Unexpected server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/contributors/refresh (admin only, refreshes cache)
router.post("/refresh", async (req: any, res: any, next: any) => {
  try {
    contributorCache = { data: null, timestamp: 0 };
    const contributors = await fetchGitHubContributors();
    res.json({ success: true, data: contributors, message: "Cache refreshed" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

export {};
