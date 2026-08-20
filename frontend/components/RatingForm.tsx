/**
 * components/RatingForm.tsx
 * 1–5 star rating form shown after job completion.
 */
import { useState } from "react";
import { submitRating } from "@/lib/api";
import clsx from "clsx";

interface RatingFormProps {
  jobId: string;
  ratedAddress: string;
  ratedLabel?: string;
  onSuccess?: () => void;
}

export default function RatingForm({
  jobId,
  ratedAddress,
  ratedLabel,
  onSuccess,
}: RatingFormProps) {
  const [stars, setStars] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [review, setReview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (stars < 1) {
      setError("Please select a star rating.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitRating({ jobId, ratedAddress, stars, review: review.trim() || undefined });
      setSubmitted(true);
      onSuccess?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to submit rating.";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="card border-emerald-500/20 bg-emerald-500/5 text-center py-6">
        <p className="text-emerald-400 font-medium">✅ Rating submitted — thank you!</p>
      </div>
    );
  }

  return (
    <div className="card border-market-500/20">
      <h3 className="font-display text-base font-semibold text-amber-100 mb-1">
        Leave a Rating{ratedLabel ? ` for ${ratedLabel}` : ""}
      </h3>
      <p className="text-amber-800 text-xs mb-4">Rate your experience working together</p>

      {/* Stars */}
      <div className="flex items-center gap-1 mb-4" role="group" aria-label="Star rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setStars(n)}
            onMouseEnter={() => setHovered(n)}
            onMouseLeave={() => setHovered(0)}
            className={clsx(
              "text-2xl transition-transform hover:scale-110",
              (hovered || stars) >= n ? "text-amber-400" : "text-amber-900"
            )}
            aria-label={`${n} star${n !== 1 ? "s" : ""}`}
          >
            ★
          </button>
        ))}
        {stars > 0 && (
          <span className="ml-2 text-xs text-amber-600">
            {["", "Poor", "Fair", "Good", "Very Good", "Excellent"][stars]}
          </span>
        )}
      </div>

      {/* Review */}
      <textarea
        value={review}
        onChange={(e) => setReview(e.target.value.slice(0, 200))}
        placeholder="Optional: leave a short review (max 200 characters)"
        rows={3}
        className="w-full bg-ink-800 border border-market-500/15 rounded-xl px-4 py-3 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 resize-none mb-1"
      />
      <p className="text-xs text-amber-900 text-right mb-4">{review.length}/200</p>

      {error && <p className="mb-3 text-red-400 text-sm">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting || stars < 1}
        className="btn-primary text-sm py-2 px-5 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Rating"}
      </button>
    </div>
  );
}
