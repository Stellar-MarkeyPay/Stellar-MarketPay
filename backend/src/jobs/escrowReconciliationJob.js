const pool = require('../db/pool');
const { getEscrowOnChain } = require('../contracts/escrowClient');
const { escrowReconciliationMismatchCounter } = require('../metrics/escrowReconciliationMetrics');
const { createServiceLogger } = require('../utils/logger');

const logger = createServiceLogger('escrow-reconciliation');

/**
 * List all non‑terminal escrows from the database.
 * Non‑terminal statuses are those not in ['released', 'refunded', 'timeout_refunded'].
 */
async function fetchActiveEscrows() {
  const { rows } = await pool.query(
    `SELECT * FROM escrows WHERE status NOT IN ('released', 'refunded', 'timeout_refunded')`
  );
  return rows;
}

/**
 * Compare DB escrow record with on‑chain representation and log mismatches.
 * Returns true if a mismatch was found.
 */
function compareEscrow(dbEscrow, onChain) {
  if (!onChain) {
    logger.warn({ jobId: dbEscrow.job_id }, 'On‑chain escrow data missing');
    escrowReconciliationMismatchCounter.inc({ type: 'missing_onchain' });
    return true;
  }
  const mismatches = [];
  if (dbEscrow.status !== onChain.status) mismatches.push('status');
  if (dbEscrow.client_address !== onChain.client) mismatches.push('client_address');
  if (dbEscrow.freelancer_address !== onChain.freelancer) mismatches.push('freelancer_address');
  if (Number(dbEscrow.amount_xlm) !== Number(onChain.amount)) mismatches.push('amount');

  if (mismatches.length > 0) {
    logger.warn({ jobId: dbEscrow.job_id, mismatches, db: dbEscrow, onChain }, 'Escrow state mismatch detected');
    escrowReconciliationMismatchCounter.inc({ type: 'field_mismatch' });
    return true;
  }
  return false;
}

/**
 * Run the full reconciliation pass.
 */
async function runReconciliation() {
  logger.info('Starting escrow reconciliation job');
  const escrows = await fetchActiveEscrows();
  for (const esc of escrows) {
    try {
      const onChain = await getEscrowOnChain(esc.job_id);
      compareEscrow(esc, onChain);
    } catch (err) {
      logger.error({ err, jobId: esc.job_id }, 'Error reconciling escrow');
      escrowReconciliationMismatchCounter.inc({ type: 'error' });
    }
  }
  logger.info('Escrow reconciliation job completed');
}

module.exports = { runReconciliation };
