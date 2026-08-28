/**
 * pages/freelancers/index.tsx
 * Browse freelancers with availability status filtering and optional ML ranking for a job.
 */
import Head from "next/head";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { fetchProfiles, fetchMlRankedFreelancers, type RankedFreelancer } from "@/lib/api";
import FreelancerCard from "@/components/FreelancerCard";
import { availabilityStatusLabel } from "@/utils/format";
import type { AvailabilityStatus, UserProfile } from "@marketpay/shared-types";

const availabilityOptions = [
  { value: "", label: "All statuses" },
  { value: "available", label: "Available" },
  { value: "busy", label: "Busy" },
  { value: "unavailable", label: "Unavailable" },
];

export default function FreelancersBrowsePage() {
  const router = useRouter();
  const jobId = typeof router.query.jobId === "string" ? router.query.jobId : undefined;
  const [profiles, setProfiles] = useState<(UserProfile | RankedFreelancer)[]>([]);
  const [search, setSearch] = useState("");
  const [availability, setAvailability] = useState<AvailabilityStatus | "">();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rankingSource, setRankingSource] = useState<"ml" | "baseline" | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadProfiles = async () => {
      setLoading(true);
      setError(null);

      try {
        if (jobId) {
          const { freelancers, meta } = await fetchMlRankedFreelancers(jobId, 24);
          if (!cancelled) {
            setProfiles(freelancers);
            setRankingSource(meta.source);
          }
          return;
        }

        const results = await fetchProfiles({
          role: "freelancer",
          availability: availability || undefined,
          search: search || undefined,
          limit: 60,
        });
        if (!cancelled) {
          setProfiles(results);
          setRankingSource(null);
        }
      } catch (err) {
        if (!cancelled) {
          if (jobId) {
            try {
              const results = await fetchProfiles({
                role: "freelancer",
                availability: availability || undefined,
                search: search || undefined,
                limit: 60,
              });
              setProfiles(results);
              setRankingSource("baseline");
              return;
            } catch {
              // fall through
            }
          }
          setError(err instanceof Error ? err.message : "Failed to load freelancers");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [availability, search, jobId]);

  return (
    <>
      <Head>
        <title>Browse Freelancers | Stellar MarketPay</title>
      </Head>

      <main className="max-w-7xl mx-auto px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-amber-400/80">Freelancers</p>
            <h1 className="font-display text-4xl font-semibold text-amber-100 sm:text-5xl">
              {jobId ? "Top-matched freelancers for your job." : "Browse talent by availability."}
            </h1>
          </div>
          <p className="max-w-2xl text-amber-300 text-sm leading-6">
            {jobId
              ? "Rankings use historical completion, ratings, and skill overlap. Falls back to search if the model is unavailable."
              : "Filter freelancers by availability status and search skills, names, or account IDs."}
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="card space-y-5 p-6">
            <div>
              <h2 className="label">Filter</h2>
              <p className="text-amber-500 text-sm">Show freelancers by availability status.</p>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-amber-100">Availability</label>
              <select
                value={availability}
                onChange={(event) => setAvailability(event.target.value as AvailabilityStatus | "")}
                className="input-field w-full"
              >
                {availabilityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-amber-100">Search</label>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by skills, name, or address"
                className="input-field w-full"
              />
            </div>
          </aside>

          <section className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-amber-400">{profiles.length} freelancers</p>
                <p className="text-amber-300 text-sm">
                  {jobId
                    ? rankingSource === "ml"
                      ? "ML-ranked by predicted job fit"
                      : "Showing search results (ranking unavailable)"
                    : availability
                      ? availabilityStatusLabel(availability)
                      : "Showing all freelancers"}
                </p>
              </div>
            </div>

            {loading ? (
              <div className="card py-10 text-center text-amber-300">Loading freelancers…</div>
            ) : error ? (
              <div className="card py-10 text-center text-red-400">{error}</div>
            ) : profiles.length === 0 ? (
              <div className="card py-10 text-center text-amber-300">
                No freelancers match the selected availability and search criteria.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {profiles.map((profile) => (
                  <FreelancerCard
                    key={profile.publicKey}
                    profile={profile}
                    matchScore={"matchScore" in profile ? profile.matchScore : undefined}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
