/**
 * components/ProposalComparison.tsx
 * Modal for side-by-side comparison of job applications/proposals.
 */
import { useState, useEffect } from "react";
import { formatXLM, shortenAddress } from "@/utils/format";
import { accountUrl } from "@/lib/stellar";
import { fetchProfile, fetchMyApplications } from "@/lib/api";
import type { Application, Job, UserProfile } from "@/utils/types";
import clsx from "clsx";

interface ProposalComparisonProps {
  applications: Application[];
  job: Job | null;
  publicKey: string | null;
  onClose: () => void;
  onAccept: (appId: string) => Promise<void>;
}

interface ApplicationWithProfile extends Application {
  profile?: UserProfile;
  applicationCount?: number;
}

export default function ProposalComparison({
  applications,
  job,
  publicKey,
  onClose,
  onAccept,
}: ProposalComparisonProps) {
  const [applicationsWithProfile, setApplicationsWithProfile] = useState<ApplicationWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  useEffect(() => {
    const loadProfiles = async () => {
      if (applications.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const enrichedApps = await Promise.all(
          applications.map(async (app) => {
            try {
              const [profile, userApplications] = await Promise.all([
                fetchProfile(app.freelancerAddress),
                fetchMyApplications(app.freelancerAddress),
              ]);
              return {
                ...app,
                profile,
                applicationCount: userApplications.length,
              };
            } catch {
              return {
                ...app,
                applicationCount: 0,
              };
            }
          })
        );
        setApplicationsWithProfile(enrichedApps);
      } catch (error) {
        console.error("Failed to load profiles:", error);
        setApplicationsWithProfile(
          applications.map((app) => ({ ...app, applicationCount: 0 }))
        );
      } finally {
        setLoading(false);
      }
    };

    loadProfiles();
  }, [applications]);

  const handleAccept = async (appId: string) => {
    if (!publicKey) return;
    setAcceptingId(appId);
    try {
      await onAccept(appId);
      onClose();
    } catch (error) {
      console.error("Failed to accept application:", error);
    } finally {
      setAcceptingId(null);
    }
  };

  const getFreelancerTier = (profile?: UserProfile): string => {
    if (!profile) return "Unknown";
    if (profile.completedJobs >= 10) return "Expert";
    if (profile.completedJobs >= 5) return "Senior";
    if (profile.completedJobs >= 1) return "Mid";
    return "Junior";
  };

  const renderStars = (rating?: number): string => {
    if (!rating) return "N/A";
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    let stars = "★".repeat(fullStars);
    if (hasHalfStar) stars += "½";
    return stars;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="card max-w-6xl w-full max-h-[90vh] overflow-auto p-8 text-center">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-market-500/8 rounded w-1/3 mx-auto" />
            <div className="h-4 bg-market-500/8 rounded w-2/3 mx-auto" />
          </div>
        </div>
      </div>
    );
  }

  if (applicationsWithProfile.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card max-w-6xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-[#0a0a0f] border-b border-market-500/10 p-6 z-10">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-amber-100">
              Compare Proposals ({applicationsWithProfile.length})
            </h2>
            <button
              onClick={onClose}
              className="text-amber-800 hover:text-amber-400 transition-colors text-2xl font-light min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        </div>

        {/* Comparison Table */}
        <div className="p-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <tbody>
                {/* Freelancer Address */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Freelancer
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4 min-w-[200px]">
                      <a
                        href={accountUrl(app.freelancerAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="address-tag hover:border-market-500/40 transition-colors block"
                      >
                        {shortenAddress(app.freelancerAddress)} ↗
                      </a>
                    </td>
                  ))}
                </tr>

                {/* Bid Amount */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Bid Amount
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <span className="font-mono text-market-400 font-semibold">
                        {formatXLM(app.bidAmount)}
                      </span>
                    </td>
                  ))}
                </tr>

                {/* Proposal Excerpt */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap align-top">
                    Proposal
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <p className="text-amber-700/80 text-sm leading-relaxed max-h-32 overflow-y-auto">
                        {app.proposal}
                      </p>
                    </td>
                  ))}
                </tr>

                {/* Freelancer Tier */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Experience Level
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <span className="text-sm bg-market-500/10 text-market-400/80 border border-market-500/15 px-3 py-1 rounded-full">
                        {getFreelancerTier(app.profile)}
                      </span>
                    </td>
                  ))}
                </tr>

                {/* Freelancer Rating */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Rating
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-market-400 text-lg">
                          {renderStars(app.profile?.rating)}
                        </span>
                        {app.profile?.ratingCount && app.profile.ratingCount > 0 && (
                          <span className="text-xs text-amber-800">
                            ({app.profile.ratingCount})
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Applications Count */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Total Applications
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <span className="text-amber-700/80 text-sm">
                        {app.applicationCount ?? 0}
                      </span>
                    </td>
                  ))}
                </tr>

                {/* Completed Jobs */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Completed Jobs
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <span className="text-amber-700/80 text-sm">
                        {app.profile?.completedJobs ?? 0}
                      </span>
                    </td>
                  ))}
                </tr>

                {/* Status */}
                <tr className="border-b border-market-500/10">
                  <td className="py-4 pr-4 text-sm font-semibold text-amber-300 whitespace-nowrap">
                    Status
                  </td>
                  {applicationsWithProfile.map((app) => (
                    <td key={app.id} className="py-4 px-4">
                      <span
                        className={clsx(
                          "text-xs px-2.5 py-1 rounded-full border",
                          app.status === "accepted"
                            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                            : app.status === "rejected"
                            ? "bg-red-500/10 text-red-400 border-red-500/20"
                            : "bg-market-500/10 text-market-400 border-market-500/20"
                        )}
                      >
                        {app.status}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* Accept Buttons */}
          <div className="mt-8 pt-6 border-t border-market-500/10">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {applicationsWithProfile.map((app) => (
                <div key={app.id} className="text-center">
                  <button
                    onClick={() => handleAccept(app.id)}
                    disabled={
                      app.status !== "pending" ||
                      job?.status !== "open" ||
                      acceptingId === app.id
                    }
                    className={clsx(
                      "w-full py-3 px-4 rounded-lg font-medium transition-all",
                      app.status === "pending" && job?.status === "open"
                        ? "btn-primary"
                        : "bg-market-500/10 text-amber-800 cursor-not-allowed"
                    )}
                  >
                    {acceptingId === app.id
                      ? "Accepting..."
                      : app.status === "accepted"
                      ? "Accepted"
                      : app.status === "rejected"
                      ? "Rejected"
                      : "Accept Proposal"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
