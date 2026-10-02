"use strict";

const { createServiceLogger } = require("../utils/logger");
const { getEscrowContractClient } = require("../contracts/escrowClient");
const pool = require("../db/pool");
const {
  bridgeCircuitBreaker,
  bridgeTransfersPending,
  bridgeVerificationsTotal,
  bridgeVerificationFailuresTotal,
  bridgeVolume,
} = require("../metrics/bridgeMetrics");

const logger = createServiceLogger("bridge-relay");

const CONFIRMATION_BLOCKS = 12;
const RECOVERY_DEADLINE_HOURS = 168;
const MAX_HOURLY_VOLUME = "100000000000000000000";
const MAX_FAILURE_RATE_BPS = 500;

const RETRYABLE_ERRORS = ["NETWORK_ERROR", "TIMEOUT", "RPC_ERROR", "SERVER_BUSY"];

class BridgeRelayService {
  constructor() {
    this.bridgeHalted = false;
    this.hourlyVolumeStart = Date.now();
    this.hourlyVolume = BigInt(0);
    this.totalVerifications = 0;
    this.failedVerifications = 0;
    this.processingNonces = new Map();
  }

  async observeEVMDeposits() {
    logger.info("Observing EVM deposits");
  }

  async observeSorobanWithdrawals() {
    logger.info("Observing Soroban withdrawals");
  }

  async submitEvmDepositToSoroban(depositEvent) {
    if (this.bridgeHalted) {
      throw new Error("Bridge halted");
    }

    const nonce = `${depositEvent.transactionHash}:${depositEvent.logIndex}`;
    if (this.processingNonces.has(nonce)) {
      logger.debug({ nonce }, "Skipping already-processing EVM deposit");
      return;
    }

    this.processingNonces.set(nonce, true);
    try {
      this.checkCircuitBreaker();

      const chainId = depositEvent.chainId;
      if (!chainId) {
        throw new Error("Missing chainId in deposit event");
      }

      const currentBlock = await this.fetchEVMCurrentBlock();
      const eventBlock = Number(depositEvent.blockNumber || 0);
      const confirmations = currentBlock - eventBlock;
      if (confirmations < CONFIRMATION_BLOCKS) {
        logger.debug(
          { nonce, confirmations },
          "Deposit not yet confirmed enough"
        );
        return;
      }

      const client = getEscrowContractClient();
      const bridgeTx = await client.invoke("register_bridge_deposit", {
        user: depositEvent.user,
        amount: depositEvent.amount,
        nonce,
        evm_tx_hash: depositEvent.transactionHash,
        proof: depositEvent.proof,
      });

      let simulation;
      try {
        simulation = await bridgeTx.simulate();
      } catch (simErr) {
        this.failedVerifications += 1;
        logger.error({ err: simErr, nonce }, "Soroban simulation failed");
        throw simErr;
      }

      const result = simulation.result?.decoded ?? simulation.result;
      logger.info({ nonce, result }, "EVM deposit registered on Soroban");

      await pool.query(
        `INSERT INTO bridge_transfers
           (source_chain, target_chain, transfer_type, nonce, amount, sender, recipient, status, tx_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          chainId,
          chainId,
          "evm_to_soroban",
          nonce,
          depositEvent.amount,
          depositEvent.user,
          depositEvent.user,
          "completed",
          result?.txHash ?? depositEvent.transactionHash,
        ]
      );

      this.totalVerifications += 1;
      this.hourlyVolume += BigInt(depositEvent.amount || 0);
      bridgeVerificationsTotal.inc({ status: "success" });
      bridgeVolume.set(Number(this.hourlyVolume));
    } catch (err) {
      if (RETRYABLE_ERRORS.some((code) => err.message?.includes(code))) {
        logger.warn({ err, nonce }, "Retryable EVM deposit submission failure");
        bridgeVerificationFailuresTotal.inc({ reason: "retryable" });
      } else {
        this.failedVerifications += 1;
        logger.error({ err, nonce }, "EVM deposit submission failed");
        bridgeVerificationFailuresTotal.inc({ reason: "permanent" });
      }
      throw err;
    } finally {
      this.processingNonces.delete(nonce);
    }
  }

  async submitSorobanWithdrawalToEvm(withdrawalEvent) {
    if (this.bridgeHalted) {
      throw new Error("Bridge halted");
    }

    const nonce = `${withdrawalEvent.txHash}:${withdrawalEvent.sequence ?? 0}`;
    if (this.processingNonces.has(nonce)) {
      logger.debug({ nonce }, "Skipping already-processing Soroban withdrawal");
      return;
    }

    this.processingNonces.set(nonce, true);
    try {
      this.checkCircuitBreaker();

      const client = getEscrowContractClient();
      const withdrawalTx = await client.invoke("release_bridge_withdrawal", {
        user: withdrawalEvent.user,
        amount: withdrawalEvent.amount,
        soroban_tx_hash: withdrawalEvent.txHash,
        proof: withdrawalEvent.proof,
      });

      let simulation;
      try {
        simulation = await withdrawalTx.simulate();
      } catch (simErr) {
        this.failedVerifications += 1;
        logger.error({ err: simErr, nonce }, "EVM proof submission simulation failed");
        throw simErr;
      }

      const result = simulation.result?.decoded ?? simulation.result;
      logger.info({ nonce, result }, "Soroban withdrawal proved on EVM");

      await pool.query(
        `INSERT INTO bridge_transfers
           (source_chain, target_chain, transfer_type, nonce, amount, sender, recipient, status, tx_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
        [
          "stellar",
          withdrawalEvent.targetChainId ?? "evm",
          "soroban_to_evm",
          nonce,
          withdrawalEvent.amount,
          withdrawalEvent.user,
          withdrawalEvent.user,
          "completed",
          result?.txHash ?? withdrawalEvent.txHash,
        ]
      );

      this.totalVerifications += 1;
      this.hourlyVolume += BigInt(withdrawalEvent.amount || 0);
      bridgeVerificationsTotal.inc({ status: "success" });
      bridgeVolume.set(Number(this.hourlyVolume));
    } catch (err) {
      if (RETRYABLE_ERRORS.some((code) => err.message?.includes(code))) {
        logger.warn({ err, nonce }, "Retryable Soroban withdrawal submission failure");
        bridgeVerificationFailuresTotal.inc({ reason: "retryable" });
      } else {
        this.failedVerifications += 1;
        logger.error({ err, nonce }, "Soroban withdrawal submission failed");
        bridgeVerificationFailuresTotal.inc({ reason: "permanent" });
      }
      throw err;
    } finally {
      this.processingNonces.delete(nonce);
    }
  }

  async emergencyRecover(transferId) {
    const result = await pool.query(
      `SELECT * FROM bridge_transfers WHERE id = $1 AND created_at < NOW() - INTERVAL '7 days'`,
      [transferId]
    );
    if (result.rows.length === 0) {
      throw new Error("Transfer not found or not eligible for recovery");
    }

    const transfer = result.rows[0];

    if (transfer.status === "completed") {
      return { success: true, message: "Transfer already completed", transfer };
    }

    if (transfer.status === "recovering") {
      return { success: true, message: "Recovery already in progress", transfer };
    }

    await pool.query(
      `UPDATE bridge_transfers SET status = 'recovering', updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    logger.info({ transferId }, "Emergency recovery initiated");

    return {
      success: true,
      message: "Recovery initiated. An admin must manually process the transfer.",
      transfer: { ...transfer, status: "recovering" },
    };
  }

  async retryFailedTransfer(transferId) {
    const result = await pool.query(
      "SELECT * FROM bridge_transfers WHERE id = $1 AND status = 'failed'",
      [transferId]
    );
    if (result.rows.length === 0) {
      throw new Error("No failed transfer found with this ID");
    }

    const transfer = result.rows[0];
    await pool.query(
      `UPDATE bridge_transfers SET status = 'pending', failure_reason = NULL, updated_at = NOW() WHERE id = $1`,
      [transferId]
    );

    logger.info({ transferId, transfer }, "Failed transfer queued for retry");

    return {
      success: true,
      message: "Transfer queued for retry",
      transfer: { ...transfer, status: "pending" },
    };
  }

  checkCircuitBreaker() {
    const now = Date.now();
    if (now - this.hourlyVolumeStart > 3600000) {
      this.hourlyVolumeStart = now;
      this.hourlyVolume = BigInt(0);
    }

    if (this.hourlyVolume > BigInt(MAX_HOURLY_VOLUME)) {
      this.triggerCircuitBreaker("Hourly volume exceeded");
      return;
    }

    if (this.totalVerifications > 100) {
      const failureRateBps = (this.failedVerifications * 10000) / this.totalVerifications;
      if (failureRateBps > MAX_FAILURE_RATE_BPS) {
        this.triggerCircuitBreaker("Failure rate exceeded");
        return;
      }
    }
  }

  triggerCircuitBreaker(reason) {
    this.bridgeHalted = true;
    bridgeCircuitBreaker.set(1);
    logger.error({ reason }, "Bridge circuit breaker triggered");
  }

  resumeBridge() {
    if (!this.bridgeHalted) {
      return;
    }
    this.bridgeHalted = false;
    bridgeCircuitBreaker.set(0);
    this.failedVerifications = 0;
    this.totalVerifications = 0;
    this.hourlyVolume = BigInt(0);
    this.hourlyVolumeStart = Date.now();
    logger.info("Bridge resumed after circuit breaker");
  }

  getStatus() {
    return {
      halted: this.bridgeHalted,
      hourlyVolume: this.hourlyVolume.toString(),
      totalVerifications: this.totalVerifications,
      failedVerifications: this.failedVerifications,
    };
  }

  async fetchEVMCurrentBlock() {
    const { rows } = await pool.query(
      "SELECT block_number FROM evm_blocks ORDER BY block_number DESC LIMIT 1"
    );
    return rows.length ? Number(rows[0].block_number) : 0;
  }
}

module.exports = new BridgeRelayService();
