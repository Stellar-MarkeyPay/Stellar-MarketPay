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
  function makeIndexer(cdnInvalidation) {
    return new IndexerService({
      platformWallet: "GPLATFORM",
      contractId: "CONTRACT1",
      broadcast: jest.fn(),
      cdnInvalidation,
    });
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
