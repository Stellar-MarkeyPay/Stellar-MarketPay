import { useEffect, useState } from "react";
import Head from "next/head";
import { format } from "date-fns";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";
import {
  fetchInsightCategories,
  fetchInsightCompetitive,
  fetchInsightPayTrends,
  fetchInsightSkills,
  type InsightCategory,
  type InsightClientMix,
  type InsightCompetitiveJob,
  type InsightPayTrend,
  type InsightSkill,
} from "@/lib/api";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type SortKey = "totalJobs" | "avgBudget" | "avgApplicationsPerJob" | "acceptanceRate" | "lowCompetitionJobs";
type SortDirection = "asc" | "desc";

function formatBudget(value: number) {
  return `${value.toFixed(2)} XLM`;
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="card relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-market-500/10 via-transparent to-transparent" />
      <div className="relative">
        <p className="text-xs uppercase tracking-[0.3em] text-amber-800/70">{label}</p>
        <p className="mt-3 text-3xl font-bold text-amber-100">{value}</p>
        {note && <p className="mt-2 text-xs text-amber-800/80">{note}</p>}
      </div>
    </div>
  );
}

function SortButton({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left transition-colors ${
        active ? "text-market-300" : "text-amber-800 hover:text-amber-200"
      }`}
    >
      {label}
      {active && <span className="ml-1 text-[10px] font-mono">{direction === "asc" ? "▲" : "▼"}</span>}
    </button>
  );
}

export default function InsightsPage() {
  const [categories, setCategories] = useState<InsightCategory[]>([]);
  const [clientMix, setClientMix] = useState<InsightClientMix | null>(null);
  const [skills, setSkills] = useState<InsightSkill[]>([]);
  const [competitiveJobs, setCompetitiveJobs] = useState<InsightCompetitiveJob[]>([]);
  const [payTrends, setPayTrends] = useState<InsightPayTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalJobs");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    let active = true;

    Promise.all([
      fetchInsightCategories(),
      fetchInsightSkills(),
      fetchInsightCompetitive(),
      fetchInsightPayTrends(),
    ])
      .then(([categoryData, skillData, competitiveData, trendData]) => {
        if (!active) return;
        setCategories(categoryData.categories);
        setClientMix(categoryData.clientMix);
        setSkills(skillData);
        setCompetitiveJobs(competitiveData);
        setPayTrends(trendData);
      })
      .catch(() => {
        if (active) {
          setError("Failed to load market insights.");
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const sortedCategories = [...categories].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return (left - right) * multiplier;
  });

  const topTrendCategories = categories.slice(0, 5).map((entry) => entry.category);
  const trendDates = Array.from(new Set(payTrends.map((entry) => entry.date))).sort();
  const trendLabels = trendDates.map((date) => format(new Date(date), "MMM d"));
  const trendDatasets = topTrendCategories.map((category, index) => {
    const palette = [
      "rgb(245, 158, 11)",
      "rgb(59, 130, 246)",
      "rgb(16, 185, 129)",
      "rgb(244, 63, 94)",
      "rgb(168, 85, 247)",
    ];

    return {
      label: category,
      data: trendDates.map((date) => {
        const match = payTrends.find((entry) => entry.date === date && entry.category === category);
        return match ? match.avgBudget : 0;
      }),
      borderColor: palette[index % palette.length],
      backgroundColor: "transparent",
      tension: 0.35,
      pointRadius: 2,
    };
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-900 bg-noise px-4 py-16">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6">
          <div className="h-10 w-72 rounded-xl bg-ink-700" />
          <div className="grid gap-4 md:grid-cols-4">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-32 rounded-2xl bg-ink-800" />
            ))}
          </div>
          <div className="h-96 rounded-2xl bg-ink-800" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-ink-900 bg-noise flex items-center justify-center px-4">
        <div className="card max-w-md text-center">
          <p className="text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Market Insights - Stellar MarketPay</title>
        <meta
          name="description"
          content="Category performance, skill demand, competitive jobs, and pay trends across Stellar MarketPay."
        />
      </Head>

      <div className="min-h-screen bg-ink-900 bg-noise">
        <div className="bg-[radial-gradient(circle_at_top_left,_rgba(245,158,11,0.16),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_30%),linear-gradient(180deg,_rgba(12,10,6,0.96),_rgba(12,10,6,1))]">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
            <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="font-mono text-xs uppercase tracking-[0.35em] text-market-400/80">
                  Daily cached market intelligence
                </p>
                <h1 className="mt-3 font-display text-4xl font-bold text-amber-100 sm:text-5xl">
                  Market Insights
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-amber-800 sm:text-base">
                  Track which categories are growing, which skills are in demand, and where freelancers face the least competition.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[30rem]">
                <MetricCard
                  label="Categories"
                  value={String(categories.length)}
                  note="Sorted by job volume and budget"
                />
                <MetricCard
                  label="Skills"
                  value={String(skills.length)}
                  note="Top tags from active listings"
                />
                <MetricCard
                  label="Opportunities"
                  value={String(competitiveJobs.length)}
                  note="Jobs with fewer than 5 applications"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Average Budget"
                value={categories.length > 0 ? formatBudget(categories[0].avgBudget) : "0.00 XLM"}
                note="Highest-volume category leader"
              />
              <MetricCard
                label="Avg Applications"
                value={categories.length > 0 ? categories[0].avgApplicationsPerJob.toFixed(1) : "0.0"}
                note="Per job in the leading category"
              />
              <MetricCard
                label="Acceptance Rate"
                value={categories.length > 0 ? `${categories[0].acceptanceRate.toFixed(1)}%` : "0.0%"}
                note="Accepted applications as a share of total applications"
              />
              <MetricCard
                label="Client Mix"
                value={clientMix ? `${clientMix.newClients} / ${clientMix.returningClients}` : "0 / 0"}
                note="New clients vs returning clients"
              />
            </div>

            <div className="mt-8 grid gap-6 xl:grid-cols-[1.4fr_0.9fr]">
              <section className="card">
                <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="section-title">Category performance</h2>
                    <p className="mt-2 text-sm text-amber-800">
                      Sort by job volume, budget, application pressure, or competition.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="border-b border-[rgba(251,191,36,0.08)] text-[11px] uppercase tracking-[0.25em] text-amber-800">
                      <tr>
                        <th className="pb-3 pr-4 text-left text-amber-800">Category</th>
                        <th className="pb-3 pr-4 text-right">
                          <SortButton
                            label="Jobs"
                            active={sortKey === "totalJobs"}
                            direction={sortDirection}
                            onClick={() => {
                              setSortKey("totalJobs");
                              setSortDirection((current) =>
                                sortKey === "totalJobs" ? (current === "asc" ? "desc" : "asc") : "desc",
                              );
                            }}
                          />
                        </th>
                        <th className="pb-3 pr-4 text-right">
                          <SortButton
                            label="Avg Budget"
                            active={sortKey === "avgBudget"}
                            direction={sortDirection}
                            onClick={() => {
                              setSortKey("avgBudget");
                              setSortDirection((current) =>
                                sortKey === "avgBudget" ? (current === "asc" ? "desc" : "asc") : "desc",
                              );
                            }}
                          />
                        </th>
                        <th className="pb-3 pr-4 text-right">
                          <SortButton
                            label="Apps / Job"
                            active={sortKey === "avgApplicationsPerJob"}
                            direction={sortDirection}
                            onClick={() => {
                              setSortKey("avgApplicationsPerJob");
                              setSortDirection((current) =>
                                sortKey === "avgApplicationsPerJob"
                                  ? (current === "asc" ? "desc" : "asc")
                                  : "desc",
                              );
                            }}
                          />
                        </th>
                        <th className="pb-3 pr-4 text-right">
                          <SortButton
                            label="Acceptance"
                            active={sortKey === "acceptanceRate"}
                            direction={sortDirection}
                            onClick={() => {
                              setSortKey("acceptanceRate");
                              setSortDirection((current) =>
                                sortKey === "acceptanceRate" ? (current === "asc" ? "desc" : "asc") : "desc",
                              );
                            }}
                          />
                        </th>
                        <th className="pb-3 text-right">
                          <SortButton
                            label="Low Competition"
                            active={sortKey === "lowCompetitionJobs"}
                            direction={sortDirection}
                            onClick={() => {
                              setSortKey("lowCompetitionJobs");
                              setSortDirection((current) =>
                                sortKey === "lowCompetitionJobs"
                                  ? (current === "asc" ? "desc" : "asc")
                                  : "desc",
                              );
                            }}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedCategories.map((entry) => (
                        <tr key={entry.category} className="border-b border-[rgba(251,191,36,0.06)] last:border-b-0">
                          <td className="py-4 pr-4 text-amber-100">{entry.category}</td>
                          <td className="py-4 pr-4 text-right text-amber-100">{entry.totalJobs}</td>
                          <td className="py-4 pr-4 text-right text-amber-100">{formatBudget(entry.avgBudget)}</td>
                          <td className="py-4 pr-4 text-right text-amber-100">{entry.avgApplicationsPerJob.toFixed(1)}</td>
                          <td className="py-4 pr-4 text-right text-amber-100">{entry.acceptanceRate.toFixed(1)}%</td>
                          <td className="py-4 text-right text-amber-100">{entry.lowCompetitionJobs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="card">
                <h2 className="section-title">Top skills</h2>
                <p className="mt-2 text-sm text-amber-800">
                  Most requested skill tags, with a quick read on competition pressure.
                </p>

                <div className="mt-5 space-y-3">
                  {skills.map((skill, index) => (
                    <div
                      key={skill.skill}
                      className="rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-amber-100">
                            {index + 1}. {skill.skill}
                          </p>
                          <p className="mt-1 text-xs text-amber-800">
                            Average applications per job: {skill.avgApplicationsPerJob.toFixed(1)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="inline-flex rounded-full border border-market-500/20 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                            {skill.demandCount} listings
                          </span>
                          <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-amber-800">
                            {skill.lowCompetitionJobs} low-comp jobs
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
              <section className="card">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="section-title">Pay trends</h2>
                    <p className="mt-2 text-sm text-amber-800">
                      Average budget over time for the top five categories.
                    </p>
                  </div>
                  <span className="rounded-full border border-market-500/20 bg-market-500/10 px-3 py-1 text-xs font-semibold text-market-300">
                    30-day window
                  </span>
                </div>

                <div className="mt-6 h-80 rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4">
                  <Line
                    data={{
                      labels: trendLabels,
                      datasets: trendDatasets,
                    }}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: "bottom",
                          labels: { color: "#fef3c7" },
                        },
                      },
                      scales: {
                        x: {
                          ticks: { color: "#a8956a" },
                          grid: { color: "rgba(251,191,36,0.06)" },
                        },
                        y: {
                          ticks: { color: "#a8956a" },
                          grid: { color: "rgba(251,191,36,0.06)" },
                        },
                      },
                    }}
                  />
                </div>
              </section>

              <section className="card">
                <h2 className="section-title">Low competition jobs</h2>
                <p className="mt-2 text-sm text-amber-800">
                  Open jobs with fewer than five applications.
                </p>

                <div className="mt-5 space-y-3">
                  {competitiveJobs.map((job) => (
                    <article
                      key={job.id}
                      className="rounded-2xl border border-[rgba(251,191,36,0.08)] bg-ink-800/80 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-amber-100">{job.title}</p>
                          <p className="mt-1 text-xs text-amber-800">{job.category}</p>
                        </div>
                        <span className="rounded-full border border-market-500/20 bg-market-500/10 px-2.5 py-1 text-xs font-semibold text-market-300">
                          {job.competitionLevel}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-amber-800">
                        <div>
                          <p className="uppercase tracking-[0.2em]">Budget</p>
                          <p className="mt-1 text-amber-100">{formatBudget(job.budget)}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-[0.2em]">Applications</p>
                          <p className="mt-1 text-amber-100">{job.applicationCount}</p>
                        </div>
                        <div>
                          <p className="uppercase tracking-[0.2em]">Client</p>
                          <p className="mt-1 truncate text-amber-100">{job.clientAddress.slice(0, 8)}…</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
