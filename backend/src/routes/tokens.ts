/**
 * src/routes/tokens.js
 * Stellar token routes for custom token support
 */
"use strict";
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");
const {
  getTokenMetadata,
  getTokenBalance,
  validateTokenContract,
  getPopularTokens,
  searchTokens,
} = require("../services/tokenService");

// Rate limiting: 30 requests per minute
const tokenRateLimiter = createRateLimiter(30, 1);

/**
 * @swagger
 * /api/tokens/popular:
 *   get:
 *     summary: Get list of popular tokens
 *     description: >
 *       Returns a static, curated list of popular Soroban token contracts
 *       (e.g. USDC, USDT) for suggestion UIs. Rate limited to 30 requests
 *       per minute per IP.
 *     tags: [Tokens]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: List of popular tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       contractId: { type: string }
 *                       name: { type: string, example: USDC }
 *                       symbol: { type: string, example: USDC }
 *                       decimals: { type: integer, example: 7 }
 *                       verified: { type: boolean, example: true }
 *                       icon: { type: string, nullable: true, example: "🪙" }
 *             example:
 *               success: true
 *               data:
 *                 - contractId: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *                   name: USDC
 *                   symbol: USDC
 *                   decimals: 7
 *                   verified: true
 *                   icon: "🪙"
 *                 - contractId: CA3D5SRYAEYKJVVBFJKW6S5U2YJ5E5BBHCNATIVXQDQSTZPFFR4XCWK
 *                   name: USDT
 *                   symbol: USDT
 *                   decimals: 7
 *                   verified: true
 *                   icon: "💵"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/popular", tokenRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const tokens = getPopularTokens();
    res.json({
      success: true,
      data: tokens,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/search:
 *   get:
 *     summary: Search for tokens by name or symbol
 *     description: >
 *       Searches the curated popular-tokens list for entries whose name or
 *       symbol contains the query (case-insensitive). Returns an empty
 *       array if the query is shorter than 2 characters. Rate limited to
 *       30 requests per minute per IP.
 *     tags: [Tokens]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema:
 *           type: string
 *         description: Search term to match against token name or symbol (matches shorter than 2 chars return no results)
 *         example: usd
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Matching tokens
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       contractId: { type: string }
 *                       name: { type: string, example: USDC }
 *                       symbol: { type: string, example: USDC }
 *                       decimals: { type: integer, example: 7 }
 *                       verified: { type: boolean, example: true }
 *                       icon: { type: string, nullable: true, example: "🪙" }
 *             example:
 *               success: true
 *               data:
 *                 - contractId: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *                   name: USDC
 *                   symbol: USDC
 *                   decimals: 7
 *                   verified: true
 *                   icon: "🪙"
 *       400:
 *         description: Search query (q) is missing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Search query is required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.get("/search", tokenRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({
        success: false,
        error: "Search query is required",
      });
    }

    const tokens = await searchTokens(q);
    res.json({
      success: true,
      data: tokens,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/{contractId}/metadata:
 *   get:
 *     summary: Get token metadata for a Soroban contract
 *     description: >
 *       Looks up basic metadata for a Stellar Asset Contract (SAC). This is
 *       a simplified implementation: it fetches the contract account and,
 *       if found, derives a placeholder name/symbol from the contract ID
 *       rather than reading real on-chain token metadata via Soroban RPC.
 *       Rate limited to 30 requests per minute per IP.
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar Asset Contract ID
 *         example: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Token metadata
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     contractId: { type: string }
 *                     name: { type: string, example: "Token CBAN4QGC..." }
 *                     symbol: { type: string, example: "TKNCBAN" }
 *                     decimals: { type: integer, example: 7 }
 *                     icon: { type: string, nullable: true }
 *                     verified: { type: boolean, example: false }
 *             example:
 *               success: true
 *               data:
 *                 contractId: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *                 name: "Token CBAN4QGC..."
 *                 symbol: "TKNCBAN"
 *                 decimals: 7
 *                 icon: null
 *                 verified: false
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Failed to fetch the contract account or derive metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Failed to fetch token metadata: Account not found"
 */
router.get("/:contractId/metadata", tokenRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { contractId } = req.params;

    const metadata = await getTokenMetadata(contractId);
    res.json({
      success: true,
      data: metadata,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * @swagger
 * /api/tokens/{contractId}/balance/{publicKey}:
 *   get:
 *     summary: Get token balance for a Stellar account
 *     description: >
 *       Looks up the account's balances and finds the entry whose
 *       `asset_issuer` matches the given contract ID. Returns
 *       `{ balance: "0", exists: false, limit: "0" }` if the account has
 *       no such balance line or could not be found (a 404 from the
 *       upstream Horizon/account lookup is treated as "no balance", not
 *       an error). Rate limited to 30 requests per minute per IP.
 *     tags: [Tokens]
 *     parameters:
 *       - in: path
 *         name: contractId
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar Asset Contract ID (matched against the balance's asset_issuer)
 *         example: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *         description: Stellar public key (G-address) of the account
 *         example: GAQZ2FBK2QT4C7GNTVJXQY4V6V32SHZ2JQVGZ2X5X5KY3XKPZ5N6HXFO
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     responses:
 *       200:
 *         description: Token balance for the account
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     balance: { type: string, example: "150.0000000" }
 *                     exists: { type: boolean, example: true }
 *                     limit: { type: string, example: "1000.0000000" }
 *             example:
 *               success: true
 *               data:
 *                 balance: "150.0000000"
 *                 exists: true
 *                 limit: "1000.0000000"
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 *       500:
 *         description: Failed to fetch the account's balances
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               error: "Failed to fetch token balance: Network error"
 */
router.get(
  "/:contractId/balance/:publicKey",
  tokenRateLimiter,
  async (req: any, res: any, next: any) => {
    try {
      const { contractId, publicKey } = req.params;

      const balance = await getTokenBalance(publicKey, contractId);
      res.json({
        success: true,
        data: balance,
      });
    } catch (e) {
      next(e);
    }
  }
);

/**
 * @swagger
 * /api/tokens/validate:
 *   post:
 *     summary: Validate whether a contract ID is a token contract
 *     description: >
 *       Validates the basic format of a Stellar contract ID (56 uppercase
 *       alphanumeric characters) and, if the format is valid, attempts to
 *       fetch the contract account to confirm it exists. This is a
 *       simplified check — it does not verify actual token-contract
 *       semantics. Rate limited to 30 requests per minute per IP.
 *     tags: [Tokens]
 *     x-rate-limit:
 *       limit: 30
 *       windowMinutes: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - contractId
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: Stellar contract ID to validate
 *           example:
 *             contractId: CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M
 *     responses:
 *       200:
 *         description: Validation result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     valid: { type: boolean }
 *                     error: { type: string, nullable: true }
 *             examples:
 *               valid:
 *                 value:
 *                   success: true
 *                   data:
 *                     valid: true
 *                     error: null
 *               invalidFormat:
 *                 value:
 *                   success: true
 *                   data:
 *                     valid: false
 *                     error: "Invalid contract ID format"
 *               notFound:
 *                 value:
 *                   success: true
 *                   data:
 *                     valid: false
 *                     error: "Contract not found or inaccessible"
 *       400:
 *         description: contractId is missing from the request body
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 error: { type: string }
 *             example:
 *               success: false
 *               error: Contract ID is required
 *       429:
 *         $ref: '#/components/responses/TooManyRequests'
 */
router.post("/validate", tokenRateLimiter, async (req: any, res: any, next: any) => {
  try {
    const { contractId } = req.body;

    if (!contractId) {
      return res.status(400).json({
        success: false,
        error: "Contract ID is required",
      });
    }

    const validation = await validateTokenContract(contractId);
    res.json({
      success: true,
      data: validation,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;

export {};
