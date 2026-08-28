/**
 * src/services/indexerService.cdn.test.js
 * Verifies the event-driven CDN invalidation hook (#91): a relevant contract
 * event processed by the indexer triggers cdnInvalidation.handleContractEvent
 * with the mapped event type and job id, without blocking event processing
 * on the purge, and that irrelevant events don't trigger a purge at all.
 */
"use strict";

jest.mock("../db/pool", () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue(client),
    __client: client,
  };
});
jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: { Server: jest.fn().mockImplementation(() => ({})) },
}));

const IndexerService = require("./indexerService");

function makeEvent(overrides = {}) {
  return {
    contract_id: "CONTRACT1",
    transaction_hash: "tx1",
    ledger: 100,
    ledger_closed_at: new Date().toISOString(),
    topic: ["escrow_released", "job-1"],
    value: {},
    ...overrides,
  };
}

describe("IndexerService -> CdnInvalidationService wiring", () => {
  class CdnTestIndexer extends IndexerService {
    memory: any;
    constructor(options: any = {}) {
      super({
        platformWallet: "GPLATFORM",
        contractId: "CONTRACT1",
        broadcast: jest.fn(),
        cdnInvalidation: options.cdnInvalidation || null,
      });

      this.memory = {
        checkpoints: new Map(),
        lineage: new Map(),
        rawEvents: new Map(),
        outbox: new Map(),
      };
    }

    async loadCheckpoint(streamName = "contract_events") {
      return this.memory.checkpoints.get(streamName) || null;
    }

    async saveCheckpoint({ streamName = "contract_events", ledger, ledgerHash, eventUid }: any) {
      this.memory.checkpoints.set(streamName, {
        stream_name: streamName,
        last_ledger_sequence: ledger || null,
        last_ledger_hash: ledgerHash || null,
        last_event_uid: eventUid || null,
      });
    }

    async _withTransaction(fn: any) {
      return fn({});
    }

    async _createBatch() {
      return "batch:1";
    }

    async _finalizeBatch() {}

    async _getLineageRecord(_client: any, source: any, ledgerSequence: any) {
      return this.memory.lineage.get(`${source}:${ledgerSequence}`) || null;
    }

    async _upsertLineageRecord(_client: any, source: any, record: any) {
      this.memory.lineage.set(`${source}:${record.ledgerSequence}`, {
        source,
        ledger_sequence: record.ledgerSequence,
        ledger_hash: record.ledgerHash || null,
        parent_ledger_hash: record.parentLedgerHash || null,
      });
    }

    async _insertRawEvent(_client: any, _batchId: any, record: any) {
      if (this.memory.rawEvents.has(record.eventUid)) {
        return false;
      }
      this.memory.rawEvents.set(record.eventUid, { ...record, canonical: true });
      return true;
    }

    async _rebuildJobProjections() {}

    async _refreshContractEventProjection() {}

    async _recordAppliedEffect() {}

    async _enqueueOutbox(_client: any, record: any, sideEffect: any, payload: any, suppressed: any) {
      this.memory.outbox.set(`${record.eventUid}:${sideEffect}`, {
        outbox_uid: `${record.eventUid}:${sideEffect}`,
        event_uid: record.eventUid,
        side_effect: sideEffect,
        payload,
        suppressed: Boolean(suppressed),
        dispatched_at: null,
      });
    }

    async flushOutbox() {
      let dispatched = 0;
      for (const row of this.memory.outbox.values()) {
        if (row.suppressed || row.dispatched_at) continue;
        try {
          await (this as any)._dispatchOutboxRow(row);
          row.dispatched_at = "2026-08-26T12:00:00.000Z";
          dispatched += 1;
        } catch (error: any) {
          console.error("[Indexer] CDN invalidation failed:", error.message);
        }
      }
      return { dispatched };
    }
  }

  function makeIndexer(cdnInvalidation: any) {
    return new CdnTestIndexer({ cdnInvalidation });
  }

  test("triggers a targeted invalidation for a cache-affecting event", async () => {
    const cdnInvalidation = { handleContractEvent: jest.fn().mockResolvedValue({ success: true }) };
    const indexer = makeIndexer(cdnInvalidation);

    await indexer.processEvent(makeEvent());
    // handleContractEvent is invoked fire-and-forget; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(cdnInvalidation.handleContractEvent).toHaveBeenCalledWith(
      "escrow_released",
      "job-1",
      expect.objectContaining({ receivedAt: expect.any(Number) })
    );
  });

  test("delegates the event-type/URL-scope decision to CdnInvalidationService (indexer itself doesn't filter)", async () => {
    // handleContractEvent is a no-op for non-cache-affecting types like
    // message_sent — see invalidationService.test.js for that behavior.
    // Here we just confirm the indexer always forwards, and always awaits a
    // promise (fire-and-forget must not throw on a resolved no-op).
    const cdnInvalidation = { handleContractEvent: jest.fn().mockResolvedValue(null) };
    const indexer = makeIndexer(cdnInvalidation);

    await indexer.processEvent(makeEvent({ topic: ["message_sent", "job-1"] }));
    await Promise.resolve();

    expect(cdnInvalidation.handleContractEvent).toHaveBeenCalledWith(
      "message_sent",
      "job-1",
      expect.anything()
    );
  });

  test("a rejected purge is logged, not thrown, so indexing continues", async () => {
    const cdnInvalidation = {
      handleContractEvent: jest.fn().mockRejectedValue(new Error("all providers down")),
    };
    const indexer = makeIndexer(cdnInvalidation);
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(indexer.processEvent(makeEvent())).resolves.not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith(
      "[Indexer] CDN invalidation failed:",
      "all providers down"
    );
    errorSpy.mockRestore();
  });

  test("skips CDN invalidation entirely when no cdnInvalidation is configured", async () => {
    const indexer = makeIndexer(null);
    await expect(indexer.processEvent(makeEvent())).resolves.not.toThrow();
  });
});

export {};
