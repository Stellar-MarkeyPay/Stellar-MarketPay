const promClient = require('prom-client');

// Counter for mismatches detected during escrow reconciliation
// Labels:
//   type - one of 'missing_onchain', 'field_mismatch', 'error'
const escrowReconciliationMismatchCounter = new promClient.Counter({
  name: 'marketpay_escrow_reconciliation_mismatch_total',
  help: 'Total number of escrow reconciliation mismatches detected',
  labelNames: ['type'],
  registers: [global.__metricsRegistry || new promClient.Registry()],
});

module.exports = { escrowReconciliationMismatchCounter };
