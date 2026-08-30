// escrowReconciliationJob.test.js

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));
jest.mock("../contracts/escrowClient", () => ({
  getEscrowOnChain: jest.fn(),
}));
jest.mock("../metrics/escrowReconciliationMetrics", () => ({
  escrowReconciliationMismatchCounter: {
    inc: jest.fn(),
  },
}));
jest.mock("../utils/logger", () => {
  const original = jest.requireActual("../utils/logger");
  return {
    ...original,
    createServiceLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }),
  };
});

const pool = require("../db/pool");
const { getEscrowOnChain } = require("../contracts/escrowClient");
const { escrowReconciliationMismatchCounter } = require("../metrics/escrowReconciliationMetrics");
const { runReconciliation } = require("../jobs/escrowReconciliationJob");

describe("Escrow Reconciliation Job", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test("no mismatches – does not inc counter", async () => {
    const dbEscrow = {
      job_id: "job123",
      status: "active",
      client_address: "GCLIENT",
      freelancer_address: "GFREELANCER",
      amount_xlm: "100",
    };
    pool.query.mockResolvedValueOnce({ rows: [dbEscrow] });
    getEscrowOnChain.mockResolvedValue({
      status: "active",
      client: "GCLIENT",
      freelancer: "GFREELANCER",
      amount: "100",
    });

    await runReconciliation();
    expect(escrowReconciliationMismatchCounter.inc).not.toHaveBeenCalled();
  });

  test("field mismatch – increments counter with type field_mismatch", async () => {
    const dbEscrow = {
      job_id: "job456",
      status: "active",
      client_address: "GCLIENT",
      freelancer_address: "GFREELANCER",
      amount_xlm: "200",
    };
    pool.query.mockResolvedValueOnce({ rows: [dbEscrow] });
    // on‑chain has different status and amount
    getEscrowOnChain.mockResolvedValue({
      status: "released",
      client: "GCLIENT",
      freelancer: "GFREELANCER",
      amount: "200",
    });

    await runReconciliation();
    expect(escrowReconciliationMismatchCounter.inc).toHaveBeenCalledWith({
      type: "field_mismatch",
    });
  });

  test("missing on‑chain data – increments counter with type missing_onchain", async () => {
    const dbEscrow = {
      job_id: "job789",
      status: "active",
      client_address: "GCLIENT",
      freelancer_address: "GFREELANCER",
      amount_xlm: "300",
    };
    pool.query.mockResolvedValueOnce({ rows: [dbEscrow] });
    getEscrowOnChain.mockResolvedValue(null);

    await runReconciliation();
    expect(escrowReconciliationMismatchCounter.inc).toHaveBeenCalledWith({
      type: "missing_onchain",
    });
  });
});
