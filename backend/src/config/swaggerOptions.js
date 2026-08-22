/**
 * src/config/swaggerOptions.js
 * Single source of truth for the swagger-jsdoc options used to build the
 * OpenAPI specification. Both the live Swagger UI (src/config/swagger.js)
 * and the CI spec generator (scripts/generate-openapi.js) build from this
 * same object so the published spec can never drift from what /api/docs
 * actually serves.
 */
"use strict";

const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Stellar MarketPay API",
      version: "1.0.0",
      description:
        "Backend API for Stellar MarketPay - A decentralized freelance marketplace built on Stellar blockchain.\n\n" +
        "## Authentication\n" +
        "Most write endpoints and admin routes require a JWT obtained via the SEP-10 Stellar " +
        "challenge-transaction flow: call `GET /api/auth?account=<publicKey>` to receive a challenge " +
        "transaction, sign it with the account's Stellar keypair, then call `POST /api/auth` with the " +
        "signed transaction to receive a JWT. Send the JWT as either an `Authorization: Bearer <token>` " +
        "header (`bearerAuth`) or a `jwt` httpOnly cookie (`cookieAuth`) on subsequent requests. " +
        "Admin-only routes additionally require the token's `role` claim to be `admin`, and some admin " +
        "routes require a verified TOTP second factor (`requireAdmin2FA`).\n\n" +
        "## Rate limiting\n" +
        "Every endpoint is rate-limited per client IP via `express-rate-limit`. Limits vary per endpoint " +
        "group (documented per-operation below as an `x-rate-limit` extension with `limit` and " +
        "`windowMinutes`). Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` " +
        "header and a `{ \"message\": string }` body — see the shared `TooManyRequests` response.",
      contact: {
        name: "Stellar MarketPay Team",
        email: "support@stellarmarketpay.com",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || "http://localhost:4000",
        description: "Development server",
      },
      {
        url: "https://api.stellarmarketpay.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "JWT issued by POST /api/auth after completing the SEP-10 Stellar challenge-transaction login flow. Send as `Authorization: Bearer <token>`.",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "jwt",
          description: "Same JWT as bearerAuth, sent as an httpOnly `jwt` cookie instead of a header.",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "string",
              description: "Error message",
            },
          },
        },
        Success: {
          type: "object",
          properties: {
            success: {
              type: "boolean",
              description: "Success status",
            },
            message: {
              type: "string",
              description: "Success message",
            },
          },
        },
        StellarAccount: {
          type: "object",
          properties: {
            publicKey: {
              type: "string",
              description: "Stellar public key",
              example: "GD5JQHFZLLM7H45AEB5S7M2E7EYQ3M3K5Y6R7B8C9D0E1F2G3H4I5J6K7L8M9N0O",
            },
          },
        },
        Job: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              description: "Job ID",
            },
            title: {
              type: "string",
              description: "Job title",
            },
            description: {
              type: "string",
              description: "Job description",
            },
            budget: {
              type: "number",
              description: "Job budget in XLM",
            },
            clientId: {
              type: "string",
              description: "Client Stellar address",
            },
            status: {
              type: "string",
              enum: ["open", "in_progress", "completed", "cancelled"],
              description: "Job status",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Creation timestamp",
            },
            expiresAt: {
              type: "string",
              format: "date-time",
              description: "Expiration timestamp",
            },
          },
        },
        GasFeeTier: {
          type: "object",
          properties: {
            feeStroops: {
              type: "string",
              description: "Fee in stroops (stringified, may exceed safe integer range)",
              example: "10000",
            },
            feeXlm: {
              type: "number",
              description: "Fee in XLM",
              example: 0.001,
            },
            label: {
              type: "string",
              example: "Fast",
            },
            description: {
              type: "string",
              example: "Recommended for time-sensitive transactions",
            },
            estimatedWaitLedgers: {
              type: "integer",
              example: 1,
            },
          },
        },
        GasEstimateResponse: {
          type: "object",
          properties: {
            slow: { $ref: "#/components/schemas/GasFeeTier" },
            medium: { $ref: "#/components/schemas/GasFeeTier" },
            fast: { $ref: "#/components/schemas/GasFeeTier" },
            spikeDetected: {
              type: "boolean",
              description: "Whether a sudden fee spike was detected in recent ledgers",
            },
            fetchedAt: {
              type: "string",
              format: "date-time",
            },
            cached: {
              type: "boolean",
              description: "Whether this response was served from the 15-second cache",
            },
          },
        },
        Application: {
          type: "object",
          properties: {
            id: {
              type: "string",
              format: "uuid",
              description: "Application ID",
            },
            jobId: {
              type: "string",
              format: "uuid",
              description: "Job ID",
            },
            freelancerId: {
              type: "string",
              description: "Freelancer Stellar address",
            },
            proposal: {
              type: "string",
              description: "Application proposal",
            },
            bidAmount: {
              type: "number",
              description: "Bid amount in XLM",
            },
            status: {
              type: "string",
              enum: ["pending", "accepted", "rejected"],
              description: "Application status",
            },
            createdAt: {
              type: "string",
              format: "date-time",
              description: "Creation timestamp",
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: "Unauthorized - missing, invalid, or expired authentication",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "Unauthorized: Missing or invalid token" },
            },
          },
        },
        Forbidden: {
          description: "Forbidden - authenticated but not permitted to perform this action",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
              example: { error: "Forbidden: Admin access required" },
            },
          },
        },
        TooManyRequests: {
          description: "Rate limit exceeded for this endpoint",
          headers: {
            "Retry-After": {
              description: "Seconds to wait before retrying",
              schema: { type: "integer" },
            },
          },
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  message: { type: "string" },
                },
              },
              example: { message: "Too many requests — please wait before trying again" },
            },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.js", "./src/server.js"],
};

module.exports = { swaggerOptions };
