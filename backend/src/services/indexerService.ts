// @ts-nocheck
"use strict";

const { Horizon } = require("@stellar/stellar-sdk");
const promClient = require("prom-client");

const pool = require("../db/pool");
const { requireEnv } = require("../config/env");

const DEFAULT_EVENT_STREAM = "contract_events";
const DEFAULT_TX_STREAM = "transactions";
const DEFAULT_SUPPORTED_SCHEMA_VERSIONS = new Set([1]);
const MAX_BACKOFF_MS = 60_000;

function sleep(ms: any) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJobIdFromMemo(memoValue: any) {
  if (!memoValue || typeof memoValue !== "string") return null;
  const trimmed = memoValue.trim();
  const uuidMatch = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
  );
  if (uuidMatch) return uuidMatch[0];
  return null;
}

function toNumericAmount(amount: any) {
  const parsed = Number.parseFloat(amount || "0");
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function normalizeAsset(op: any) {
  if (op.asset_type === "native") return "XLM";
  if (op.asset_code) return op.asset_code;
  return "UNKNOWN";
}

function isEscrowRelease(op: any, platformWallet: any) {
  return op.type === "payment" && op.from === platformWallet && op.to && op.to !== platformWallet;
}

function isDonation(op: any, platformWallet: any) {
  return op.type === "payment" && op.to === platformWallet && op.from && op.from !== platformWallet;
}

function stableStringify(value: any) {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function dedupeSortedEvents(records: any) {
  const seen = new Set();
  return records
    .filter(Boolean)
    .sort((left: any, right: any) => {
      const leftLedger = Number(left.ledgerSequence || 0);
      const rightLedger = Number(right.ledgerSequence || 0);
      if (leftLedger !== rightLedger) return leftLedger - rightLedger;
      const leftIndex = Number(left.eventIndex || 0);
      const rightIndex = Number(right.eventIndex || 0);
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left.eventUid).localeCompare(String(right.eventUid));
    })
    .filter((record: any) => {
      if (seen.has(record.eventUid)) return false;
      seen.add(record.eventUid);
      return true;
    });
}

function collectJobIds(records: any) {
  return [...new Set(records.map((record: any) => record.jobId).filter(Boolean))];
}

function normalizePayload(payload: any) {
  if (payload == null) return {};
  if (typeof payload === "object") return payload;
  return { value: payload };
}

function jitter(base: any) {
  return Math.floor(base * (0.8 + Math.random() * 0.4));
}

function toIsoOrNull(value: any) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function maybeJsonParse(value: any) {
  if (value == null || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

class IndexerService {
  supportedSchemaVersions: any;
  db: any;

  platformWallet: any;
  contractId: any;
  horizon: any;
  broadcast: any;
  clock: any;
  cdnInvalidation: any;
  metrics: any;
  sourceAdapter: any;
  pool: any;
  sideEffectsEnabled: any;
  reconciliationIntervalMs: any;
  syncState: any;
  closeStream: any;
  closeEventStream: any;
  reconcileTimer: any;

  constructor({
    platformWallet,
    horizonUrl,
    contractId,
    broadcast = () => {},
    cdnInvalidation = null,
    db = pool,
    horizon = null,
    metricsRegistry = null,
    sourceAdapter = null,
    supportedSchemaVersions = DEFAULT_SUPPORTED_SCHEMA_VERSIONS,
    sideEffectsEnabled = true,
    reconciliationIntervalMs = 0,
    clock = () => new Date(),
  }) {
    this.platformWallet = platformWallet || null;
    this.horizonUrl = horizonUrl || "https://horizon-testnet.stellar.org";
    this.broadcast = broadcast;
    this.cdnInvalidation = cdnInvalidation;
    this.db = db;
    this.horizon = horizon || new Horizon.Server(this.horizonUrl);
    this.sourceAdapter = sourceAdapter;
    this.sideEffectsEnabled = sideEffectsEnabled;
    this.reconciliationIntervalMs = reconciliationIntervalMs;
    this.clock = clock;
    this.backoffState = { [DEFAULT_EVENT_STREAM]: 1_000, [DEFAULT_TX_STREAM]: 1_000 };
    this.supportedSchemaVersions = new Set(
      Array.from(supportedSchemaVersions || DEFAULT_SUPPORTED_SCHEMA_VERSIONS).map((value) =>
        Number(value)
      )
    );
    this.contractId = requireEnv("CONTRACT_ID", {
      fallback: contractId || process.env.ESCROW_CONTRACT_ID,
    });

    this.syncState = {
      running: false,
      synced: false,
      lastProcessedLedger: null,
      lastTransactionAt: null,
      lastError: null,
      lastEventUid: null,
      lastReconciledAt: null,
      gapCount: 0,
      reorgCount: 0,
    };

    this.closeStream = null;
    this.closeEventStream = null;
    this.reconcileTimer = null;

    this._registerMetrics(metricsRegistry);
  }

  _registerMetrics(registry: any) {
    if (!registry) {
      this.metrics = null;
      return;
    }

    const safeRegisterMetric = (factory: any) => {
      try {
        return factory();
      } catch (error: any) {
        if (error.code === "ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL") throw error;
        return null;
      }
    };

    this.metrics = {
      lagLedgerGauge: safeRegisterMetric(
        () =>
          new promClient.Gauge({
            name: "marketpay_indexer_ingestion_lag_ledgers",
            help: "Difference between observed tip and last applied ledger",
            labelNames: ["stream"],
            registers: [registry],
          })
      ),
      throughputCounter: safeRegisterMetric(
        () =>
          new promClient.Counter({
            name: "marketpay_indexer_events_processed_total",
            help: "Total canonical events applied by the indexer",
            labelNames: ["stream", "mode"],
            registers: [registry],
          })
      ),
      errorCounter: safeRegisterMetric(
        () =>
          new promClient.Counter({
            name: "marketpay_indexer_errors_total",
            help: "Indexer processing errors by stream and stage",
            labelNames: ["stream", "stage"],
            registers: [registry],
          })
      ),
      batchLatency: safeRegisterMetric(
        () =>
          new promClient.Histogram({
            name: "marketpay_indexer_batch_duration_seconds",
            help: "Latency of canonical batch application",
            labelNames: ["stream", "mode"],
            buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
            registers: [registry],
          })
      ),
      reorgCounter: safeRegisterMetric(
        () =>
          new promClient.Counter({
            name: "marketpay_indexer_reorgs_total",
            help: "Number of detected ledger reorganisations",
            labelNames: ["stream"],
            registers: [registry],
          })
      ),
      gapCounter: safeRegisterMetric(
        () =>
          new promClient.Counter({
            name: "marketpay_indexer_gaps_total",
            help: "Number of missing-ledger gaps detected during ingestion",
            labelNames: ["stream"],
            registers: [registry],
          })
      ),
      divergenceGauge: safeRegisterMetric(
        () =>
          new promClient.Gauge({
            name: "marketpay_indexer_divergence_total",
            help: "Number of reconciliation findings by divergence class",
            labelNames: ["divergence_class"],
            registers: [registry],
          })
      ),
    };
  }

  _observeError(stream: any, stage: any, error: any) {
    this.syncState.lastError = error?.message || String(error || "unknown error");
    if (this.metrics?.errorCounter) {
      this.metrics.errorCounter.inc({ stream, stage });
    }
  }

  _markStreamHealthy(stream: any, lastLedger: any) {
    if (stream === DEFAULT_EVENT_STREAM && lastLedger != null) {
      this.syncState.synced = true;
      this.syncState.lastProcessedLedger = Number(lastLedger);
    }
    if (this.metrics?.lagLedgerGauge && lastLedger != null) {
      this.metrics.lagLedgerGauge.set({ stream }, 0);
    }
  }

  _scheduleReconnect(stream: any, fn: any) {
    const delay = jitter(this.backoffState[stream] || 1_000);
    this.backoffState[stream] = Math.min((this.backoffState[stream] || 1_000) * 2, MAX_BACKOFF_MS);
    setTimeout(() => {
      if (this.syncState.running) {
        fn().catch((error: any) => {
          this._observeError(stream, "reconnect", error);
        });
      }
    }, delay).unref?.();
  }

  _resetBackoff(stream: any) {
    this.backoffState[stream] = 1_000;
  }

  extractTopicString(topic: any) {
    if (!topic) return null;
    if (typeof topic === "string") return topic;
    if (typeof topic.value === "string") return topic.value;
    return null;
  }

  extractSchemaVersion(event: any) {
    const candidate =
      event?.schema_version ??
      event?.schemaVersion ??
      event?.value?.schema_version ??
      event?.value?.schemaVersion ??
      1;
    const numeric = Number(candidate);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  }

  isSupportedSchemaVersion(version: any) {
    return this.supportedSchemaVersions.has(Number(version || 1));
  }

  normalizeContractEvent(event: any, { eventIndex = 0 } = {}) {
    if (this.contractId && event.contract_id !== this.contractId) return null;

    const eventTypeRaw = this.extractTopicString(event.topic?.[0]);
    if (!eventTypeRaw) return null;

    const typeMap = {
      escrow_created: "escrow_created",
      work_started: "work_started",
      escrow_released: "escrow_released",
      escrow_refunded: "escrow_refunded",
      escrow_timeout_refunded: "escrow_refunded",
      escrow_disputed: "dispute_opened",
      milestone_released: "milestone_released",
      message_sent: "message_sent",
    };

    const eventType = typeMap[eventTypeRaw];
    if (!eventType) return null;

    const jobId = this.extractTopicString(event.topic?.[1]) || event.value?.job_id || null;
    if (!jobId) return null;

    const ledgerSequence = Number(event.ledger ?? event.ledger_attr ?? 0) || null;
    const schemaVersion = this.extractSchemaVersion(event);
    const txHash = event.transaction_hash || null;
    const ledgerHash = event.ledger_hash || null;
    const parentLedgerHash = event.parent_ledger_hash || null;
    const eventUid = `contract:${ledgerSequence || "unknown"}:${txHash || "unknown"}:${eventIndex}`;

    return {
      eventUid,
      source: DEFAULT_EVENT_STREAM,
      ledgerSequence,
      ledgerHash,
      parentLedgerHash,
      txHash,
      eventIndex,
      eventType,
      schemaVersion,
      contractId: event.contract_id || this.contractId || null,
      jobId,
      payload: normalizePayload(event.value),
      occurredAt: event.ledger_closed_at || event.created_at || this.clock().toISOString(),
      raw: event,
    };
  }

  async loadCheckpoint(streamName = DEFAULT_EVENT_STREAM) {
    const { rows } = await this._query(
      `SELECT stream_name, last_ledger_sequence, last_ledger_hash, last_event_uid, updated_at
       FROM indexer_checkpoints
       WHERE stream_name = $1`,
      [streamName]
    );

    if (rows.length) {
      if (streamName === DEFAULT_EVENT_STREAM) {
        this.syncState.lastProcessedLedger = rows[0].last_ledger_sequence;
        this.syncState.lastEventUid = rows[0].last_event_uid;
      }
      return rows[0];
    }

    const legacy = await this._query(
      "SELECT synced, last_processed_ledger, last_transaction_at, last_event_uid, last_reconciled_at FROM indexer_state WHERE id = 1"
    );
    if (!legacy.rows.length) return null;

    const row = legacy.rows[0];
    if (streamName === DEFAULT_EVENT_STREAM) {
      this.syncState.synced = Boolean(row.synced);
      this.syncState.lastProcessedLedger = row.last_processed_ledger;
      this.syncState.lastTransactionAt = row.last_transaction_at;
      this.syncState.lastEventUid = row.last_event_uid || null;
      this.syncState.lastReconciledAt = row.last_reconciled_at || null;
    }

    return {
      stream_name: streamName,
      last_ledger_sequence: row.last_processed_ledger,
      last_ledger_hash: null,
      last_event_uid: row.last_event_uid || null,
      updated_at: row.last_transaction_at || null,
    };
  }

  async saveCheckpoint(
    { streamName = DEFAULT_EVENT_STREAM, ledger, ledgerHash, eventUid },
    client: any
  ) {
    await this._query(
      `INSERT INTO indexer_checkpoints (stream_name, last_ledger_sequence, last_ledger_hash, last_event_uid, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (stream_name)
       DO UPDATE SET
         last_ledger_sequence = EXCLUDED.last_ledger_sequence,
         last_ledger_hash = EXCLUDED.last_ledger_hash,
         last_event_uid = EXCLUDED.last_event_uid,
         updated_at = NOW()`,
      [streamName, ledger || null, ledgerHash || null, eventUid || null],
      client
    );

    if (streamName === DEFAULT_EVENT_STREAM) {
      await this._query(
        `UPDATE indexer_state
         SET synced = TRUE,
             last_processed_ledger = $1,
             last_event_ledger = $1,
             last_event_uid = $2,
             updated_at = NOW()
         WHERE id = 1`,
        [ledger || null, eventUid || null],
        client
      );
      this.syncState.synced = true;
      this.syncState.lastProcessedLedger = ledger || null;
      this.syncState.lastEventUid = eventUid || null;
    }
  }

  async markReconciledAt(client: any) {
    await this._query(
      "UPDATE indexer_state SET last_reconciled_at = NOW(), updated_at = NOW() WHERE id = 1",
      [],
      client
    );
    this.syncState.lastReconciledAt = this.clock().toISOString();
  }

  async _query(sql: any, params = [], client = null) {
    const executor = client || this.db;
    return executor.query(sql, params);
  }

  async _withTransaction(fn: any) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error: any) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async _createBatch(client: any, { source, batchKind, fromLedger, toLedger, details = {} }) {
    const { rows } = await this._query(
      `INSERT INTO indexer_ledger_batches
         (source, batch_kind, from_ledger, to_ledger, status, details)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb)
       RETURNING batch_id`,
      [source, batchKind, fromLedger || null, toLedger || null, JSON.stringify(details)],
      client
    );
    return rows[0].batch_id;
  }

  async _finalizeBatch(client: any, batchId: any, status = "applied") {
    await this._query(
      `UPDATE indexer_ledger_batches
       SET status = $2, committed_at = NOW()
       WHERE batch_id = $1`,
      [batchId, status],
      client
    );
  }

  async _getLineageRecord(client: any, source: any, ledgerSequence: any) {
    const { rows } = await this._query(
      `SELECT source, ledger_sequence, ledger_hash, parent_ledger_hash, closed_at
       FROM indexer_ledger_lineage
       WHERE source = $1 AND ledger_sequence = $2`,
      [source, ledgerSequence],
      client
    );
    return rows[0] || null;
  }

  async _upsertLineageRecord(client: any, source: any, record: any) {
    await this._query(
      `INSERT INTO indexer_ledger_lineage
         (source, ledger_sequence, ledger_hash, parent_ledger_hash, closed_at, observed_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (source, ledger_sequence)
       DO UPDATE SET
         ledger_hash = EXCLUDED.ledger_hash,
         parent_ledger_hash = EXCLUDED.parent_ledger_hash,
         closed_at = EXCLUDED.closed_at,
         observed_at = NOW()`,
      [
        source,
        record.ledgerSequence,
        record.ledgerHash || null,
        record.parentLedgerHash || null,
        record.occurredAt || null,
      ],
      client
    );
  }

  async _insertRawEvent(client: any, batchId: any, record: any) {
    const before = await this._query(
      "SELECT event_uid, canonical, payload FROM indexer_raw_events WHERE event_uid = $1",
      [record.eventUid],
      client
    );
    const wasPresent = before.rows.length > 0;

    await this._query(
      `INSERT INTO indexer_raw_events
         (event_uid, batch_id, source, ledger_sequence, ledger_hash, parent_ledger_hash, tx_hash,
          event_index, event_type, schema_version, job_id, payload, occurred_at, canonical, superseded_by_reorg_id, seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12::jsonb, $13, TRUE, NULL, NOW())
       ON CONFLICT (event_uid)
       DO UPDATE SET
         batch_id = EXCLUDED.batch_id,
         ledger_sequence = EXCLUDED.ledger_sequence,
         ledger_hash = EXCLUDED.ledger_hash,
         parent_ledger_hash = EXCLUDED.parent_ledger_hash,
         tx_hash = EXCLUDED.tx_hash,
         event_index = EXCLUDED.event_index,
         event_type = EXCLUDED.event_type,
         schema_version = EXCLUDED.schema_version,
         job_id = EXCLUDED.job_id,
         payload = EXCLUDED.payload,
         occurred_at = EXCLUDED.occurred_at,
         canonical = TRUE,
         superseded_by_reorg_id = NULL,
         seen_at = NOW()`,
      [
        record.eventUid,
        batchId,
        record.source,
        record.ledgerSequence,
        record.ledgerHash || null,
        record.parentLedgerHash || null,
        record.txHash || null,
        record.eventIndex || 0,
        record.eventType,
        record.schemaVersion || 1,
        record.jobId || null,
        JSON.stringify(record.payload || {}),
        record.occurredAt || null,
      ],
      client
    );

    if (!wasPresent) return true;
    const previousPayload = before.rows[0].payload || {};
    return (
      !before.rows[0].canonical ||
      stableStringify(previousPayload) !== stableStringify(record.payload)
    );
  }

  async _markRawEventsNonCanonicalFromLedger(
    client: any,
    source: any,
    fromLedger: any,
    reorgId: any
  ) {
    await this._query(
      `UPDATE indexer_raw_events
       SET canonical = FALSE,
           superseded_by_reorg_id = $3
       WHERE source = $1
         AND canonical = TRUE
         AND ledger_sequence >= $2`,
      [source, fromLedger, reorgId],
      client
    );

    await this._query(
      `UPDATE indexer_applied_effects
       SET rolled_back_at = NOW()
       WHERE event_uid IN (
         SELECT event_uid
         FROM indexer_raw_events
         WHERE source = $1 AND ledger_sequence >= $2 AND superseded_by_reorg_id = $3
       )`,
      [source, fromLedger, reorgId],
      client
    );

    await this._query(
      `UPDATE indexer_outbox
       SET suppressed = TRUE
       WHERE event_uid IN (
         SELECT event_uid
         FROM indexer_raw_events
         WHERE source = $1 AND ledger_sequence >= $2 AND superseded_by_reorg_id = $3
       )`,
      [source, fromLedger, reorgId],
      client
    );

    await this._query(
      "DELETE FROM indexer_ledger_lineage WHERE source = $1 AND ledger_sequence >= $2",
      [source, fromLedger],
      client
    );
  }

  async _getImpactedJobsFromLedger(client: any, source: any, fromLedger: any) {
    const { rows } = await this._query(
      `SELECT DISTINCT job_id
       FROM indexer_raw_events
       WHERE source = $1
         AND canonical = TRUE
         AND ledger_sequence >= $2
         AND job_id IS NOT NULL`,
      [source, fromLedger],
      client
    );
    return rows.map((row: any) => row.job_id);
  }

  async _createReorgJournalEntry(client: any, source: any, details: any) {
    const { rows } = await this._query(
      `INSERT INTO indexer_reorg_journal
         (source, old_tip_ledger, new_tip_ledger, rollback_from_ledger, rollback_to_ledger, status, details)
       VALUES ($1, $2, $3, $4, $5, 'detected', $6::jsonb)
       RETURNING reorg_id`,
      [
        source,
        details.oldTipLedger || null,
        details.newTipLedger || null,
        details.rollbackFromLedger,
        details.rollbackToLedger || null,
        JSON.stringify(details),
      ],
      client
    );
    return rows[0].reorg_id;
  }

  async _completeReorgJournalEntry(client: any, reorgId: any, status: any) {
    await this._query(
      `UPDATE indexer_reorg_journal
       SET status = $2
       WHERE reorg_id = $1`,
      [reorgId, status],
      client
    );
  }

  async _recordAppliedEffect(
    client: any,
    record: any,
    effectType: any,
    targetTable: any,
    targetKey: any
  ) {
    await this._query(
      `INSERT INTO indexer_applied_effects
         (effect_uid, event_uid, effect_type, target_table, target_key, replay_safe, applied_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
       ON CONFLICT (effect_uid) DO NOTHING`,
      [`${effectType}:${record.eventUid}`, record.eventUid, effectType, targetTable, targetKey],
      client
    );
  }

  async _enqueueOutbox(client: any, record: any, sideEffect: any, payload: any, suppressed: any) {
    await this._query(
      `INSERT INTO indexer_outbox
         (outbox_uid, event_uid, side_effect, payload, suppressed, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, NOW())
       ON CONFLICT (outbox_uid) DO NOTHING`,
      [
        `${record.eventUid}:${sideEffect}`,
        record.eventUid,
        sideEffect,
        JSON.stringify(payload),
        suppressed,
      ],
      client
    );
  }

  async _recordFinding(
    client: any,
    {
      runId = null,
      divergenceClass,
      jobId = null,
      ledgerSequence = null,
      expected = {},
      actual = {},
      diagnostics = {},
    }
  ) {
    await this._query(
      `INSERT INTO indexer_reconciliation_findings
         (run_id, divergence_class, job_id, ledger_sequence, expected, actual, diagnostics, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, NOW())`,
      [
        runId,
        divergenceClass,
        jobId,
        ledgerSequence,
        JSON.stringify(expected),
        JSON.stringify(actual),
        JSON.stringify(diagnostics),
      ],
      client
    );
  }

  async _fetchCanonicalEventsForJob(client: any, jobId: any) {
    const { rows } = await this._query(
      `SELECT event_uid, source, ledger_sequence, ledger_hash, parent_ledger_hash, tx_hash,
              event_index, event_type, schema_version, job_id, payload, occurred_at
       FROM indexer_raw_events
       WHERE source = $1
         AND canonical = TRUE
         AND job_id = $2
       ORDER BY ledger_sequence ASC, event_index ASC`,
      [DEFAULT_EVENT_STREAM, jobId],
      client
    );
    return rows.map((row: any) => ({
      eventUid: row.event_uid,
      source: row.source,
      ledgerSequence: row.ledger_sequence,
      ledgerHash: row.ledger_hash,
      parentLedgerHash: row.parent_ledger_hash,
      txHash: row.tx_hash,
      eventIndex: row.event_index,
      eventType: row.event_type,
      schemaVersion: row.schema_version,
      jobId: row.job_id,
      payload: maybeJsonParse(row.payload) || {},
      occurredAt: toIsoOrNull(row.occurred_at),
    }));
  }

  _projectJobState(events: any) {
    const projection = {
      jobStatus: null,
      escrowStatus: null,
      releasedAt: null,
      unsupportedEvents: [],
    };

    for (const event of events) {
      if (!this.isSupportedSchemaVersion(event.schemaVersion)) {
        projection.unsupportedEvents.push(event);
        continue;
      }

      switch (event.eventType) {
        case "escrow_created":
          projection.escrowStatus = "funded";
          break;
        case "work_started":
          projection.escrowStatus = "in_progress";
          break;
        case "escrow_released":
          projection.escrowStatus = "released";
          projection.jobStatus = "completed";
          projection.releasedAt = event.occurredAt;
          break;
        case "escrow_refunded":
          projection.escrowStatus = "refunded";
          projection.jobStatus = "cancelled";
          break;
        case "dispute_opened":
          projection.escrowStatus = "disputed";
          projection.jobStatus = "disputed";
          break;
        case "milestone_released":
          if (!projection.escrowStatus) projection.escrowStatus = "funded";
          break;
        case "message_sent":
        default:
          break;
      }
    }

    if (!projection.escrowStatus) projection.escrowStatus = "funded";
    return projection;
  }

  async _rebuildJobProjection(client: any, jobId: any) {
    const events = await this._fetchCanonicalEventsForJob(client, jobId);
    if (!events.length) return;

    const projection = this._projectJobState(events);
    const unsupported = projection.unsupportedEvents;
    for (const event of unsupported) {
      await this._recordFinding(client, {
        divergenceClass: "unknown_schema_version",
        jobId,
        ledgerSequence: event.ledgerSequence,
        expected: { supportedSchemaVersions: Array.from(this.supportedSchemaVersions) },
        actual: { schemaVersion: event.schemaVersion, eventType: event.eventType },
        diagnostics: { eventUid: event.eventUid },
      });
    }

    await this._query(
      `UPDATE escrows
       SET status = $2,
           released_at = CASE WHEN $2 = 'released' THEN COALESCE($3::timestamptz, released_at) ELSE NULL END,
           updated_at = NOW()
       WHERE job_id = $1`,
      [jobId, projection.escrowStatus, projection.releasedAt || null],
      client
    );

    if (projection.jobStatus) {
      await this._query(
        `UPDATE jobs
         SET status = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [jobId, projection.jobStatus],
        client
      );
    }
  }

  async _rebuildJobProjections(client: any, jobIds: any) {
    for (const jobId of jobIds) {
      await this._rebuildJobProjection(client, jobId);
    }
  }

  async _refreshContractEventProjection(client: any, jobIds: any) {
    if (!jobIds.length) return;
    await this._query("DELETE FROM contract_events WHERE job_id = ANY($1)", [jobIds], client);

    const { rows } = await this._query(
      `SELECT event_uid, job_id, event_type, contract_id, tx_hash, ledger_sequence, payload, occurred_at, source, schema_version
       FROM indexer_raw_events
       WHERE source = $1
         AND canonical = TRUE
         AND job_id = ANY($2)
       ORDER BY ledger_sequence ASC, event_index ASC`,
      [DEFAULT_EVENT_STREAM, jobIds],
      client
    );

    for (const row of rows) {
      await this._query(
        `INSERT INTO contract_events
           (event_uid, job_id, event_type, contract_id, tx_hash, ledger, data, created_at, source, schema_version, canonical)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, TRUE)
         ON CONFLICT (event_uid)
         DO UPDATE SET
           job_id = EXCLUDED.job_id,
           event_type = EXCLUDED.event_type,
           contract_id = EXCLUDED.contract_id,
           tx_hash = EXCLUDED.tx_hash,
           ledger = EXCLUDED.ledger,
           data = EXCLUDED.data,
           created_at = EXCLUDED.created_at,
           source = EXCLUDED.source,
           schema_version = EXCLUDED.schema_version,
           canonical = TRUE`,
        [
          row.event_uid,
          row.job_id,
          row.event_type,
          this.contractId,
          row.tx_hash,
          row.ledger_sequence,
          JSON.stringify(maybeJsonParse(row.payload) || {}),
          row.occurred_at,
          row.source,
          row.schema_version,
        ],
        client
      );
    }
  }

  async _detectReorg(client: any, source: any, records: any) {
    if (!records.length) return null;

    for (const record of records) {
      if (record.ledgerSequence == null) continue;
      const existing = await this._getLineageRecord(client, source, record.ledgerSequence);
      if (
        existing?.ledger_hash &&
        record.ledgerHash &&
        existing.ledger_hash !== record.ledgerHash
      ) {
        return {
          rollbackFromLedger: record.ledgerSequence,
          rollbackToLedger: null,
          oldTipLedger: record.ledgerSequence,
          newTipLedger: records[records.length - 1].ledgerSequence || record.ledgerSequence,
          reason: "ledger_hash_mismatch",
          seenLedgerHash: record.ledgerHash,
          storedLedgerHash: existing.ledger_hash,
        };
      }
    }

    const first = records[0];
    if (first.ledgerSequence != null && first.parentLedgerHash && first.ledgerSequence > 1) {
      const previous = await this._getLineageRecord(client, source, first.ledgerSequence - 1);
      if (previous?.ledger_hash && previous.ledger_hash !== first.parentLedgerHash) {
        return {
          rollbackFromLedger: first.ledgerSequence - 1,
          rollbackToLedger: null,
          oldTipLedger: first.ledgerSequence - 1,
          newTipLedger: records[records.length - 1].ledgerSequence || first.ledgerSequence,
          reason: "parent_hash_mismatch",
          seenParentHash: first.parentLedgerHash,
          storedParentHash: previous.ledger_hash,
        };
      }
    }

    return null;
  }

  async _rollbackReorg(client: any, source: any, reorg: any) {
    const impactedJobs = await this._getImpactedJobsFromLedger(
      client,
      source,
      reorg.rollbackFromLedger
    );
    const reorgId = await this._createReorgJournalEntry(client, source, reorg);
    await this._markRawEventsNonCanonicalFromLedger(
      client,
      source,
      reorg.rollbackFromLedger,
      reorgId
    );
    await this._completeReorgJournalEntry(client, reorgId, "rolled_back");
    this.syncState.reorgCount += 1;
    if (this.metrics?.reorgCounter) this.metrics.reorgCounter.inc({ stream: source });
    return { reorgId, impactedJobs };
  }

  async _fillLedgerGaps(records: any, { source, checkpoint, fetchMissingRange }) {
    if (!records.length) return records;

    const output = [];
    let expectedLedger = checkpoint?.last_ledger_sequence
      ? Number(checkpoint.last_ledger_sequence) + 1
      : null;

    for (const record of records) {
      if (
        expectedLedger != null &&
        record.ledgerSequence != null &&
        record.ledgerSequence > expectedLedger
      ) {
        const missingFrom = expectedLedger;
        const missingTo = record.ledgerSequence - 1;
        this.syncState.gapCount += 1;
        if (this.metrics?.gapCounter) this.metrics.gapCounter.inc({ stream: source });

        if (!fetchMissingRange) {
          throw new Error(
            `Indexer gap detected on ${source}: missing ledgers ${missingFrom}-${missingTo}`
          );
        }

        const fetched = await fetchMissingRange({
          source,
          fromLedger: missingFrom,
          toLedger: missingTo,
          contractId: this.contractId,
        });
        const normalizedFetched = dedupeSortedEvents(
          (fetched || []).map((entry: any, index: any) =>
            this.normalizeCanonicalRecord(entry, { source, eventIndex: index })
          )
        );
        output.push(...normalizedFetched);
      }

      output.push(record);
      if (record.ledgerSequence != null) {
        expectedLedger = Number(record.ledgerSequence) + 1;
      }
    }

    return dedupeSortedEvents(output);
  }

  normalizeCanonicalRecord(record: any, { source = DEFAULT_EVENT_STREAM, eventIndex = 0 } = {}) {
    if (!record) return null;
    if (record.eventUid) {
      return {
        ...record,
        source: record.source || source,
        payload: normalizePayload(record.payload),
      };
    }
    if (source === DEFAULT_EVENT_STREAM) {
      return this.normalizeContractEvent(record, { eventIndex });
    }
    return null;
  }

  async ingestLedgerRange(
    records: any,
    { source = DEFAULT_EVENT_STREAM, mode = "live", suppressSideEffects, fetchMissingRange } = {}
  ) {
    const startedAt = Date.now();
    const checkpoint = await this.loadCheckpoint(source);
    const normalized = dedupeSortedEvents(
      (records || []).map((record: any, index: any) =>
        this.normalizeCanonicalRecord(record, { source, eventIndex: index })
      )
    );

    if (!normalized.length) {
      return {
        appliedEvents: 0,
        reorgHandled: false,
        lastLedger: checkpoint?.last_ledger_sequence || null,
        durationMs: 0,
      };
    }

    const gapFetcher =
      fetchMissingRange ||
      (this.sourceAdapter && typeof this.sourceAdapter.fetchCanonicalRange === "function"
        ? this.sourceAdapter.fetchCanonicalRange.bind(this.sourceAdapter)
        : null);

    const filled = await this._fillLedgerGaps(normalized, {
      source,
      checkpoint,
      fetchMissingRange: gapFetcher,
    });

    const suppress =
      typeof suppressSideEffects === "boolean"
        ? suppressSideEffects
        : mode !== "live" || !this.sideEffectsEnabled;

    const batchTimer = this.metrics?.batchLatency?.startTimer({ stream: source, mode });

    try {
      const result = await this._withTransaction(async (client: any) => {
        const reorg = await this._detectReorg(client, source, filled);
        let impactedJobs = collectJobIds(filled);
        let reorgContext = null;

        if (reorg) {
          reorgContext = await this._rollbackReorg(client, source, reorg);
          impactedJobs = [...new Set([...impactedJobs, ...reorgContext.impactedJobs])];
        }

        const batchId = await this._createBatch(client, {
          source,
          batchKind: mode,
          fromLedger: filled[0].ledgerSequence,
          toLedger: filled[filled.length - 1].ledgerSequence,
          details: {
            // @ts-ignore
            suppressSideEffects: suppress,
            recordCount: filled.length,
          },
        });

        const newlyApplied = [];
        for (const record of filled) {
          const inserted = await this._insertRawEvent(client, batchId, record);
          await this._upsertLineageRecord(client, source, record);
          if (inserted) {
            newlyApplied.push(record);
          }
        }

        await this._rebuildJobProjections(client, impactedJobs);
        await this._refreshContractEventProjection(client, impactedJobs);

        for (const record of newlyApplied) {
          await this._recordAppliedEffect(
            client,
            record,
            "project_contract_event",
            "contract_events",
            record.eventUid
          );

          if (!suppress) {
            await this._enqueueDefaultSideEffects(client, record);
          }
        }

        const last = filled[filled.length - 1];
        await this.saveCheckpoint(
          {
            streamName: source,
            ledger: last.ledgerSequence,
            ledgerHash: last.ledgerHash || null,
            eventUid: last.eventUid,
          },
          client
        );
        await this._finalizeBatch(client, batchId, "applied");

        return {
          appliedEvents: newlyApplied.length,
          reorgHandled: Boolean(reorgContext),
          lastLedger: last.ledgerSequence,
          lastEventUid: last.eventUid,
          impactedJobs,
        };
      });

      if (!suppress) {
        await this.flushOutbox();
      }

      if (this.metrics?.throughputCounter && result.appliedEvents > 0) {
        this.metrics.throughputCounter.inc({ stream: source, mode }, result.appliedEvents);
      }

      this._markStreamHealthy(source, result.lastLedger);
      result.durationMs = Date.now() - startedAt;
      return result;
    } catch (error: any) {
      this._observeError(source, "apply_batch", error);
      throw error;
    } finally {
      if (batchTimer) batchTimer();
    }
  }

  async _enqueueDefaultSideEffects(client: any, record: any) {
    const eventPayload = {
      jobId: record.jobId,
      eventType: record.eventType,
      txHash: record.txHash,
      ledger: record.ledgerSequence,
    };
    await this._enqueueOutbox(client, record, "broadcast:contract:event", eventPayload, false);

    if (["escrow_released", "escrow_refunded", "dispute_opened"].includes(record.eventType)) {
      const statusMap = {
        escrow_released: "completed",
        escrow_refunded: "cancelled",
        dispute_opened: "disputed",
      };
      await this._enqueueOutbox(
        client,
        record,
        "broadcast:job:status-changed",
        {
          jobId: record.jobId,
          status: statusMap[record.eventType],
          txHash: record.txHash,
          ledger: record.ledgerSequence,
        },
        false
      );
    }

    if (this.cdnInvalidation) {
      await this._enqueueOutbox(
        client,
        record,
        "cdn:contract-event",
        {
          jobId: record.jobId,
          eventType: record.eventType,
          receivedAt: record.occurredAt ? Date.parse(record.occurredAt) : Date.now(),
        },
        false
      );
    }
  }

  async flushOutbox(limit = 500) {
    if (!this.sideEffectsEnabled) return { dispatched: 0 };
    const { rows } = await this._query(
      `SELECT outbox_uid, side_effect, payload
       FROM indexer_outbox
       WHERE dispatched_at IS NULL
         AND suppressed = FALSE
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );

    let dispatched = 0;
    for (const row of rows) {
      try {
        await this._dispatchOutboxRow(row);
        await this._query("UPDATE indexer_outbox SET dispatched_at = NOW() WHERE outbox_uid = $1", [
          row.outbox_uid,
        ]);
        dispatched += 1;
      } catch (error: any) {
        this._observeError(DEFAULT_EVENT_STREAM, "dispatch_outbox", error);
        console.error("[Indexer] outbox dispatch failed:", error.message);
      }
    }

    return { dispatched };
  }

  async _dispatchOutboxRow(row: any) {
    const payload = maybeJsonParse(row.payload) || {};

    if (row.side_effect === "broadcast:contract:event") {
      this.broadcast("contract:event", payload);
      return;
    }

    if (row.side_effect === "broadcast:job:status-changed") {
      this.broadcast("job:status-changed", payload);
      return;
    }

    if (row.side_effect === "cdn:contract-event" && this.cdnInvalidation) {
      await this.cdnInvalidation.handleContractEvent(payload.eventType, payload.jobId, {
        receivedAt: payload.receivedAt,
      });
    }
  }

  async processEvent(event: any) {
    const canonical = this.normalizeContractEvent(event);
    if (!canonical) return { appliedEvents: 0, reorgHandled: false, lastLedger: null };
    return this.ingestLedgerRange([canonical], { source: DEFAULT_EVENT_STREAM, mode: "live" });
  }

  async processTransaction(tx: any) {
    if (!tx.successful || !this.platformWallet) return { appliedEvents: 0 };
    const txMemo = tx.memo || null;
    const ledgerNumber = Number(tx.ledger_attr || tx.ledger || 0) || null;
    const matchedJobId = parseJobIdFromMemo(txMemo);
    const operations = await this.horizon.operations().forTransaction(tx.hash).limit(200).call();
    const records = operations?.records || [];

    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      for (const op of records) {
        if (op.type !== "payment") continue;
        const amount = toNumericAmount(op.amount);
        if (amount <= 0) continue;

        const asset = normalizeAsset(op);
        const outbound = op.from === this.platformWallet;
        const direction = outbound ? "outbound" : "inbound";

        await this._query(
          `INSERT INTO payment_records
             (tx_hash, operation_id, ledger, job_id, from_address, to_address, amount, asset, memo, direction, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (operation_id) DO NOTHING`,
          [
            tx.hash,
            String(op.id),
            ledgerNumber,
            matchedJobId,
            op.from,
            op.to,
            amount.toFixed(7),
            asset,
            txMemo,
            direction,
          ],
          client
        );

        if (matchedJobId && isEscrowRelease(op, this.platformWallet)) {
          await this._query(
            "UPDATE jobs SET status = 'completed', updated_at = NOW() WHERE id = $1 RETURNING id",
            [matchedJobId],
            client
          );
          await this._query(
            `UPDATE escrows
             SET status = 'released', released_at = NOW(), updated_at = NOW()
             WHERE job_id = $1 AND status <> 'released'`,
            [matchedJobId],
            client
          );
        }

        if (asset === "XLM" && isDonation(op, this.platformWallet)) {
          await this._query(
            `INSERT INTO donor_stats (address, total_donated_xlm, donation_count, updated_at)
             VALUES ($1, $2, 1, NOW())
             ON CONFLICT (address)
             DO UPDATE SET
               total_donated_xlm = donor_stats.total_donated_xlm + EXCLUDED.total_donated_xlm,
               donation_count = donor_stats.donation_count + 1,
               updated_at = NOW()`,
            [op.from, amount.toFixed(7)],
            client
          );
        }
      }

      await this.saveCheckpoint(
        {
          streamName: DEFAULT_TX_STREAM,
          ledger: ledgerNumber,
          ledgerHash: tx.ledger_hash || null,
          eventUid: tx.hash,
        },
        client
      );
      await client.query("COMMIT");
      this.syncState.lastTransactionAt = tx.created_at || null;
      return { appliedEvents: records.length, lastLedger: ledgerNumber };
    } catch (error: any) {
      await client.query("ROLLBACK");
      this._observeError(DEFAULT_TX_STREAM, "process_transaction", error);
      throw error;
    } finally {
      client.release();
    }
  }

  async rebuildDerivedState({ fromLedger = null, toLedger = null } = {}) {
    const { rows } = await this._query(
      `SELECT DISTINCT job_id
       FROM indexer_raw_events
       WHERE source = $1
         AND canonical = TRUE
         AND job_id IS NOT NULL
         AND ($2::bigint IS NULL OR ledger_sequence >= $2)
         AND ($3::bigint IS NULL OR ledger_sequence <= $3)`,
      [DEFAULT_EVENT_STREAM, fromLedger, toLedger]
    );
    const jobIds = rows.map((row: any) => row.job_id);

    await this._withTransaction(async (client: any) => {
      await this._rebuildJobProjections(client, jobIds);
      await this._refreshContractEventProjection(client, jobIds);
    });

    return { rebuiltJobs: jobIds.length, fromLedger, toLedger };
  }

  async replayLedgerRange({
    fromLedger,
    toLedger,
    fetchCanonicalRange = null,
    source = DEFAULT_EVENT_STREAM,
    productionSafe = true,
  }) {
    const fetcher =
      fetchCanonicalRange ||
      (this.sourceAdapter && typeof this.sourceAdapter.fetchCanonicalRange === "function"
        ? this.sourceAdapter.fetchCanonicalRange.bind(this.sourceAdapter)
        : null);

    if (!fetcher) {
      return this.rebuildDerivedState({ fromLedger, toLedger });
    }

    const started = Date.now();
    const records = await fetcher({ source, fromLedger, toLedger, contractId: this.contractId });
    const result = await this.ingestLedgerRange(records, {
      source,
      mode: "replay",
      // @ts-ignore
      suppressSideEffects: productionSafe,
      fetchMissingRange: null,
    });
    const durationMs = Date.now() - started;
    const ledgerCount =
      fromLedger != null && toLedger != null && toLedger >= fromLedger
        ? toLedger - fromLedger + 1
        : 0;

    return {
      ...result,
      durationMs,
      ledgersPerSecond:
        durationMs > 0 && ledgerCount > 0 ? (ledgerCount * 1_000) / durationMs : null,
    };
  }

  async replayFromGenesis({
    fetchCanonicalRange = null,
    toLedger = null,
    productionSafe = true,
  } = {}) {
    if (fetchCanonicalRange || this.sourceAdapter?.fetchCanonicalRange) {
      return this.replayLedgerRange({
        fromLedger: 1,
        toLedger,
        fetchCanonicalRange,
        source: DEFAULT_EVENT_STREAM,
        productionSafe,
      });
    }
    return this.rebuildDerivedState({ fromLedger: null, toLedger: null });
  }

  async reconcileDerivedState({
    fetchOnChainEscrow,
    fromLedger = null,
    toLedger = null,
    jobIds = null,
    mode = "continuous",
  }: any) {
    if (typeof fetchOnChainEscrow !== "function") {
      throw new Error("fetchOnChainEscrow must be provided for reconciliation");
    }

    const started = this.clock();
    const runId = await this._withTransaction(async (client: any) => {
      const { rows } = await this._query(
        `INSERT INTO indexer_reconciliation_runs (mode, from_ledger, to_ledger, started_at, status, summary)
         VALUES ($1, $2, $3, NOW(), 'running', '{}'::jsonb)
         RETURNING run_id`,
        [mode, fromLedger, toLedger],
        client
      );
      return rows[0].run_id;
    });

    const jobIdList =
      jobIds ||
      (
        await this._query(
          `SELECT DISTINCT job_id
           FROM indexer_raw_events
           WHERE source = $1
             AND canonical = TRUE
             AND job_id IS NOT NULL
             AND ($2::bigint IS NULL OR ledger_sequence >= $2)
             AND ($3::bigint IS NULL OR ledger_sequence <= $3)`,
          [DEFAULT_EVENT_STREAM, fromLedger, toLedger]
        )
      ).rows.map((row: any) => row.job_id);

    let findingCount = 0;
    const byClass = new Map();

    try {
      for (const jobId of jobIdList) {
        const [derivedEscrow, onChainEscrow] = await Promise.all([
          this._getDerivedEscrow(jobId),
          fetchOnChainEscrow(jobId),
        ]);

        if (!onChainEscrow) {
          continue;
        }

        const differences = this._classifyDivergence(derivedEscrow, onChainEscrow);
        if (!differences.length) continue;

        findingCount += differences.length;
        for (const diff of differences) {
          byClass.set(diff.divergenceClass, (byClass.get(diff.divergenceClass) || 0) + 1);
          await this._withTransaction(async (client: any) => {
            await this._recordFinding(client, {
              runId,
              divergenceClass: diff.divergenceClass,
              jobId,
              ledgerSequence: (diff as any).ledgerSequence || null,
              expected: diff.expected,
              actual: diff.actual,
              diagnostics: diff.diagnostics,
            });
          });
        }
      }

      await this._withTransaction(async (client: any) => {
        await this._query(
          `UPDATE indexer_reconciliation_runs
           SET finished_at = NOW(),
               status = 'completed',
               summary = $2::jsonb
           WHERE run_id = $1`,
          [
            runId,
            JSON.stringify({
              checkedJobs: jobIdList.length,
              findings: findingCount,
              byClass: Object.fromEntries(byClass),
              startedAt: started.toISOString(),
              finishedAt: this.clock().toISOString(),
            }),
          ],
          client
        );
        await this.markReconciledAt(client);
      });
    } catch (error: any) {
      await this._withTransaction(async (client: any) => {
        await this._query(
          `UPDATE indexer_reconciliation_runs
           SET finished_at = NOW(),
               status = 'failed',
               summary = $2::jsonb
           WHERE run_id = $1`,
          [runId, JSON.stringify({ error: error.message })],
          client
        );
      });
      this._observeError(DEFAULT_EVENT_STREAM, "reconcile", error);
      throw error;
    }

    if (this.metrics?.divergenceGauge) {
      for (const [divergenceClass, count] of byClass.entries()) {
        this.metrics.divergenceGauge.set({ divergence_class: divergenceClass }, count);
      }
    }

    return { runId, checkedJobs: jobIdList.length, findings: findingCount };
  }

  async _getDerivedEscrow(jobId: any) {
    const { rows } = await this._query(
      `SELECT e.job_id, e.status AS escrow_status, e.released_at, j.status AS job_status
       FROM escrows e
       LEFT JOIN jobs j ON j.id = e.job_id
       WHERE e.job_id = $1`,
      [jobId]
    );
    return rows[0] || null;
  }

  _classifyDivergence(derived: any, onChain: any) {
    if (!derived && !onChain) return [];

    const findings: any[] = [];
    if (!derived && onChain) {
      findings.push({
        divergenceClass: "projection_missing_row",
        expected: onChain,
        actual: { derived: null },
        diagnostics: { reason: "derived escrow row missing" },
      });
      return findings;
    }

    if (derived && !onChain) {
      findings.push({
        divergenceClass: "missing_raw_event",
        expected: { onChain: null },
        actual: derived,
        diagnostics: { reason: "on-chain escrow lookup missing while derived row exists" },
      });
      return findings;
    }

    if (derived.escrow_status !== onChain.escrowStatus) {
      findings.push({
        divergenceClass: "projection_wrong_status",
        expected: { escrowStatus: onChain.escrowStatus, jobStatus: onChain.jobStatus || null },
        actual: { escrowStatus: derived.escrow_status, jobStatus: derived.job_status || null },
        diagnostics: {},
      });
    }

    if (
      onChain.amountXlm != null &&
      derived.amount_xlm != null &&
      String(derived.amount_xlm) !== String(onChain.amountXlm)
    ) {
      findings.push({
        divergenceClass: "projection_wrong_amount",
        expected: { amountXlm: onChain.amountXlm },
        actual: { amountXlm: derived.amount_xlm },
        diagnostics: {},
      });
    }

    return findings;
  }

  async getEventsForJob(jobId: any) {
    const { rows } = await this._query(
      `SELECT job_id, event_type, contract_id, tx_hash, ledger, data, created_at, source, schema_version, canonical
       FROM contract_events
       WHERE job_id = $1
         AND canonical = TRUE
       ORDER BY created_at ASC, ledger ASC`,
      [jobId]
    );
    return rows;
  }

  async start() {
    if (this.syncState.running) return;
    await this.loadCheckpoint(DEFAULT_EVENT_STREAM);
    await this.loadCheckpoint(DEFAULT_TX_STREAM);

    this.syncState.running = true;
    this.syncState.lastError = null;

    await this._startTransactionStream();
    await this._startEventStream();

    if (this.reconciliationIntervalMs > 0) {
      this.reconcileTimer = setInterval(() => {
        if (typeof this.sourceAdapter?.fetchOnChainEscrow === "function") {
          this.reconcileDerivedState({
            fetchOnChainEscrow: this.sourceAdapter.fetchOnChainEscrow.bind(this.sourceAdapter),
            mode: "continuous",
          }).catch((error) => {
            this._observeError(DEFAULT_EVENT_STREAM, "reconcile_interval", error);
          });
        }
      }, this.reconciliationIntervalMs);
      this.reconcileTimer.unref?.();
    }
  }

  async _startTransactionStream() {
    if (!this.platformWallet) return;
    const checkpoint = await this.loadCheckpoint(DEFAULT_TX_STREAM);
    const cursor = checkpoint?.last_ledger_sequence
      ? String(checkpoint.last_ledger_sequence)
      : "now";

    const handleMessage = async (tx: any) => {
      try {
        await this.processTransaction(tx);
        this._resetBackoff(DEFAULT_TX_STREAM);
      } catch (error: any) {
        this._observeError(DEFAULT_TX_STREAM, "transaction_stream", error);
        console.error("[Indexer] failed to process transaction:", error.message);
      }
    };

    const handleError = (error: any) => {
      this._observeError(DEFAULT_TX_STREAM, "transaction_stream_error", error);
      console.error("[Indexer] transaction stream error:", this.syncState.lastError);
      this._scheduleReconnect(DEFAULT_TX_STREAM, () => this._startTransactionStream());
    };

    if (this.sourceAdapter && typeof this.sourceAdapter.openTransactionStream === "function") {
      this.closeStream = this.sourceAdapter.openTransactionStream({
        cursor,
        onmessage: handleMessage,
        onerror: handleError,
      });
      return;
    }

    this.closeStream = this.horizon
      .transactions()
      .forAccount(this.platformWallet)
      .cursor(cursor)
      .stream({
        onmessage: handleMessage,
        onerror: handleError,
      });
  }

  async _startEventStream() {
    const checkpoint = await this.loadCheckpoint(DEFAULT_EVENT_STREAM);
    const cursor = checkpoint?.last_ledger_sequence
      ? String(checkpoint.last_ledger_sequence)
      : "now";

    const handleMessage = async (event: any) => {
      try {
        await this.processEvent(event);
        this._resetBackoff(DEFAULT_EVENT_STREAM);
      } catch (error: any) {
        this._observeError(DEFAULT_EVENT_STREAM, "event_stream", error);
        console.error("[Indexer] failed to process event:", error.message);
      }
    };

    const handleError = (error: any) => {
      this._observeError(DEFAULT_EVENT_STREAM, "event_stream_error", error);
      console.error("[Indexer] event stream error:", this.syncState.lastError);
      this._scheduleReconnect(DEFAULT_EVENT_STREAM, () => this._startEventStream());
    };

    if (this.sourceAdapter && typeof this.sourceAdapter.openEventStream === "function") {
      this.closeEventStream = this.sourceAdapter.openEventStream({
        cursor,
        contractId: this.contractId,
        onmessage: handleMessage,
        onerror: handleError,
      });
      return;
    }

    this.closeEventStream = this.horizon.events().cursor(cursor).stream({
      onmessage: handleMessage,
      onerror: handleError,
    });
  }

  stop() {
    if (typeof this.closeStream === "function") this.closeStream();
    if (typeof this.closeEventStream === "function") this.closeEventStream();
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.closeStream = null;
    this.closeEventStream = null;
    this.reconcileTimer = null;
    this.syncState.running = false;
  }

  getHealth() {
    return {
      ...this.syncState,
      singleWriterRequired: true,
      sideEffectsEnabled: this.sideEffectsEnabled,
    };
  }
}

module.exports = IndexerService;
module.exports.sleep = sleep;
module.exports.DEFAULT_EVENT_STREAM = DEFAULT_EVENT_STREAM;
module.exports.DEFAULT_TX_STREAM = DEFAULT_TX_STREAM;
