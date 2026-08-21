import { explorerUrl } from "@/lib/stellar";
import { useEscrowAction, type EscrowActionKind } from "@/hooks/useEscrowAction";
import type { Job } from "@/utils/types";

interface EscrowActionsProps {
  job: Job;
  setJob: (job: Job) => void;
  publicKey: string;
}

function ActionButton({
  kind,
  label,
  busyLabel,
  inFlight,
  disabled,
  onClick,
}: {
  kind: EscrowActionKind;
  label: string;
  busyLabel: string;
  inFlight: EscrowActionKind | null;
  disabled: boolean;
  onClick: (kind: EscrowActionKind) => void;
}) {
  const isThisAction = inFlight === kind;
  return (
    <button
      type="button"
      data-escrow-action={kind}
      onClick={() => onClick(kind)}
      disabled={disabled}
      aria-busy={isThisAction}
      className="btn-primary w-full sm:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {isThisAction ? busyLabel : label}
    </button>
  );
}

export default function EscrowActions({ job, setJob, publicKey }: EscrowActionsProps) {
  const { inFlight, phase, txHash, txExplorerUrl, error, successMessage, progressLabel, isBusy, run } =
    useEscrowAction(job, setJob, publicKey);

  const status = job.status;
  const showStartWork =
    (status === "open" && Boolean(job.freelancerAddress)) || inFlight === "start-work";
  const showRelease = status === "in_progress" || inFlight === "release";
  const showRefund =
    status === "open" || status === "in_progress" || Boolean(inFlight);

  if (!showStartWork && !showRelease && !showRefund && !successMessage && !error) {
    return null;
  }

  return (
    <div className="card mb-6" data-testid="escrow-actions">
      <h2 className="font-display text-lg sm:text-xl font-bold text-amber-100 mb-3">Escrow</h2>
      <p className="text-sm text-amber-700 mb-4">
        Wallet signature required. The job status updates immediately, then rolls back if the
        transaction is rejected or fails.
      </p>

      <div className="flex flex-col sm:flex-row gap-3">
        {showStartWork && (
          <ActionButton
            kind="start-work"
            label="Start work"
            busyLabel="Starting…"
            inFlight={inFlight}
            disabled={isBusy}
            onClick={run}
          />
        )}
        {showRelease && (
          <ActionButton
            kind="release"
            label="Release Escrow"
            busyLabel="Releasing..."
            inFlight={inFlight}
            disabled={isBusy}
            onClick={run}
          />
        )}
        {showRefund && (
          <ActionButton
            kind="refund"
            label="Refund Escrow"
            busyLabel="Refunding…"
            inFlight={inFlight}
            disabled={isBusy}
            onClick={run}
          />
        )}
      </div>

      {isBusy && (
        <p className="mt-3 text-amber-300 text-sm" data-testid="escrow-progress">
          {progressLabel}
          {phase === "submitting" && !txHash ? " Submitting to the network…" : null}
        </p>
      )}

      {(txHash || txExplorerUrl) && (
        <p className="mt-3 text-sm text-market-400" data-testid="escrow-tx-progress">
          Transaction submitted.{" "}
          <a
            href={txExplorerUrl ?? explorerUrl(txHash as string)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-market-300"
            data-testid="escrow-explorer-link"
          >
            View on explorer
          </a>
        </p>
      )}

      {successMessage && !isBusy && (
        <p className="mt-3 text-emerald-400 text-sm" data-testid="escrow-success">
          {successMessage}
        </p>
      )}

      {error && (
        <p className="mt-3 text-red-400 text-sm" role="alert" data-testid="escrow-error">
          {error}
        </p>
      )}
    </div>
  );
}
