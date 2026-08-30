/**
 * components/BulkJobActionBar.tsx
 *
 * Floating action bar that appears when one or more job cards are selected.
 * Features:
 *  - Selection count display with accessible live region
 *  - Bulk close (cancel), extend, and archive actions
 *  - Single confirmation modal for all destructive actions
 *  - Extend duration picker inside the confirmation flow
 *  - Per-item partial failure reporting (names each failed job + reason)
 *  - Undo for close and archive (5-second window, optimistic rollback)
 *  - Keyboard: Escape clears selection; Tab/Shift-Tab cycles toolbar buttons
 */
import { useState, useEffect, useRef, useCallback } from "react";
import clsx from "clsx";
import type { BulkActionResponse, Job } from "@/utils/types";

// ─── Extension options (mirrors ExtendJobModal) ───────────────────────────────
const EXTENSION_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveAction = "close" | "extend" | "archive" | null;

export interface UndoPayload {
  action: "close" | "archive";
  /** Snapshot of jobs BEFORE the bulk action — used for rollback. */
  previousJobs: Job[];
  /** IDs that were successfully mutated. */
  affectedIds: string[];
}

export interface BulkJobActionBarProps {
  selectedCount: number;
  /** Full job list — used to resolve titles in the failure report. */
  jobs: Job[];
  onClose: () => Promise<BulkActionResponse>;
  onExtend: (days: number) => Promise<BulkActionResponse>;
  onArchive: () => Promise<BulkActionResponse>;
  onClearSelection: () => void;
  loading: boolean;
  /** Called when the user clicks Undo within the 5-second window. */
  onUndo?: (payload: UndoPayload) => void;
  /** Snapshot of jobs before the action — must be passed for undo to work. */
  jobsBeforeAction?: Job[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function actionLabel(a: ActiveAction): string {
  if (a === "close") return "Close Jobs";
  if (a === "extend") return "Extend Jobs";
  if (a === "archive") return "Archive Jobs";
  return "";
}

function actionDescription(a: ActiveAction, count: number): string {
  const n = `${count} job${count !== 1 ? "s" : ""}`;
  if (a === "close")
    return `Close ${n}? Only open jobs will be affected. Closed jobs can be reopened by reposting.`;
  if (a === "extend")
    return `Choose how many days to extend ${n}.`;
  if (a === "archive")
    return `Archive ${n}? Archived jobs are hidden from your dashboard but can be recovered by support.`;
  return "";
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BulkJobActionBar({
  selectedCount,
  jobs,
  onClose,
  onExtend,
  onArchive,
  onClearSelection,
  loading,
  onUndo,
  jobsBeforeAction,
}: BulkJobActionBarProps) {
  const [confirmAction, setConfirmAction] = useState<ActiveAction>(null);
  const [extendDays, setExtendDays] = useState<number>(30);
  const [result, setResult] = useState<BulkActionResponse | null>(null);
  const [lastAction, setLastAction] = useState<ActiveAction>(null);
  const [undoPayload, setUndoPayload] = useState<UndoPayload | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);

  // Focus management — first focusable button in the toolbar
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const confirmCancelRef = useRef<HTMLButtonElement>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const UNDO_WINDOW_S = 5;

  // ── Focus the first toolbar button when the bar becomes visible ──────────
  useEffect(() => {
    if (selectedCount > 0) {
      // Small delay so the CSS transition has started
      const t = setTimeout(() => firstButtonRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [selectedCount > 0]); // intentional: trigger only on show/hide, not every count change

  // ── Focus confirmation modal cancel button when it opens ─────────────────
  useEffect(() => {
    if (confirmAction) {
      const t = setTimeout(() => confirmCancelRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [confirmAction]);

  // ── Undo countdown ────────────────────────────────────────────────────────
  const startUndoCountdown = useCallback((payload: UndoPayload) => {
    setUndoPayload(payload);
    setUndoSecondsLeft(UNDO_WINDOW_S);
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    undoTimerRef.current = setInterval(() => {
      setUndoSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(undoTimerRef.current!);
          setUndoPayload(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, []);

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    },
    [],
  );

  // ── Keyboard: Escape clears selection (when modal is not open) ───────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.defaultPrevented) return;
      if (confirmAction) {
        e.preventDefault();
        setConfirmAction(null);
        return;
      }
      if (selectedCount > 0) {
        e.preventDefault();
        onClearSelection();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [confirmAction, selectedCount, onClearSelection]);

  if (selectedCount === 0 && !result && !undoPayload) return null;

  // ── Execute action ───────────────────────────────────────────────────────
  const handleAction = async (action: ActiveAction) => {
    if (!action) return;
    setResult(null);
    setConfirmAction(null);

    let res: BulkActionResponse;
    if (action === "close") {
      res = await onClose();
    } else if (action === "extend") {
      res = await onExtend(extendDays);
    } else {
      res = await onArchive();
    }

    setLastAction(action);
    setResult(res);

    // Offer undo for close/archive if something actually succeeded
    if ((action === "close" || action === "archive") && res.succeeded > 0 && onUndo && jobsBeforeAction) {
      const affectedIds = res.results.filter((r) => r.success).map((r) => r.id);
      startUndoCountdown({ action, previousJobs: jobsBeforeAction, affectedIds });
    }
  };

  const handleUndo = () => {
    if (!undoPayload || !onUndo) return;
    if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    onUndo(undoPayload);
    setUndoPayload(null);
    setUndoSecondsLeft(0);
    setResult(null);
  };

  const isDestructive = (a: ActiveAction) => a === "close" || a === "archive";

  // Build a title→id lookup for better failure reporting
  const jobTitleById: Record<string, string> = {};
  for (const j of jobs) jobTitleById[j.id] = j.title;

  return (
    <>
      {/* ── Floating action bar ─────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div
          className={clsx(
            "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
            "flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl",
            "bg-ink-800 border border-market-500/30 backdrop-blur-sm",
            "transition-all duration-200",
          )}
          role="toolbar"
          aria-label="Bulk job actions"
        >
          {/* Selection count + clear */}
          <div className="flex items-center gap-2 pr-3 border-r border-market-500/20">
            <span
              className="w-6 h-6 rounded-lg bg-market-500/20 flex items-center justify-center text-xs font-bold text-market-400"
              aria-live="polite"
              aria-atomic="true"
            >
              {selectedCount}
            </span>
            <span className="text-sm text-amber-200 font-medium whitespace-nowrap">
              job{selectedCount !== 1 ? "s" : ""} selected
            </span>
            <button
              ref={firstButtonRef}
              onClick={onClearSelection}
              className="ml-1 p-1.5 rounded-md text-amber-700 hover:text-amber-400 hover:bg-amber-400/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60"
              title="Clear selection (Esc)"
              aria-label="Clear selection"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Extend */}
      <div
        className={clsx(
          "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
          "flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl",
          "bg-ink-800 border border-market-500/30 backdrop-blur-sm",
          "transition-all duration-200",
          selectedCount > 0
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        )}
        role="toolbar"
        aria-label="Bulk job actions"
      >
        {/* Selection count + clear */}
        <div className="flex items-center gap-2 pr-3 border-r border-market-500/20">
          <span className="w-6 h-6 rounded-lg bg-market-500/20 flex items-center justify-center text-xs font-bold text-market-400">
            {selectedCount}
          </span>
          <span className="text-sm text-amber-200 font-medium whitespace-nowrap">
            job{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <button
            onClick={() => setConfirmAction("extend")}
            disabled={loading}
            aria-label="Extend selected jobs"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-market-500/20 text-amber-200 hover:border-market-400 hover:text-market-300 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Extend
          </button>

          {/* Close (cancel) */}
          <button
            onClick={() => setConfirmAction("close")}
            disabled={loading}
            aria-label="Close selected jobs"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:border-red-400 hover:bg-red-500/15 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            Close
          </button>

          {/* Archive */}
          <button
            onClick={() => setConfirmAction("archive")}
            disabled={loading}
            aria-label="Archive selected jobs"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-amber-500/20 text-amber-400 hover:border-amber-400 hover:bg-amber-500/10 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
            Archive
          </button>
        </div>
      )}
        </div>

        {/* Extend */}
        <button
          onClick={() => handleAction("extend")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-market-500/20 text-amber-200 hover:border-market-400 hover:text-market-300 transition-all disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          Extend
        </button>

        {/* Boost */}
        <button
          onClick={() => handleAction("boost")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-ink-700 border border-amber-500/20 text-amber-300 hover:border-amber-400 hover:text-amber-200 transition-all disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Boost
        </button>

        {/* Cancel — destructive, requires confirmation */}
        <button
          onClick={() => setConfirmAction("cancel")}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400 hover:border-red-400 hover:bg-red-500/15 transition-all disabled:opacity-50"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
            />
          </svg>
          Cancel Jobs
        </button>
      </div>

      {/* ── Confirmation modal ──────────────────────────────────────────── */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink-950/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-confirm-title"
          aria-describedby="bulk-confirm-desc"
          onKeyDown={(e) => {
            // Trap focus inside the modal
            if (e.key !== "Tab") return;
            const modal = e.currentTarget;
            const focusable = Array.from(
              modal.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input, [tabindex]:not([tabindex="-1"])',
              ),
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }}
        >
          <div
            className={clsx(
              "rounded-2xl p-6 max-w-sm w-full shadow-2xl",
              "bg-ink-800 border",
              isDestructive(confirmAction) ? "border-red-500/20" : "border-market-500/20",
            )}
          >
            <div className="flex items-center gap-3 mb-4">
              <div
                className={clsx(
                  "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  isDestructive(confirmAction)
                    ? "bg-red-500/10 border border-red-500/20"
                    : "bg-market-500/10 border border-market-500/20",
                )}
              >
                {confirmAction === "extend" ? (
                  <svg className="w-5 h-5 text-market-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
              </div>
              <div>
                <h3 id="bulk-confirm-title" className="font-display font-semibold text-amber-100">
                  {actionLabel(confirmAction)} ({selectedCount})
                </h3>
              </div>
            </div>

            <p id="bulk-confirm-desc" className="text-sm text-amber-700 mb-5">
              {actionDescription(confirmAction, selectedCount)}
                  Cancel {selectedCount} job{selectedCount !== 1 ? "s" : ""}?
                </h3>
                <p className="text-xs text-amber-700 mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-amber-700 mb-6">
              Only <span className="text-amber-300 font-medium">open</span> jobs will be cancelled.
              Jobs that are in progress, completed, or already cancelled will be skipped.
            </p>

            {/* Extend duration picker */}
            {confirmAction === "extend" && (
              <fieldset className="mb-5">
                <legend className="text-xs text-amber-800 uppercase tracking-wide font-semibold mb-2">
                  Extension duration
                </legend>
                <div className="flex gap-2">
                  {EXTENSION_OPTIONS.map((opt) => (
                    <button
                      key={opt.days}
                      type="button"
                      onClick={() => setExtendDays(opt.days)}
                      className={clsx(
                        "flex-1 py-2 rounded-xl border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60",
                        extendDays === opt.days
                          ? "border-market-400/60 bg-market-500/15 text-market-300"
                          : "border-market-500/15 bg-ink-900/40 text-amber-700 hover:border-market-400/30",
                      )}
                      aria-pressed={extendDays === opt.days}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="flex gap-3">
              <button
                ref={confirmCancelRef}
                onClick={() => setConfirmAction(null)}
                className="flex-1 btn-secondary text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60"
                disabled={loading}
              >
                Go Back
              </button>
              <button
                onClick={() => handleAction(confirmAction)}
                disabled={loading}
                className={clsx(
                  "flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2",
                  isDestructive(confirmAction)
                    ? "bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 focus-visible:ring-red-400/60"
                    : "btn-primary focus-visible:ring-market-400/60",
                )}
              >
                {loading
                  ? "Processing…"
                  : confirmAction === "close"
                    ? "Yes, Close"
                    : confirmAction === "archive"
                      ? "Yes, Archive"
                      : `Extend ${extendDays} days`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Result panel + undo ─────────────────────────────────────────── */}
      {result && (
        <BulkResultPanel
          result={result}
          action={lastAction}
          jobTitleById={jobTitleById}
          undoPayload={undoPayload}
          undoSecondsLeft={undoSecondsLeft}
          onUndo={handleUndo}
          onDismiss={() => {
            setResult(null);
            if (undoTimerRef.current) clearInterval(undoTimerRef.current);
            setUndoPayload(null);
          }}
        />
      )}
      {/* ── Result toast ────────────────────────────────────────────────── */}
      {result && <BulkResultToast result={result} onDismiss={() => setResult(null)} />}
    </>
  );
}

// ─── Result panel ─────────────────────────────────────────────────────────────

interface BulkResultPanelProps {
  result: BulkActionResponse;
  action: ActiveAction;
  jobTitleById: Record<string, string>;
  undoPayload: UndoPayload | null;
  undoSecondsLeft: number;
  onUndo: () => void;
  onDismiss: () => void;
}

function BulkResultPanel({
  result,
  action,
  jobTitleById,
  undoPayload,
  undoSecondsLeft,
  onUndo,
  onDismiss,
}: BulkResultPanelProps) {
  const allOk = result.failed === 0 && result.succeeded > 0;
  const failures = result.results.filter((r) => !r.success);
  const canUndo = undoPayload !== null && undoSecondsLeft > 0;

  return (
    <div
      className={clsx(
        "fixed bottom-24 left-1/2 -translate-x-1/2 z-50",
        "max-w-sm w-full mx-4 rounded-2xl border p-4 shadow-2xl",
        allOk ? "bg-emerald-500/10 border-emerald-500/30" : "bg-amber-500/10 border-amber-500/30"
      )}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {allOk ? (
            <svg className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}

          <div className="flex-1 min-w-0">
            {/* Summary line */}
            <p className={clsx("text-sm font-semibold", allOk ? "text-emerald-400" : "text-amber-300")}>
              {result.succeeded > 0
                ? `${result.succeeded} ${actionLabel(action).toLowerCase()} successfully`
                : "No jobs were updated"}
              {result.failed > 0 && `, ${result.failed} failed`}
          <div>
            <p
              className={clsx(
                "text-sm font-semibold",
                allOk ? "text-emerald-400" : "text-amber-300"
              )}
            >
              {result.succeeded} succeeded
              {result.failed > 0 ? `, ${result.failed} failed` : ""}
            </p>

            {/* Per-item failure details */}
            {failures.length > 0 && (
              <ul className="mt-2 space-y-1" aria-label="Failed items">
                {failures.map((f) => (
                  <li key={f.id} className="text-xs text-amber-700 flex gap-1.5">
                    <span className="font-medium text-amber-500 truncate max-w-[12ch]" title={jobTitleById[f.id] ?? f.id}>
                      {jobTitleById[f.id] ? `"${jobTitleById[f.id]}"` : f.id.slice(0, 8) + "…"}
                    </span>
                    <span className="text-amber-800">—</span>
                    <span className="flex-1">{f.error ?? "Unknown error"}</span>
                  </li>
                ))}
                {failures.length > 3 && (
                  <li className="text-xs text-amber-800">+{failures.length - 3} more</li>
                )}
              </ul>
            )}

            {/* Undo row */}
            {canUndo && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={onUndo}
                  className="text-xs font-semibold text-market-300 hover:text-market-200 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60 rounded"
                >
                  Undo ({undoSecondsLeft}s)
                </button>
                <div
                  className="h-1 flex-1 rounded-full bg-market-500/20 overflow-hidden"
                  aria-hidden="true"
                >
                  <div
                    className="h-full bg-market-400 rounded-full transition-all duration-1000 ease-linear"
                    style={{ width: `${(undoSecondsLeft / 5) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={onDismiss}
          className="text-amber-700 hover:text-amber-400 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-market-400/60 rounded"
          aria-label="Dismiss notification"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
