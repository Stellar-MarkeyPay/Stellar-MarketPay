import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import EscrowActions from "@/components/EscrowActions";
import { ESCROW_OPTIMISTIC_STATUS, explainEscrowFailure } from "@/hooks/useEscrowAction";
import type { Job } from "@/utils/types";

const signTransactionWithWallet = jest.fn();
const submitSignedSorobanTransaction = jest.fn();
const releaseEscrow = jest.fn();
const refundEscrow = jest.fn();
const startWork = jest.fn();
const fetchJob = jest.fn();

jest.mock("@/lib/wallet", () => ({
  signTransactionWithWallet: (...args: unknown[]) => signTransactionWithWallet(...args),
}));

jest.mock("@/lib/stellar", () => ({
  buildReleaseEscrowTransaction: jest.fn(async () => ({ toXDR: () => "mock-xdr" })),
  buildRefundEscrowTransaction: jest.fn(async () => ({ toXDR: () => "mock-xdr" })),
  buildStartWorkTransaction: jest.fn(async () => ({ toXDR: () => "mock-xdr" })),
  explorerUrl: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  submitSignedSorobanTransaction: (...args: unknown[]) => submitSignedSorobanTransaction(...args),
}));

jest.mock("@/lib/api", () => ({
  releaseEscrow: (...args: unknown[]) => releaseEscrow(...args),
  refundEscrow: (...args: unknown[]) => refundEscrow(...args),
  startWork: (...args: unknown[]) => startWork(...args),
  fetchJob: (...args: unknown[]) => fetchJob(...args),
}));

const CLIENT = "GCLIENTADDRESS1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUV";

function inProgressJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-escrow",
    title: "Escrow job",
    description: "Needs optimistic release, refund, and start-work.",
    budget: "100",
    currency: "XLM",
    category: "Smart Contracts",
    skills: ["Soroban"],
    status: "in_progress",
    clientAddress: CLIENT,
    freelancerAddress: "GFREELANCER1234567890EXAMPLEABCDEFGHIJKLMNOPQRSTUVWX",
    escrowContractId: "CMOCKCONTRACTID",
    applicantCount: 1,
    createdAt: "2026-01-12T10:00:00.000Z",
    updatedAt: "2026-01-12T10:00:00.000Z",
    ...overrides,
  };
}

function Harness({ initialJob }: { initialJob: Job }) {
  const [job, setJob] = useState(initialJob);
  return (
    <>
      <span data-testid="job-status">{job.status}</span>
      <EscrowActions job={job} setJob={setJob} publicKey={CLIENT} />
    </>
  );
}

describe("optimistic escrow actions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    signTransactionWithWallet.mockReset();
    submitSignedSorobanTransaction.mockReset();
    releaseEscrow.mockReset();
    refundEscrow.mockReset();
    startWork.mockReset();
    fetchJob.mockReset();
  });

  it("maps each escrow action to an optimistic status", () => {
    expect(ESCROW_OPTIMISTIC_STATUS.release).toBe("completed");
    expect(ESCROW_OPTIMISTIC_STATUS.refund).toBe("cancelled");
    expect(ESCROW_OPTIMISTIC_STATUS["start-work"]).toBe("in_progress");
  });

  it("explains wallet and network failures in plain language", () => {
    expect(explainEscrowFailure(new Error("Transaction signing rejected."), "fallback")).toBe(
      "Transaction signing rejected."
    );
    expect(explainEscrowFailure("boom", "fallback")).toBe("boom");
    expect(explainEscrowFailure(null, "fallback")).toBe("fallback");
  });

  it("applies an optimistic status then rolls back when the signature is rejected", async () => {
    let rejectSign: (() => void) | undefined;
    signTransactionWithWallet.mockImplementation(
      () =>
        new Promise((resolve) => {
          rejectSign = () => resolve({ signedXDR: null, error: "Transaction signing rejected." });
        })
    );

    render(<Harness initialJob={inProgressJob()} />);

    fireEvent.click(screen.getByRole("button", { name: "Release Escrow" }));

    await waitFor(() => {
      expect(screen.getByTestId("job-status")).toHaveTextContent("completed");
      expect(screen.getByRole("button", { name: "Releasing..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Refund Escrow" })).toBeDisabled();
    });

    rejectSign?.();

    await waitFor(() => {
      expect(screen.getByTestId("job-status")).toHaveTextContent("in_progress");
      expect(screen.getByTestId("escrow-error")).toHaveTextContent("Transaction signing rejected.");
    });

    expect(submitSignedSorobanTransaction).not.toHaveBeenCalled();
    expect(releaseEscrow).not.toHaveBeenCalled();
  });

  it("shows an explorer link once a transaction hash exists", async () => {
    signTransactionWithWallet.mockResolvedValue({ signedXDR: "signed-xdr", error: null });
    submitSignedSorobanTransaction.mockResolvedValue({ hash: "abc123hash" });
    releaseEscrow.mockResolvedValue({});
    fetchJob.mockResolvedValue(inProgressJob({ status: "completed" }));

    render(<Harness initialJob={inProgressJob()} />);
    fireEvent.click(screen.getByRole("button", { name: "Release Escrow" }));

    const link = await screen.findByTestId("escrow-explorer-link");
    expect(link).toHaveAttribute("href", "https://stellar.expert/explorer/testnet/tx/abc123hash");
    expect(await screen.findByTestId("escrow-success")).toHaveTextContent(
      "Escrow released successfully."
    );
  });
});
