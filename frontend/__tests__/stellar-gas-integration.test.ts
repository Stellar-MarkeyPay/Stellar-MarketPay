/**
 * __tests__/stellar-gas-integration.test.ts
 *
 * Tests that transaction builders in stellar.ts use the dynamic gas estimator
 * (fetchDynamicFeeTiers / pickTierFeeStroops) and gracefully fall back to
 * BASE_FEE when the estimator is unavailable.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Prevent env validation from throwing during module load
jest.mock("@/lib/env", () => ({
  optionalClientEnv: (_key: string, fallback: string) => fallback,
  requireClientEnv: (_key: string) => "MOCK_CONTRACT_ID",
}));

// Mock config/tokens
jest.mock("@/lib/config/tokens", () => ({
  getUsdcContractId: () => "MOCK_USDC_CONTRACT",
  USDC_CONTRACT_BY_NETWORK: {},
}));

// Mock sorobanFees so we can control what the estimator returns
jest.mock("@/lib/sorobanFees", () => ({
  fetchDynamicFeeTiers: jest.fn(),
  pickTierFeeStroops: jest.fn(),
  stroopsToXlm: jest.fn(),
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
}));

// Minimal stellar-sdk mock — we only need TransactionBuilder + helpers
jest.mock("@stellar/stellar-sdk", () => {
  const BASE_FEE = "100";
  const MockTx = {
    toXDR: () => "mock-xdr",
    fee: "100",
  };
  const MockBuilder = {
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    addMemo: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue(MockTx),
  };
  return {
    Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
    TransactionBuilder: jest.fn().mockImplementation(() => MockBuilder),
    Transaction: jest.fn(),
    BASE_FEE,
    Contract: jest.fn().mockImplementation(() => ({ call: jest.fn() })),
    Address: { fromString: jest.fn().mockReturnValue({ toScVal: jest.fn() }) },
    nativeToScVal: jest.fn(),
    xdr: {},
    Horizon: { Server: jest.fn() },
    Operation: {
      payment: jest.fn().mockReturnValue({}),
    },
    Asset: Object.assign(jest.fn(), {
      native: jest.fn().mockReturnValue({}),
    }),
    Memo: { text: jest.fn() },
  };
});

// Mock the SorobanRpc module
jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn().mockImplementation(() => ({
    getAccount: jest.fn().mockResolvedValue({ id: "GTEST", sequence: "0" }),
    simulateTransaction: jest.fn().mockResolvedValue({ minResourceFee: "500" }),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
  })),
  Api: {
    isSimulationError: jest.fn().mockReturnValue(false),
    GetTransactionStatus: { SUCCESS: "SUCCESS", NOT_FOUND: "NOT_FOUND" },
  },
  assembleTransaction: jest.fn().mockReturnValue({
    build: jest.fn().mockReturnValue({ toXDR: () => "assembled-xdr" }),
  }),
}));

import { fetchDynamicFeeTiers, pickTierFeeStroops } from "@/lib/sorobanFees";
import { TransactionBuilder, BASE_FEE } from "@stellar/stellar-sdk";

const mockFetchDynamicFeeTiers = fetchDynamicFeeTiers as jest.Mock;
const mockPickTierFeeStroops = pickTierFeeStroops as jest.Mock;
const MockTransactionBuilder = TransactionBuilder as unknown as jest.Mock;

function makeEstimate(mediumFee = "1000") {
  return {
    slow:   { feeStroops: "350",       feeXlm: "0.000035",  label: "Slow",   estimatedWaitLedgers: 6 },
    medium: { feeStroops: mediumFee,   feeXlm: "0.0001",    label: "Medium", estimatedWaitLedgers: 2 },
    fast:   { feeStroops: "2500",      feeXlm: "0.00025",   label: "Fast",   estimatedWaitLedgers: 1 },
    spikeDetected: false,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("stellar.ts — dynamic fee integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: estimator returns a valid estimate, pickTierFeeStroops returns 1000
    mockFetchDynamicFeeTiers.mockResolvedValue(makeEstimate());
    mockPickTierFeeStroops.mockReturnValue(1000);
  });

  describe("buildCreateEscrowTx", () => {
    it("uses dynamic fee from the gas estimator (medium by default)", async () => {
      const { buildCreateEscrowTx } = await import("@/lib/stellar");
      await buildCreateEscrowTx({
        clientPublicKey: "GCLIENT000000000000000000000000000000000000000000000000000",
        jobId: "job-123",
        budget: 10,
      });

      expect(mockFetchDynamicFeeTiers).toHaveBeenCalledTimes(1);
      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: "1000" }),
      );
    });

    it("uses fast tier when feeTier='fast'", async () => {
      mockPickTierFeeStroops.mockReturnValue(2500);
      const { buildCreateEscrowTx } = await import("@/lib/stellar");
      await buildCreateEscrowTx({
        clientPublicKey: "GCLIENT000000000000000000000000000000000000000000000000000",
        jobId: "job-456",
        budget: 5,
        feeTier: "fast",
      });

      expect(mockPickTierFeeStroops).toHaveBeenCalledWith(expect.anything(), "fast");
      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: "2500" }),
      );
    });

    it("falls back to BASE_FEE when gas estimator throws", async () => {
      mockFetchDynamicFeeTiers.mockRejectedValue(new Error("Horizon down"));
      const { buildCreateEscrowTx } = await import("@/lib/stellar");
      await buildCreateEscrowTx({
        clientPublicKey: "GCLIENT000000000000000000000000000000000000000000000000000",
        jobId: "job-789",
        budget: 2,
      });

      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: BASE_FEE }),
      );
    });
  });

  describe("buildBoostJobTx", () => {
    it("uses dynamic fee (medium) by default", async () => {
      const { buildBoostJobTx } = await import("@/lib/stellar");
      await buildBoostJobTx({
        clientPublicKey: "GCLIENT000000000000000000000000000000000000000000000000000",
        jobId: "boost-job-1",
        amountXlm: 1,
        treasuryAddress: "GTREASURY0000000000000000000000000000000000000000000000000",
      });

      expect(mockFetchDynamicFeeTiers).toHaveBeenCalled();
      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: "1000" }),
      );
    });

    it("falls back to BASE_FEE on estimator error", async () => {
      mockFetchDynamicFeeTiers.mockRejectedValue(new Error("timeout"));
      const { buildBoostJobTx } = await import("@/lib/stellar");
      await buildBoostJobTx({
        clientPublicKey: "GCLIENT000000000000000000000000000000000000000000000000000",
        jobId: "boost-job-2",
        amountXlm: 1,
        treasuryAddress: "GTREASURY0000000000000000000000000000000000000000000000000",
      });

      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: BASE_FEE }),
      );
    });
  });

  describe("buildPaymentTransaction", () => {
    it("uses dynamic fee by default", async () => {
      const { buildPaymentTransaction } = await import("@/lib/stellar");
      await buildPaymentTransaction({
        fromPublicKey: "GFROM000000000000000000000000000000000000000000000000000000",
        toPublicKey: "GTO00000000000000000000000000000000000000000000000000000000",
        amount: "10",
      });

      expect(mockFetchDynamicFeeTiers).toHaveBeenCalled();
      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: "1000" }),
      );
    });

    it("uses slow tier when specified", async () => {
      mockPickTierFeeStroops.mockReturnValue(350);
      const { buildPaymentTransaction } = await import("@/lib/stellar");
      await buildPaymentTransaction({
        fromPublicKey: "GFROM000000000000000000000000000000000000000000000000000000",
        toPublicKey: "GTO00000000000000000000000000000000000000000000000000000000",
        amount: "10",
        feeTier: "slow",
      });

      expect(mockPickTierFeeStroops).toHaveBeenCalledWith(expect.anything(), "slow");
      expect(MockTransactionBuilder).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ fee: "350" }),
      );
    });
  });
});
