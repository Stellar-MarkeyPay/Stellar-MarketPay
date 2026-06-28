"use strict";

const crypto = require("crypto");
const axios = require("axios");

const VERIFICATION_PREFIX = "verified:";

/**
 * Build the on-chain proof hash for an oracle query.
 * Must match contracts/marketpay-contract/src/oracle.rs compute_verification_hash.
 *
 * @param {string} query
 * @returns {Buffer}
 */
function buildVerificationProof(query) {
  return crypto.createHash("sha256").update(`${VERIFICATION_PREFIX}${query}`).digest();
}

/**
 * Parse a GitHub oracle query.
 * Format: github:owner:repo:commit:<40-char-sha>
 *
 * @param {string} query
 * @returns {{ owner: string, repo: string, commitSha: string }}
 */
function parseGitHubQuery(query) {
  const parts = String(query || "").split(":");
  if (parts.length < 4 || parts[0] !== "github") {
    throw new Error("Invalid GitHub oracle query format");
  }

  const commitSha = parts[parts.length - 1];
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("GitHub oracle query must include a 40-character commit SHA");
  }

  return {
    owner: parts[1],
    repo: parts[2],
    commitSha: commitSha.toLowerCase(),
  };
}

/**
 * Parse a website status oracle query.
 * Format: website:<url>:status:<code>
 *
 * @param {string} query
 * @returns {{ url: string, statusCode: number }}
 */
function parseWebsiteQuery(query) {
  const parts = String(query || "").split(":");
  if (parts.length < 4 || parts[0] !== "website") {
    throw new Error("Invalid website oracle query format");
  }

  const statusCode = parseInt(parts[parts.length - 1], 10);
  const url = parts.slice(1, parts.length - 2).join(":");

  if (!url || Number.isNaN(statusCode)) {
    throw new Error("Website oracle query must include URL and status code");
  }

  return { url, statusCode };
}

/**
 * Verify that a GitHub commit exists for the configured query.
 *
 * @param {string} query
 * @param {import('axios').AxiosInstance} [httpClient]
 * @returns {Promise<Buffer>}
 */
async function verifyGitHubCommit(query, httpClient = axios) {
  const { owner, repo, commitSha } = parseGitHubQuery(query);
  const response = await httpClient.get(
    `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Stellar-MarketPay-Oracle",
      },
      validateStatus: (status) => status < 500,
    },
  );

  if (response.status !== 200) {
    throw new Error(`GitHub commit verification failed with status ${response.status}`);
  }

  const returnedSha = String(response.data?.sha || "").toLowerCase();
  if (!returnedSha.startsWith(commitSha)) {
    throw new Error("GitHub commit SHA mismatch");
  }

  return buildVerificationProof(query);
}

/**
 * Verify that a website responds with the expected status code.
 *
 * @param {string} query
 * @param {import('axios').AxiosInstance} [httpClient]
 * @returns {Promise<Buffer>}
 */
async function verifyWebsiteStatus(query, httpClient = axios) {
  const { url, statusCode } = parseWebsiteQuery(query);
  const response = await httpClient.get(url, {
    validateStatus: () => true,
    timeout: 10000,
  });

  if (response.status !== statusCode) {
    throw new Error(`Website status ${response.status} does not match expected ${statusCode}`);
  }

  return buildVerificationProof(query);
}

/**
 * Dispatch verification to the configured oracle type.
 *
 * @param {string|null|undefined} oracleType
 * @param {string} oracleQuery
 * @param {import('axios').AxiosInstance} [httpClient]
 * @returns {Promise<Buffer>}
 */
async function verifyOracleQuery(oracleType, oracleQuery, httpClient = axios) {
  const type = String(oracleType || "").toLowerCase();

  if (type === "github") {
    return verifyGitHubCommit(oracleQuery, httpClient);
  }
  if (type === "website" || type === "aws") {
    return verifyWebsiteStatus(oracleQuery, httpClient);
  }

  throw new Error(`Unsupported oracle type: ${oracleType || "unknown"}`);
}

module.exports = {
  buildVerificationProof,
  parseGitHubQuery,
  parseWebsiteQuery,
  verifyGitHubCommit,
  verifyWebsiteStatus,
  verifyOracleQuery,
};
