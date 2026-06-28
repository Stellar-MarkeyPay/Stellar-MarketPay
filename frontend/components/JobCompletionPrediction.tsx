import clsx from "clsx";
import type { JobCompletionPrediction } from "@/utils/types";

interface JobCompletionPredictionProps {
  prediction: JobCompletionPrediction;
  compact?: boolean;
}

function confidenceTone(score: number) {
  if (score >= 80) return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  if (score >= 60) return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  return "text-red-300 border-red-500/30 bg-red-500/10";
}

export default function JobCompletionPredictionPanel({
  prediction,
  compact = false,
}: JobCompletionPredictionProps) {
  const completionDate = new Date(prediction.estimatedCompletionDate).toLocaleDateString();

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-amber-700">Est. completion:</span>
        <span className="font-mono text-market-400">
          {prediction.estimatedDurationDays} day{prediction.estimatedDurationDays === 1 ? "" : "s"}
        </span>
        <span
          className={clsx(
            "px-2 py-0.5 rounded-full border font-medium",
            confidenceTone(prediction.confidenceScore),
          )}
        >
          {prediction.confidenceScore}% confidence
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-market-500/20 bg-market-500/5 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h4 className="font-display text-sm font-semibold text-amber-100">
          Completion Prediction
        </h4>
        <span
          className={clsx(
            "text-xs px-2.5 py-1 rounded-full border font-medium",
            confidenceTone(prediction.confidenceScore),
          )}
        >
          {prediction.confidenceScore}% confidence
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs text-amber-700 mb-1">Estimated Duration</p>
          <p className="font-mono text-market-400">
            {prediction.estimatedDurationDays} day{prediction.estimatedDurationDays === 1 ? "" : "s"}
          </p>
        </div>
        <div>
          <p className="text-xs text-amber-700 mb-1">Estimated Completion</p>
          <p className="font-mono text-amber-200">{completionDate}</p>
        </div>
        <div>
          <p className="text-xs text-amber-700 mb-1">On-Time Rate</p>
          <p className="font-mono text-emerald-400">
            {prediction.freelancerStats.onTimeRate !== null
              ? `${prediction.freelancerStats.onTimeRate}%`
              : "No history"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-amber-800">
        <span>{prediction.freelancerStats.completedJobs} completed jobs</span>
        <span>Rating {prediction.freelancerStats.rating.toFixed(1)}</span>
      </div>
    </div>
  );
}
