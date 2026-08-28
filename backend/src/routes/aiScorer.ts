const express = require("express");
const router = express.Router();
const axios = require("axios");
const { createRateLimiter } = require("../middleware/rateLimiter");

const scoringRateLimiter = createRateLimiter(20, 1); // 20 requests per minute

/**
 * @swagger
 * /api/ai-scorer/score-job-description:
 *   post:
 *     summary: Score a job description with Claude AI
 *     description: >
 *       Sends the job description to the Claude API (model claude-opus-4-7)
 *       for quality analysis and returns a 0-100 score, a breakdown by
 *       clarity/completeness/budget reasonableness/skill specificity,
 *       improvement suggestions, missing information, and strengths. If
 *       CLAUDE_API_KEY is not configured the request fails with 500. If the
 *       Claude call itself fails or its response can't be parsed as JSON,
 *       the handler does not error — it falls back to a canned score/
 *       suggestion payload and still responds 200.
 *     tags: [AIScorer]
 *     x-rate-limit:
 *       limit: 20
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *             properties:
 *               description:
 *                 type: string
 *                 description: The job description text to analyze
 *                 example: We need a Rust developer to build a Soroban smart contract for escrow payments. Budget is 500 XLM, 2 week timeline.
 *           example:
 *             description: We need a Rust developer to build a Soroban smart contract for escrow payments. Budget is 500 XLM, 2 week timeline.
 *     responses:
 *       200:
 *         description: >
 *           Score computed successfully. Also returned (with a generic
 *           fallback payload) when the Claude API call fails or its output
 *           cannot be parsed.
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
 *                     score:
 *                       type: number
 *                       example: 78
 *                     scoreBreakdown:
 *                       type: object
 *                       properties:
 *                         clarity:
 *                           type: number
 *                         completeness:
 *                           type: number
 *                         budgetReasonableness:
 *                           type: number
 *                         skillSpecificity:
 *                           type: number
 *                       example:
 *                         clarity: 80
 *                         completeness: 75
 *                         budgetReasonableness: 70
 *                         skillSpecificity: 85
 *                     suggestions:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["Add more specific project requirements", "Include budget information"]
 *                     missingInformation:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["Timeline", "Experience level required"]
 *                     strengths:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["Clear technical stack"]
 *             example:
 *               success: true
 *               data:
 *                 score: 78
 *                 scoreBreakdown:
 *                   clarity: 80
 *                   completeness: 75
 *                   budgetReasonableness: 70
 *                   skillSpecificity: 85
 *                 suggestions: ["Consider adding more specific skills required"]
 *                 missingInformation: ["Budget range"]
 *                 strengths: ["Clear technical stack"]
 *       400:
 *         description: Job description missing or empty
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Job description required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Claude API not configured (CLAUDE_API_KEY missing)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: Claude API not configured
 */
// Score job description using Claude API
router.post("/score-job-description", scoringRateLimiter, async (req: any, res: any) => {
  try {
    if (!process.env.CLAUDE_API_KEY) {
      return res.status(500).json({ error: "Claude API not configured" });
    }

    const { description } = req.body;
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: "Job description required" });
    }

    const analysisPrompt = `Analyze this job description and provide a quality score and specific suggestions for improvement.

Job Description:
"${description}"

Respond in JSON format:
{
  "score": <number 0-100>,
  "scoreBreakdown": {
    "clarity": <0-100>,
    "completeness": <0-100>,
    "budgetReasonableness": <0-100>,
    "skillSpecificity": <0-100>
  },
  "suggestions": [<array of specific improvement suggestions>],
  "missingInformation": [<array of missing details>],
  "strengths": [<array of what's good about the description>]
}`;

    // Call Claude API
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: analysisPrompt,
          },
        ],
      },
      {
        headers: {
          "x-api-key": process.env.CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      }
    );

    const content = response.data.content[0].text;
    let analysis;

    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      // Fallback if JSON parsing fails
      analysis = {
        score: 65,
        suggestions: ["Consider adding more specific skills required"],
        missingInformation: ["Budget range"],
      };
    }

    res.json({
      success: true,
      data: {
        score: analysis.score || 70,
        scoreBreakdown: analysis.scoreBreakdown || {},
        suggestions: analysis.suggestions || [],
        missingInformation: analysis.missingInformation || [],
        strengths: analysis.strengths || [],
      },
    });
  } catch (error) {
    // Fallback for API errors
    res.json({
      success: true,
      data: {
        score: 60,
        suggestions: ["Add more specific project requirements", "Include budget information"],
        missingInformation: ["Timeline", "Experience level required"],
      },
    });
  }
});

module.exports = router;

export {};
