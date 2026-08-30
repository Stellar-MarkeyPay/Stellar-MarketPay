"use strict";

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: { Server: jest.fn().mockImplementation(() => ({})) },
}));

jest.mock("../db/pool", () => ({
  query: jest.fn(),
  connect: jest.fn(),
}));

const IndexerService = require("./indexerService");

function makeEvent({
  ledger,
  ledgerHash,
  parentLedgerHash,
  type,
  jobId = "550e8400-e29b-41d4-a716-446655440000",
  txHash,
  schemaVersion = 1,
}) {
  return {
    contract_id: "CONTRACT1",
    transaction_hash: txHash || `tx-${ledger}-${type}`,
    ledger,
    ledger_hash: ledgerHash || `hash-${ledger}-${type}`,
    parent_ledger_hash: parentLedgerHash || (ledger > 1 ? `hash-${ledger - 1}-prev` : null),
    ledger_closed_at: new Date(Date.UTC(2026, 7, 26, 12, 0, ledger)).toISOString(),
    topic: [type, jobId],
    value: { schema_version: schemaVersion, job_id: jobId },
  };
}

class MemoryIndexerService extends IndexerService {
  constructor(options = {}) {
    const broadcasts = [];
    super({
      platformWallet: "GPLATFORM",
      contractId: "CONTRACT1",
      broadcast: (channel, payload) => {
        broadcasts.push({ channel, payload });
      },
      cdnInvalidation: options.cdnInvalidation || null,
      sideEffectsEnabled: options.sideEffectsEnabled ?? true,
      clock: () => new Date("2026-08-26T12:00:00.000Z"),
      supportedSchemaVersions: options.supportedSchemaVersions || new Set([1]),
    });

    this.broadcasts = broadcasts;
    this.failOnSaveCheckpoint = false;
    this.memory = {
      checkpoints: new Map(),
      batches: new Map(),
      rawEvents: new Map(),
      lineage: new Map(),
      reorgs: new Map(),
      reconciliationRuns: new Map(),
      appliedEffects: new Map(),
      findings: [],
      jobs: new Map(),
      escrows: new Map(),
      contractEvents: [],
      outbox: new Map(),
    };
  }

  _lineageKey(source, ledger) {
    return `${source}:${ledger}`;
  }

  async _withTransaction(fn) {
    const original = this.memory;
    this.memory = structuredClone(this.memory);
    try {
      const result = await fn({});
      return result;
    } catch (error) {
      this.memory = original;
      throw error;
    }
  }

  async _query(sql, params = []) {
    const normalizedSql = sql.replace(/\s+/g, " ").trim();

    if (normalizedSql.startsWith("INSERT INTO indexer_reconciliation_runs")) {
      const runId = `run:${this.memory.reconciliationRuns.size + 1}`;
      this.memory.reconciliationRuns.set(runId, {
        run_id: runId,
        mode: params[0],
        from_ledger: params[1] ?? null,
        to_ledger: params[2] ?? null,
        status: "running",
        summary: {},
      });
      return { rows: [{ run_id: runId }] };
    }

    if (normalizedSql.startsWith("SELECT DISTINCT job_id FROM indexer_raw_events")) {
      const [source, fromLedger, toLedger] = params;
      const rows = [...this.memory.rawEvents.values()]
        .filter(
          (event) =>
            event.source === source &&
            event.canonical === true &&
            event.jobId &&
            (fromLedger == null || event.ledgerSequence >= fromLedger) &&
            (toLedger == null || event.ledgerSequence <= toLedger)
        )
        .map((event) => event.jobId)
        .filter((value, index, array) => array.indexOf(value) === index)
        .map((job_id) => ({ job_id }));
      return { rows };
    }

    if (normalizedSql.startsWith("UPDATE indexer_reconciliation_runs")) {
      const [runId, summary] = params;
      const run = this.memory.reconciliationRuns.get(runId);
      if (run) {
        run.status = normalizedSql.includes("status = 'failed'") ? "failed" : "completed";
        run.summary = typeof summary === "string" ? JSON.parse(summary) : summary;
      }
      return { rows: [] };
    }

    if (normalizedSql.startsWith("UPDATE indexer_state SET last_reconciled_at = NOW()")) {
      this.syncState.lastReconciledAt = "2026-08-26T12:00:00.000Z";
      return { rows: [] };
    }

    if (
      normalizedSql.startsWith(
        "SELECT job_id, event_type, contract_id, tx_hash, ledger, data, created_at, source, schema_version, canonical FROM contract_events"
      )
    ) {
      const [jobId] = params;
      return {
        rows: this.memory.contractEvents.filter(
          (event) => event.job_id === jobId && event.canonical === true
        ),
      };
    }

    return { rows: [] };
  }

  async loadCheckpoint(streamName = "contract_events") {
    const checkpoint = this.memory.checkpoints.get(streamName) || null;
    if (streamName === "contract_events" && checkpoint) {
      this.syncState.lastProcessedLedger = checkpoint.last_ledger_sequence;
      this.syncState.lastEventUid = checkpoint.last_event_uid;
    }
    return checkpoint;
  }

  async saveCheckpoint({ streamName = "contract_events", ledger, ledgerHash, eventUid }) {
    if (this.failOnSaveCheckpoint) {
      throw new Error("simulated checkpoint crash");
    }
    const checkpoint = {
      stream_name: streamName,
      last_ledger_sequence: ledger || null,
      last_ledger_hash: ledgerHash || null,
      last_event_uid: eventUid || null,
      updated_at: "2026-08-26T12:00:00.000Z",
    };
    this.memory.checkpoints.set(streamName, checkpoint);
    if (streamName === "contract_events") {
      this.syncState.lastProcessedLedger = ledger || null;
      this.syncState.lastEventUid = eventUid || null;
      this.syncState.synced = true;
    }
  }

  async _createBatch(_client, { source, batchKind, fromLedger, toLedger, details = {} }) {
    const batchId = `${source}:${this.memory.batches.size + 1}`;
    this.memory.batches.set(batchId, {
      source,
      batch_kind: batchKind,
      from_ledger: fromLedger,
      to_ledger: toLedger,
      status: "pending",
      details,
    });
    return batchId;
  }

  async _finalizeBatch(_client, batchId, status = "applied") {
    const batch = this.memory.batches.get(batchId);
    if (batch) batch.status = status;
  }

  async _getLineageRecord(_client, source, ledgerSequence) {
    return this.memory.lineage.get(this._lineageKey(source, ledgerSequence)) || null;
  }

  async _upsertLineageRecord(_client, source, record) {
    this.memory.lineage.set(this._lineageKey(source, record.ledgerSequence), {
      source,
      ledger_sequence: record.ledgerSequence,
      ledger_hash: record.ledgerHash || null,
      parent_ledger_hash: record.parentLedgerHash || null,
      closed_at: record.occurredAt || null,
    });
  }

  async _insertRawEvent(_client, batchId, record) {
    const existing = this.memory.rawEvents.get(record.eventUid);
    const changed =
      !existing ||
      !existing.canonical ||
      JSON.stringify(existing.payload || {}) !== JSON.stringify(record.payload || {});

    this.memory.rawEvents.set(record.eventUid, {
      eventUid: record.eventUid,
      batchId,
      source: record.source,
      ledgerSequence: record.ledgerSequence,
      ledgerHash: record.ledgerHash || null,
      parentLedgerHash: record.parentLedgerHash || null,
      txHash: record.txHash || null,
      eventIndex: record.eventIndex || 0,
      eventType: record.eventType,
      schemaVersion: record.schemaVersion || 1,
      jobId: record.jobId || null,
      payload: structuredClone(record.payload || {}),
      occurredAt: record.occurredAt || null,
      canonical: true,
      supersededByReorgId: null,
    });

    return changed;
  }

  async _getImpactedJobsFromLedger(_client, source, fromLedger) {
    return [...this.memory.rawEvents.values()]
      .filter(
        (event) =>
          event.source === source &&
          event.canonical === true &&
          event.ledgerSequence >= fromLedger &&
          event.jobId
      )
      .map((event) => event.jobId)
      .filter((value, index, array) => array.indexOf(value) === index);
  }

  async _createReorgJournalEntry(_client, source, details) {
    const reorgId = `reorg:${this.memory.reorgs.size + 1}`;
    this.memory.reorgs.set(reorgId, { source, details, status: "detected" });
    return reorgId;
  }

  async _completeReorgJournalEntry(_client, reorgId, status) {
    const reorg = this.memory.reorgs.get(reorgId);
    if (reorg) reorg.status = status;
  }

  async _markRawEventsNonCanonicalFromLedger(_client, source, fromLedger, reorgId) {
    for (const event of this.memory.rawEvents.values()) {
      if (event.source === source && event.canonical && event.ledgerSequence >= fromLedger) {
        event.canonical = false;
        event.supersededByReorgId = reorgId;
      }
    }

    for (const effect of this.memory.appliedEffects.values()) {
      const raw = this.memory.rawEvents.get(effect.eventUid);
      if (raw && raw.source === source && raw.ledgerSequence >= fromLedger) {
        effect.rolledBackAt = "2026-08-26T12:00:00.000Z";
      }
    }

    for (const outbox of this.memory.outbox.values()) {
      const raw = this.memory.rawEvents.get(outbox.eventUid);
      if (raw && raw.source === source && raw.ledgerSequence >= fromLedger) {
        outbox.suppressed = true;
      }
    }

    for (const key of [...this.memory.lineage.keys()]) {
      const [, ledgerPart] = key.split(":");
      const ledger = Number(ledgerPart);
      if (key.startsWith(`${source}:`) && ledger >= fromLedger) {
        this.memory.lineage.delete(key);
      }
    }
  }

  async _recordAppliedEffect(_client, record, effectType, targetTable, targetKey) {
    this.memory.appliedEffects.set(`${effectType}:${record.eventUid}`, {
      effectUid: `${effectType}:${record.eventUid}`,
      eventUid: record.eventUid,
      effectType,
      targetTable,
      targetKey,
      replaySafe: true,
      rolledBackAt: null,
    });
  }

  async _enqueueOutbox(_client, record, sideEffect, payload, suppressed) {
    this.memory.outbox.set(`${record.eventUid}:${sideEffect}`, {
      outboxUid: `${record.eventUid}:${sideEffect}`,
      eventUid: record.eventUid,
      sideEffect,
      payload: structuredClone(payload),
      suppressed: Boolean(suppressed),
      dispatchedAt: null,
    });
  }

  async _recordFinding(
    _client,
    {
      runId = null,
      divergenceClass,
      jobId = null,
      ledgerSequence = null,
      expected,
      actual,
      diagnostics,
    }
  ) {
    this.memory.findings.push({
      runId,
      divergenceClass,
      jobId,
      ledgerSequence,
      expected,
      actual,
      diagnostics,
    });
  }

  async _fetchCanonicalEventsForJob(_client, jobId) {
    return [...this.memory.rawEvents.values()]
      .filter((event) => event.canonical && event.jobId === jobId)
      .sort((left, right) => {
        if (left.ledgerSequence !== right.ledgerSequence) {
          return left.ledgerSequence - right.ledgerSequence;
        }
        return left.eventIndex - right.eventIndex;
      });
  }

  async _rebuildJobProjection(_client, jobId) {
    const events = await this._fetchCanonicalEventsForJob(null, jobId);
    if (!events.length) return;

    const projection = this._projectJobState(events);
    for (const event of projection.unsupportedEvents) {
      this.memory.findings.push({
        runId: null,
        divergenceClass: "unknown_schema_version",
        jobId,
        ledgerSequence: event.ledgerSequence,
        expected: { supportedSchemaVersions: Array.from(this.supportedSchemaVersions) },
        actual: { schemaVersion: event.schemaVersion, eventType: event.eventType },
        diagnostics: { eventUid: event.eventUid },
      });
    }

    this.memory.escrows.set(jobId, {
      job_id: jobId,
      status: projection.escrowStatus,
      released_at: projection.releasedAt || null,
    });

    if (projection.jobStatus) {
      this.memory.jobs.set(jobId, { id: jobId, status: projection.jobStatus });
    }
  }

  async _refreshContractEventProjection(_client, jobIds) {
    const impacted = new Set(jobIds);
    this.memory.contractEvents = this.memory.contractEvents.filter(
      (event) => !impacted.has(event.job_id)
    );
    for (const jobId of impacted) {
      const events = await this._fetchCanonicalEventsForJob(null, jobId);
      for (const event of events) {
        this.memory.contractEvents.push({
          event_uid: event.eventUid,
          job_id: jobId,
          event_type: event.eventType,
          tx_hash: event.txHash,
          ledger: event.ledgerSequence,
          data: structuredClone(event.payload || {}),
          created_at: event.occurredAt,
          source: event.source,
          schema_version: event.schemaVersion,
          canonical: true,
        });
      }
    }
    this.memory.contractEvents.sort((left, right) => {
      if (left.ledger !== right.ledger) return left.ledger - right.ledger;
      return String(left.event_uid).localeCompare(String(right.event_uid));
    });
  }

  async flushOutbox() {
    let dispatched = 0;
    for (const row of this.memory.outbox.values()) {
      if (row.suppressed || row.dispatchedAt) continue;
      await this._dispatchOutboxRow(row);
      row.dispatchedAt = "2026-08-26T12:00:00.000Z";
      dispatched += 1;
    }
    return { dispatched };
  }

  async _dispatchOutboxRow(row) {
    if (row.sideEffect === "broadcast:contract:event") {
      this.broadcast("contract:event", row.payload);
      return;
    }
    if (row.sideEffect === "broadcast:job:status-changed") {
      this.broadcast("job:status-changed", row.payload);
      return;
    }
    if (row.sideEffect === "cdn:contract-event" && this.cdnInvalidation) {
      await this.cdnInvalidation.handleContractEvent(
        row.payload.eventType,
        row.payload.jobId,
        row.payload
      );
    }
  }

  async _getDerivedEscrow(jobId) {
    const escrow = this.memory.escrows.get(jobId);
    const job = this.memory.jobs.get(jobId);
    if (!escrow) return null;
    return {
      job_id: jobId,
      escrow_status: escrow.status,
      released_at: escrow.released_at,
      job_status: job?.status || null,
    };
  }

  async getEventsForJob(jobId) {
    return this.memory.contractEvents.filter(
      (event) => event.job_id === jobId && event.canonical === true
    );
  }

  snapshotDerivedState() {
    return JSON.stringify(
      {
        checkpoints: Object.fromEntries(this.memory.checkpoints),
        jobs: Object.fromEntries(this.memory.jobs),
        escrows: Object.fromEntries(this.memory.escrows),
        contractEvents: this.memory.contractEvents,
        rawEvents: [...this.memory.rawEvents.values()]
          .filter((event) => event.canonical)
          .sort((left, right) => left.ledgerSequence - right.ledgerSequence)
          .map((event) => ({
            eventUid: event.eventUid,
            ledgerSequence: event.ledgerSequence,
            eventType: event.eventType,
            jobId: event.jobId,
          })),
        appliedEffects: [...this.memory.appliedEffects.values()]
          .filter((effect) => !effect.rolledBackAt)
          .sort((left, right) => left.effectUid.localeCompare(right.effectUid)),
      },
      null,
      2
    );
  }
}

describe("IndexerService reliability hardening", () => {
  test("replaying the same ledger range yields byte-identical derived state", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440001";
    const events = [
      makeEvent({
        ledger: 1,
        ledgerHash: "L1",
        parentLedgerHash: null,
        type: "escrow_created",
        jobId,
      }),
      makeEvent({
        ledger: 2,
        ledgerHash: "L2",
        parentLedgerHash: "L1",
        type: "work_started",
        jobId,
      }),
      makeEvent({
        ledger: 3,
        ledgerHash: "L3",
        parentLedgerHash: "L2",
        type: "escrow_released",
        jobId,
      }),
    ];

    await indexer.ingestLedgerRange(events, { mode: "replay", suppressSideEffects: true });
    const firstSnapshot = indexer.snapshotDerivedState();

    const replayResult = await indexer.replayLedgerRange({
      fromLedger: 1,
      toLedger: 3,
      fetchCanonicalRange: async () => events,
      productionSafe: true,
    });
    const secondSnapshot = indexer.snapshotDerivedState();

    expect(replayResult.appliedEvents).toBe(0);
    expect(firstSnapshot).toBe(secondSnapshot);
    expect(indexer.broadcasts).toEqual([]);
    expect(await indexer.getEventsForJob(jobId)).toHaveLength(3);
  });

  test("a simulated reorg is detected, rolled back, and re-applied correctly", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440002";
    const originalBranch = [
      makeEvent({
        ledger: 1,
        ledgerHash: "A1",
        parentLedgerHash: null,
        type: "escrow_created",
        jobId,
      }),
      makeEvent({
        ledger: 2,
        ledgerHash: "A2",
        parentLedgerHash: "A1",
        type: "work_started",
        jobId,
      }),
      makeEvent({
        ledger: 3,
        ledgerHash: "A3",
        parentLedgerHash: "A2",
        type: "escrow_released",
        jobId,
      }),
    ];
    const replacementBranch = [
      makeEvent({
        ledger: 2,
        ledgerHash: "B2",
        parentLedgerHash: "A1",
        type: "escrow_disputed",
        jobId,
      }),
      makeEvent({
        ledger: 3,
        ledgerHash: "B3",
        parentLedgerHash: "B2",
        type: "escrow_refunded",
        jobId,
      }),
    ];

    await indexer.ingestLedgerRange(originalBranch, { mode: "live" });
    const reorgResult = await indexer.ingestLedgerRange(replacementBranch, { mode: "live" });
    const derived = await indexer._getDerivedEscrow(jobId);
    const publicEvents = await indexer.getEventsForJob(jobId);

    expect(reorgResult.reorgHandled).toBe(true);
    expect(derived.escrow_status).toBe("refunded");
    expect(derived.job_status).toBe("cancelled");
    expect(publicEvents.map((event) => event.event_type)).toEqual([
      "escrow_created",
      "dispute_opened",
      "escrow_refunded",
    ]);
    expect(indexer.syncState.reorgCount).toBe(1);
  });

  test("a crash mid-batch rolls back state so retry neither loses nor double-applies events", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440003";
    const events = [
      makeEvent({
        ledger: 10,
        ledgerHash: "C10",
        parentLedgerHash: "C9",
        type: "escrow_created",
        jobId,
      }),
      makeEvent({
        ledger: 11,
        ledgerHash: "C11",
        parentLedgerHash: "C10",
        type: "escrow_released",
        jobId,
      }),
    ];

    indexer.failOnSaveCheckpoint = true;
    await expect(indexer.ingestLedgerRange(events, { mode: "live" })).rejects.toThrow(
      "simulated checkpoint crash"
    );
    expect(indexer.snapshotDerivedState()).toContain('"contractEvents": []');
    expect(indexer.memory.rawEvents.size).toBe(0);

    indexer.failOnSaveCheckpoint = false;
    const retryResult = await indexer.ingestLedgerRange(events, { mode: "live" });
    const derived = await indexer._getDerivedEscrow(jobId);

    expect(retryResult.appliedEvents).toBe(2);
    expect(derived.escrow_status).toBe("released");
    expect(indexer.memory.rawEvents.size).toBe(2);
    expect(
      [...indexer.memory.appliedEffects.values()].filter((effect) => !effect.rolledBackAt)
    ).toHaveLength(2);
  });

  test("gaps are detected and filled instead of skipped", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440004";
    const gapEvent = makeEvent({
      ledger: 2,
      ledgerHash: "G2",
      parentLedgerHash: "G1",
      type: "work_started",
      jobId,
    });

    const result = await indexer.ingestLedgerRange(
      [
        makeEvent({
          ledger: 1,
          ledgerHash: "G1",
          parentLedgerHash: null,
          type: "escrow_created",
          jobId,
        }),
        makeEvent({
          ledger: 3,
          ledgerHash: "G3",
          parentLedgerHash: "G2",
          type: "escrow_released",
          jobId,
        }),
      ],
      {
        mode: "live",
        fetchMissingRange: async ({ fromLedger, toLedger }) => {
          expect(fromLedger).toBe(2);
          expect(toLedger).toBe(2);
          return [gapEvent];
        },
      }
    );

    const events = await indexer.getEventsForJob(jobId);
    expect(result.lastLedger).toBe(3);
    expect(indexer.syncState.gapCount).toBe(1);
    expect(events.map((event) => event.event_type)).toEqual([
      "escrow_created",
      "work_started",
      "escrow_released",
    ]);
  });

  test("replay in production-safe mode does not re-fire notifications or CDN side effects", async () => {
    const cdnInvalidation = { handleContractEvent: jest.fn().mockResolvedValue({ ok: true }) };
    const indexer = new MemoryIndexerService({ cdnInvalidation, sideEffectsEnabled: true });
    const jobId = "550e8400-e29b-41d4-a716-446655440005";
    const events = [
      makeEvent({
        ledger: 1,
        ledgerHash: "R1",
        parentLedgerHash: null,
        type: "escrow_created",
        jobId,
      }),
      makeEvent({
        ledger: 2,
        ledgerHash: "R2",
        parentLedgerHash: "R1",
        type: "escrow_released",
        jobId,
      }),
    ];

    await indexer.ingestLedgerRange(events, { mode: "live" });
    expect(indexer.broadcasts.length).toBeGreaterThan(0);
    expect(cdnInvalidation.handleContractEvent).toHaveBeenCalledTimes(2);

    indexer.broadcasts.length = 0;
    cdnInvalidation.handleContractEvent.mockClear();

    await indexer.replayLedgerRange({
      fromLedger: 1,
      toLedger: 2,
      fetchCanonicalRange: async () => events,
      productionSafe: true,
    });

    expect(indexer.broadcasts).toEqual([]);
    expect(cdnInvalidation.handleContractEvent).not.toHaveBeenCalled();
  });

  test("unsupported schema versions are retained but surfaced as reconciliation findings", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440006";
    await indexer.ingestLedgerRange(
      [
        makeEvent({
          ledger: 1,
          ledgerHash: "S1",
          parentLedgerHash: null,
          type: "escrow_created",
          jobId,
        }),
        makeEvent({
          ledger: 2,
          ledgerHash: "S2",
          parentLedgerHash: "S1",
          type: "work_started",
          jobId,
          schemaVersion: 99,
        }),
      ],
      { mode: "live" }
    );

    expect(indexer.memory.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          divergenceClass: "unknown_schema_version",
          jobId,
          actual: expect.objectContaining({ schemaVersion: 99 }),
        }),
      ])
    );
  });

  test("reconciliation classifies divergence instead of silently correcting it", async () => {
    const indexer = new MemoryIndexerService();
    const jobId = "550e8400-e29b-41d4-a716-446655440007";
    await indexer.ingestLedgerRange(
      [
        makeEvent({
          ledger: 1,
          ledgerHash: "Q1",
          parentLedgerHash: null,
          type: "escrow_created",
          jobId,
        }),
        makeEvent({
          ledger: 2,
          ledgerHash: "Q2",
          parentLedgerHash: "Q1",
          type: "escrow_released",
          jobId,
        }),
      ],
      { mode: "live" }
    );

    const result = await indexer.reconcileDerivedState({
      fetchOnChainEscrow: async () => ({ escrowStatus: "refunded", jobStatus: "cancelled" }),
      jobIds: [jobId],
      mode: "continuous",
    });

    expect(result.findings).toBe(1);
    expect(indexer.memory.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          divergenceClass: "projection_wrong_status",
          jobId,
        }),
      ])
    );
  });
});
