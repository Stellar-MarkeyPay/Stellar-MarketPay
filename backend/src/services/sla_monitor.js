/**
 * backend/src/services/sla_monitor.js
 * SLA Monitoring Service for Decentralized Storage Insurance
 * Monitors file availability on IPFS/Arweave and manages insurance claims
 */
"use strict";

const axios = require("axios");
const pool = require("../db/pool");
const { createServiceLogger } = require("../utils/logger");

const logger = createServiceLogger("sla_monitor");

// Configuration
const PINATA_API_URL = process.env.PINATA_API_URL || "https://api.pinata.cloud";
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

// SLA Configuration
const SLA_CONFIG = {
  // Insurance premiums as percentage of file value
  PREMIUM_PERCENT: 0.02, // 2% of file value
  // Maximum payout
  MAX_PAYOUT_PERCENT: 1.0, // 100% of file value
  // File availability threshold
  AVAILABILITY_THRESHOLD: 0.99, // 99% availability required
  // Check interval (milliseconds)
  CHECK_INTERVAL: 3600000, // 1 hour
  // Maximum file size that can be insured (MB)
  MAX_INSURABLE_SIZE: 100,
  // Claim waiting period before payout (hours)
  CLAIM_WAIT_PERIOD: 24,
  // Time to retry failed availability checks (minutes)
  RETRY_INTERVAL: 30,
};

/**
 * Get current SLA configuration
 */
function getConfig() {
  return { ...SLA_CONFIG };
}

/**
 * Calculate insurance premium for a file
 * @param {number} fileSize - File size in MB
 * @param {number} fileValue - File value in XLM
 * @returns {number} Premium amount in XLM
 */
function calculatePremium(fileSize, fileValue) {
  // Premium scales with file size
  const sizeMultiplier = Math.min(fileSize / 10, 2); // Cap at 2x for files >10MB
  const premium = fileValue * SLA_CONFIG.PREMIUM_PERCENT * sizeMultiplier;
  return Math.round(premium * 1000000) / 1000000; // 6 decimal places
}

/**
 * Create an insured file record
 * @param {string} cid - Content identifier
 * @param {string} ownerAddress - File owner's stellar address
 * @param {number} fileSize - File size in MB
 * @param {number} fileValue - File value in XLM
 * @param {string} storage - Storage type: 'ipfs' or 'arweave'
 * @returns {Promise<Object>} Insured file record
 */
async function createInsuredFile(cid, ownerAddress, fileSize, fileValue, storage = "ipfs") {
  if (!cid || !ownerAddress || fileSize <= 0 || fileValue <= 0) {
    throw new Error("Invalid parameters for insured file creation");
  }

  if (fileSize > SLA_CONFIG.MAX_INSURABLE_SIZE) {
    throw new Error(
      `File size exceeds maximum insurable size of ${SLA_CONFIG.MAX_INSURABLE_SIZE}MB`
    );
  }

  const premium = calculatePremium(fileSize, fileValue);
  const createdAt = new Date().toISOString();

  const query = `
    INSERT INTO insured_files (
      cid, owner_address, file_size, file_value, premium,
      storage_type, status, availability_score,
      last_checked, checks_total, checks_passed,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING id, cid, owner_address, file_size, file_value, premium,
              status, availability_score, created_at
  `;

  const params = [
    cid,
    ownerAddress,
    fileSize,
    fileValue,
    premium,
    storage,
    "active",
    1.0, // Initial availability score
    null,
    0,
    0,
    createdAt,
    createdAt,
  ];

  const result = await pool.query(query, params);

  if (result.rows.length === 0) {
    throw new Error("Failed to create insured file record");
  }

  logger.info({
    event: "insured_file_created",
    cid,
    ownerAddress,
    premium,
    storage,
  });

  return result.rows[0];
}

/**
 * Check file availability on IPFS
 * @param {string} cid - Content identifier
 * @returns {Promise<boolean>} True if file is available
 */
async function checkIPFSAvailability(cid) {
  try {
    if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
      logger.warn({ event: "pinata_not_configured", cid });
      return false;
    }

    const response = await axios.get(`${PINATA_API_URL}/data/pinQuery?hashContains=${cid}`, {
      headers: {
        pinata_api_key: PINATA_API_KEY,
        pinata_secret_api_key: PINATA_SECRET_KEY,
      },
      timeout: 5000,
    });

    const isPinned = response.data && response.data.count > 0;

    if (isPinned) {
      logger.debug({ event: "ipfs_file_found", cid });
    } else {
      logger.warn({ event: "ipfs_file_not_found", cid });
    }

    return isPinned;
  } catch (error) {
    logger.error({
      event: "ipfs_availability_check_failed",
      cid,
      error: error.message,
    });
    return false;
  }
}

/**
 * Check file availability on Arweave
 * @param {string} txId - Arweave transaction ID
 * @returns {Promise<boolean>} True if file is available
 */
async function checkArweaveAvailability(txId) {
  try {
    const response = await axios.head(`https://arweave.net/${txId}`, {
      timeout: 5000,
    });

    const isAvailable = response.status === 200;

    if (isAvailable) {
      logger.debug({ event: "arweave_file_found", txId });
    } else {
      logger.warn({ event: "arweave_file_not_found", txId });
    }

    return isAvailable;
  } catch (error) {
    logger.error({
      event: "arweave_availability_check_failed",
      txId,
      error: error.message,
    });
    return false;
  }
}

/**
 * Update availability metrics for a file
 * @param {number} fileId - Insured file ID
 * @param {boolean} isAvailable - Whether file is currently available
 * @returns {Promise<Object>} Updated availability metrics
 */
async function updateAvailabilityMetrics(fileId, isAvailable) {
  const query = `
    UPDATE insured_files
    SET
      checks_total = checks_total + 1,
      checks_passed = checks_passed + $1,
      availability_score = (checks_passed + $1)::float / (checks_total + 1),
      last_checked = NOW(),
      updated_at = NOW()
    WHERE id = $2
    RETURNING id, checks_total, checks_passed, availability_score
  `;

  const result = await pool.query(query, [isAvailable ? 1 : 0, fileId]);

  if (result.rows.length === 0) {
    throw new Error(`File ${fileId} not found`);
  }

  const metrics = result.rows[0];

  // Check if availability dropped below threshold
  if (metrics.availability_score < SLA_CONFIG.AVAILABILITY_THRESHOLD) {
    logger.warn({
      event: "sla_violation_detected",
      fileId,
      availabilityScore: metrics.availability_score,
    });

    // Auto-trigger insurance claim evaluation
    await evaluateInsuranceClaim(fileId);
  }

  return metrics;
}

/**
 * Perform availability check for a file
 * @param {number} fileId - Insured file ID
 * @returns {Promise<Object>} Check result
 */
async function performAvailabilityCheck(fileId) {
  try {
    // Get file details
    const fileQuery = "SELECT * FROM insured_files WHERE id = $1";
    const fileResult = await pool.query(fileQuery, [fileId]);

    if (fileResult.rows.length === 0) {
      throw new Error(`File ${fileId} not found`);
    }

    const file = fileResult.rows[0];

    // Check availability based on storage type
    let isAvailable;
    if (file.storage_type === "arweave") {
      isAvailable = await checkArweaveAvailability(file.cid);
    } else {
      isAvailable = await checkIPFSAvailability(file.cid);
    }

    // Update metrics
    const metrics = await updateAvailabilityMetrics(fileId, isAvailable);

    logger.info({
      event: "availability_check_complete",
      fileId,
      cid: file.cid,
      isAvailable,
      availabilityScore: metrics.availability_score,
    });

    return {
      fileId,
      cid: file.cid,
      isAvailable,
      metrics,
    };
  } catch (error) {
    logger.error({
      event: "availability_check_error",
      fileId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Evaluate insurance claim eligibility
 * @param {number} fileId - Insured file ID
 * @returns {Promise<Object|null>} Claim if eligible, null otherwise
 */
async function evaluateInsuranceClaim(fileId) {
  try {
    const fileQuery = "SELECT * FROM insured_files WHERE id = $1";
    const fileResult = await pool.query(fileQuery, [fileId]);

    if (fileResult.rows.length === 0) {
      throw new Error(`File ${fileId} not found`);
    }

    const file = fileResult.rows[0];

    // Check if file meets SLA violation criteria
    if (file.availability_score >= SLA_CONFIG.AVAILABILITY_THRESHOLD) {
      logger.info({
        event: "sla_claim_not_eligible",
        fileId,
        reason: "availability_above_threshold",
      });
      return null;
    }

    // Check if claim already exists
    const existingClaimQuery = `
      SELECT id FROM insurance_claims
      WHERE file_id = $1 AND status != 'rejected'
      LIMIT 1
    `;

    const existingClaim = await pool.query(existingClaimQuery, [fileId]);
    if (existingClaim.rows.length > 0) {
      logger.info({
        event: "sla_claim_already_exists",
        fileId,
      });
      return existingClaim.rows[0];
    }

    // Create insurance claim
    const claimQuery = `
      INSERT INTO insurance_claims (
        file_id, owner_address, claim_amount,
        status, evidence, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING id, file_id, owner_address, claim_amount, status, created_at
    `;

    const claimAmount = file.file_value * SLA_CONFIG.MAX_PAYOUT_PERCENT;
    const evidence = {
      availabilityScore: file.availability_score,
      checksTotal: file.checks_total,
      checksPassed: file.checks_passed,
      lastChecked: file.last_checked,
    };

    const claimResult = await pool.query(claimQuery, [
      fileId,
      file.owner_address,
      claimAmount,
      "pending",
      JSON.stringify(evidence),
    ]);

    const claim = claimResult.rows[0];

    logger.info({
      event: "insurance_claim_created",
      claimId: claim.id,
      fileId,
      claimAmount,
    });

    return claim;
  } catch (error) {
    logger.error({
      event: "claim_evaluation_error",
      fileId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Submit oracle proof for a claim
 * @param {number} claimId - Insurance claim ID
 * @param {string} oracleProof - Oracle proof data (JSON)
 * @param {string} oracleAddress - Oracle's Stellar address
 * @returns {Promise<Object>} Updated claim with proof
 */
async function submitOracleProof(claimId, oracleProof, oracleAddress) {
  try {
    const query = `
      UPDATE insurance_claims
      SET
        oracle_proof = $1,
        oracle_address = $2,
        proof_submitted_at = NOW(),
        status = 'proof_submitted',
        updated_at = NOW()
      WHERE id = $3
      RETURNING id, file_id, owner_address, claim_amount, status, oracle_address
    `;

    const result = await pool.query(query, [oracleProof, oracleAddress, claimId]);

    if (result.rows.length === 0) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const claim = result.rows[0];

    logger.info({
      event: "oracle_proof_submitted",
      claimId,
      oracleAddress,
    });

    return claim;
  } catch (error) {
    logger.error({
      event: "oracle_proof_submission_error",
      claimId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Approve and pay out insurance claim
 * @param {number} claimId - Insurance claim ID
 * @param {string} txHash - Blockchain transaction hash of payout
 * @returns {Promise<Object>} Paid claim
 */
async function approveInsuranceClaim(claimId, txHash) {
  try {
    const query = `
      UPDATE insurance_claims
      SET
        status = 'approved',
        payout_tx_hash = $1,
        paid_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
      RETURNING id, file_id, owner_address, claim_amount, status, paid_at
    `;

    const result = await pool.query(query, [txHash, claimId]);

    if (result.rows.length === 0) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const claim = result.rows[0];

    logger.info({
      event: "insurance_claim_approved",
      claimId,
      amount: claim.claim_amount,
      ownerAddress: claim.owner_address,
    });

    return claim;
  } catch (error) {
    logger.error({
      event: "claim_approval_error",
      claimId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Reject insurance claim
 * @param {number} claimId - Insurance claim ID
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} Rejected claim
 */
async function rejectInsuranceClaim(claimId, reason) {
  try {
    const query = `
      UPDATE insurance_claims
      SET
        status = 'rejected',
        rejection_reason = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING id, file_id, status, rejection_reason
    `;

    const result = await pool.query(query, [reason, claimId]);

    if (result.rows.length === 0) {
      throw new Error(`Claim ${claimId} not found`);
    }

    const claim = result.rows[0];

    logger.info({
      event: "insurance_claim_rejected",
      claimId,
      reason,
    });

    return claim;
  } catch (error) {
    logger.error({
      event: "claim_rejection_error",
      claimId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Get all active insurance records for a user
 * @param {string} ownerAddress - User's Stellar address
 * @returns {Promise<Array>} List of insured files
 */
async function getUserInsuredFiles(ownerAddress) {
  const query = `
    SELECT
      id, cid, owner_address, file_size, file_value, premium,
      storage_type, status, availability_score,
      checks_total, checks_passed, last_checked,
      created_at, updated_at
    FROM insured_files
    WHERE owner_address = $1 AND status = 'active'
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query, [ownerAddress]);
  return result.rows;
}

/**
 * Get insurance claim by ID
 * @param {number} claimId - Insurance claim ID
 * @returns {Promise<Object>} Insurance claim details
 */
async function getInsuranceClaim(claimId) {
  const query = `
    SELECT
      ic.id, ic.file_id, ic.owner_address, ic.claim_amount,
      ic.status, ic.evidence, ic.oracle_proof, ic.oracle_address,
      ic.payout_tx_hash, ic.rejection_reason,
      ic.created_at, ic.proof_submitted_at, ic.paid_at,
      IF.cid, IF.file_size, IF.file_value, IF.storage_type
    FROM insurance_claims ic
    JOIN insured_files IF ON ic.file_id = IF.id
    WHERE ic.id = $1
  `;

  const result = await pool.query(query, [claimId]);

  if (result.rows.length === 0) {
    throw new Error(`Claim ${claimId} not found`);
  }

  return result.rows[0];
}

/**
 * Get pending insurance claims (proof submitted, waiting for approval)
 * @returns {Promise<Array>} List of pending claims
 */
async function getPendingClaims() {
  const query = `
    SELECT
      ic.id, ic.file_id, ic.owner_address, ic.claim_amount,
      ic.status, ic.oracle_address, ic.proof_submitted_at,
      IF.cid, IF.file_size, IF.availability_score
    FROM insurance_claims ic
    JOIN insured_files IF ON ic.file_id = IF.id
    WHERE ic.status = 'proof_submitted'
    ORDER BY ic.proof_submitted_at ASC
  `;

  const result = await pool.query(query);
  return result.rows;
}

/**
 * Get insurance statistics
 * @returns {Promise<Object>} Insurance system statistics
 */
async function getInsuranceStats() {
  const statsQuery = `
    SELECT
      (SELECT COUNT(*) FROM insured_files WHERE status = 'active') as active_files,
      (SELECT COUNT(*) FROM insurance_claims WHERE status = 'pending') as pending_claims,
      (SELECT COUNT(*) FROM insurance_claims WHERE status = 'approved') as approved_claims,
      (SELECT COALESCE(SUM(premium), 0) FROM insured_files WHERE status = 'active') as total_premiums,
      (SELECT COALESCE(SUM(claim_amount), 0) FROM insurance_claims WHERE status = 'approved') as total_payouts,
      (SELECT AVG(availability_score) FROM insured_files WHERE status = 'active') as avg_availability
  `;

  const result = await pool.query(statsQuery);

  if (result.rows.length === 0) {
    return {
      activeFiles: 0,
      pendingClaims: 0,
      approvedClaims: 0,
      totalPremiums: 0,
      totalPayouts: 0,
      avgAvailability: 1.0,
    };
  }

  const row = result.rows[0];
  return {
    activeFiles: parseInt(row.active_files) || 0,
    pendingClaims: parseInt(row.pending_claims) || 0,
    approvedClaims: parseInt(row.approved_claims) || 0,
    totalPremiums: parseFloat(row.total_premiums) || 0,
    totalPayouts: parseFloat(row.total_payouts) || 0,
    avgAvailability: parseFloat(row.avg_availability) || 1.0,
  };
}

module.exports = {
  getConfig,
  calculatePremium,
  createInsuredFile,
  checkIPFSAvailability,
  checkArweaveAvailability,
  updateAvailabilityMetrics,
  performAvailabilityCheck,
  evaluateInsuranceClaim,
  submitOracleProof,
  approveInsuranceClaim,
  rejectInsuranceClaim,
  getUserInsuredFiles,
  getInsuranceClaim,
  getPendingClaims,
  getInsuranceStats,
};
