import { useCallback, useRef, useState } from "react";
import { fetchJob, refundEscrow, releaseEscrow, startWork } from "@/lib/api";
import {
  buildRefundEscrowTransaction,
  buildReleaseEscrowTransaction,
  buildStartWorkTransaction,
  explorerUrl,
  submitSignedSorobanTransaction,
} from "@/lib/stellar";
import { signTransactionWithWallet } from "@/lib/wallet";
import type { Job, JobStatus } from "@/utils/types";

export type EscrowActionKind = "release" | "refund" | "start-work";

export type EscrowTxPhase = "idle" | "confirming" | "submitting" | "success";

export const ESCROW_OPTIMISTIC_STATUS: Record<EscrowActionKind, JobStatus> = {
  release: "completed",
  refund: "cancelled",
  "start-work": "in_progress",
};

const ACTION_LABELS: Record<EscrowActionKind, { progress: string; success: string; failed: string }> = {
  release: {
    progress: "Releasing escrow…",
    success: "Escrow released successfully.",
    failed: "Could not complete escrow release. The previous escrow state was restored.",
  },
  refund: {
    progress: "Refunding escrow…",
    success: "Escrow refunded successfully.",
    failed: "Could not complete escrow refund. The previous escrow state was restored.",
  },
  "start-work": {
    progress: "Starting work on-chain…",
    success: "Work started successfully.",
    failed: "Could not start work. The previous escrow state was restored.",
  },
};

export function explainEscrowFailure(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

type PreparedTx = { toXDR: () => string };

const BUILDERS: Record<
  EscrowActionKind,
  (contractId: string, jobId: string, publicKey: string) => Promise<PreparedTx>
> = {
  release: buildReleaseEscrowTransaction,
  refund: buildRefundEscrowTransaction,
  "start-work": buildStartWorkTransaction,
};

const PERSIST: Record<
  EscrowActionKind,
  (jobId: string, publicKey: string, hash: string) => Promise<unknown>
> = {
  release: releaseEscrow,
  refund: refundEscrow,
  "start-work": startWork,
};

export function useEscrowAction(
  job: Job | null,
  setJob: (job: Job) => void,
  publicKey: string | null
) {
  const [inFlight, setInFlight] = useState<EscrowActionKind | null>(null);
  const [phase, setPhase] = useState<EscrowTxPhase>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const inFlightRef = useRef<EscrowActionKind | null>(null);
  const snapshotRef = useRef<Job | null>(null);

  const run = useCallback(
    async (kind: EscrowActionKind) => {
      if (!publicKey || !job || inFlightRef.current) return;
      if (!job.escrowContractId) {
        setError("This job has no escrow contract ID.");
        return;
      }

      inFlightRef.current = kind;
      snapshotRef.current = job;
      setInFlight(kind);
      setError(null);
      setSuccessMessage(null);
      setTxHash(null);
      setPhase("confirming");
      setJob({
        ...job,
        status: ESCROW_OPTIMISTIC_STATUS[kind],
        updatedAt: new Date().toISOString(),
      });

      try {
        const prepared = await BUILDERS[kind](job.escrowContractId, job.id, publicKey);
        const { signedXDR, error: signError } = await signTransactionWithWallet(prepared.toXDR());
        if (signError || !signedXDR) {
          throw new Error(signError || "Transaction signing rejected.");
        }

        setPhase("submitting");
        const { hash } = await submitSignedSorobanTransaction(signedXDR);
        setTxHash(hash);

        await PERSIST[kind](job.id, publicKey, hash);
        const refreshed = await fetchJob(job.id);
        const expected = ESCROW_OPTIMISTIC_STATUS[kind];
        const snapshot = snapshotRef.current;
        setJob({
          ...refreshed,
          status:
            snapshot && refreshed.status === snapshot.status ? expected : refreshed.status,
        });
        setPhase("success");
        setSuccessMessage(ACTION_LABELS[kind].success);
      } catch (caught: unknown) {
        const snapshot = snapshotRef.current;
        if (snapshot) setJob(snapshot);
        setTxHash(null);
        setPhase("idle");
        setSuccessMessage(null);
        setError(explainEscrowFailure(caught, ACTION_LABELS[kind].failed));
      } finally {
        inFlightRef.current = null;
        setInFlight(null);
      }
    },
    [job, publicKey, setJob]
  );

  return {
    inFlight,
    phase,
    txHash,
    txExplorerUrl: txHash ? explorerUrl(txHash) : null,
    error,
    successMessage,
    progressLabel: inFlight ? ACTION_LABELS[inFlight].progress : null,
    isBusy: Boolean(inFlight),
    run,
  };
}
