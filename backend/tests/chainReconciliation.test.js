"use strict";

const { ChainReconciliationService } = require("../src/services/chainReconciliationService");
const pool = require("../src/db/pool");

describe("ChainReconciliationService", () => {
  let reconciler;

  beforeEach(() => {
    jest.clearAllMocks();
    reconciler = new ChainReconciliationService({
      horizonUrl: "https://horizon-testnet.stellar.org",
      contractId: "CDUMMYCONTRACTID",
    });
  });

  it("detects and heals escrow state when database lagged behind on-chain release", async () => {
    const mockEscrows = [
      {
        id: "escrow-1",
        job_id: "job-1",
        contract_id: "contract-1",
        amount_xlm: "500",
        status: "funded",
        job_status: "in_progress",
      },
    ];

    const mockEventRows = [
      {
        event_type: "escrow_released",
        contract_tx_hash: "0x123abc",
        created_at: new Date(),
      },
    ];

    jest.spyOn(pool, "query").mockImplementation(async (sql) => {
      if (typeof sql === "string" && sql.includes("FROM escrows")) {
        return { rows: mockEscrows };
      }
      if (typeof sql === "string" && sql.includes("FROM contract_events")) {
        return { rows: mockEventRows };
      }
      if (typeof sql === "string" && sql.includes("UPDATE escrows")) {
        return { rowCount: 1 };
      }
      if (typeof sql === "string" && sql.includes("UPDATE jobs")) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    });

    const result = await reconciler.reconcileEscrows({ dryRun: false });

    expect(result.totalChecked).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0]).toMatchObject({
      jobId: "job-1",
      dbStatus: "funded",
      onChainStatus: "released",
    });
  });

  it("supports dry-run mode without modifying the database", async () => {
    const mockEscrows = [
      {
        id: "escrow-2",
        job_id: "job-2",
        contract_id: "contract-2",
        amount_xlm: "250",
        status: "funded",
        job_status: "in_progress",
      },
    ];

    const mockEventRows = [
      {
        event_type: "escrow_refunded",
        contract_tx_hash: "0x456def",
        created_at: new Date(),
      },
    ];

    const querySpy = jest.spyOn(pool, "query").mockImplementation(async (sql) => {
      if (typeof sql === "string" && sql.includes("FROM escrows")) {
        return { rows: mockEscrows };
      }
      if (typeof sql === "string" && sql.includes("FROM contract_events")) {
        return { rows: mockEventRows };
      }
      return { rows: [] };
    });

    const result = await reconciler.reconcileEscrows({ dryRun: true });

    expect(result.discrepancies).toHaveLength(1);
    expect(result.reconciled).toBe(0); // Dry-run does not modify rows

    // Verify no UPDATE queries executed
    const updateCalls = querySpy.mock.calls.filter(
      ([sql]) => typeof sql === "string" && sql.includes("UPDATE")
    );
    expect(updateCalls).toHaveLength(0);
  });
});
