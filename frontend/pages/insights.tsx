import { useEffect, useState } from "react";
import Head from "next/head";
import axios from "axios";

interface CategoryStat {
  category: string;
  jobCount: number;
  avgBudgetXLM: number;
  filledCount: number;
  avgDaysToFill: number | null;
}

interface Overview {
  totalJobs: number;
  openJobs: number;
  inProgressJobs: number;
  completedJobs: number;
  avgBudgetXLM: number;
  totalFilled: number;
  avgDaysToFill: number | null;
}

export default function InsightsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [categories, setCategories] = useState<CategoryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      axios.get("/api/jobs/analytics/overview"),
      axios.get("/api/jobs/analytics/categories"),
    ])
      .then(([overviewRes, categoriesRes]) => {
        setOverview(overviewRes.data.data);
        setCategories(categoriesRes.data.data);
      })
      .catch(() => setError("Failed to load market insights."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          <p className="mt-4 text-gray-600">Loading market insights...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }

  const maxJobs = categories[0]?.jobCount || 1;

  return (
    <>
      <Head>
        <title>Market Insights - Stellar MarketPay</title>
        <meta name="description" content="Marketplace analytics: job counts, budgets, and fill times by category" />
      </Head>

      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Market Insights</h1>
          <p className="text-gray-500 mb-8">Live analytics across all job categories on Stellar MarketPay</p>

          {/* Overview cards */}
          {overview && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
              {[
                { label: "Total Jobs", value: overview.totalJobs.toLocaleString() },
                { label: "Open Now", value: overview.openJobs.toLocaleString() },
                { label: "Avg Budget", value: `${overview.avgBudgetXLM} XLM` },
                { label: "Avg Days to Fill", value: overview.avgDaysToFill != null ? `${overview.avgDaysToFill}d` : "—" },
              ].map((card) => (
                <div key={card.label} className="bg-white rounded-lg shadow p-5">
                  <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Category table */}
          {categories.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
              No category data available yet.
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-hidden mb-10">
              <div className="px-6 py-4 border-b">
                <h2 className="text-lg font-semibold text-gray-900">Stats by Category</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-3 px-6 text-gray-600 font-medium">Category</th>
                      <th className="text-right py-3 px-6 text-gray-600 font-medium">Jobs</th>
                      <th className="text-right py-3 px-6 text-gray-600 font-medium">Avg Budget (XLM)</th>
                      <th className="text-right py-3 px-6 text-gray-600 font-medium">Filled</th>
                      <th className="text-right py-3 px-6 text-gray-600 font-medium">Avg Days to Fill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((cat) => (
                      <tr key={cat.category} className="border-t hover:bg-gray-50">
                        <td className="py-3 px-6 text-gray-900 font-medium">{cat.category}</td>
                        <td className="py-3 px-6 text-right">
                          <div className="flex items-center justify-end gap-3">
                            <div className="w-24 bg-gray-200 rounded-full h-1.5 hidden sm:block">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${(cat.jobCount / maxJobs) * 100}%` }}
                              />
                            </div>
                            <span className="text-gray-900">{cat.jobCount}</span>
                          </div>
                        </td>
                        <td className="py-3 px-6 text-right text-gray-900">{cat.avgBudgetXLM}</td>
                        <td className="py-3 px-6 text-right text-gray-900">{cat.filledCount}</td>
                        <td className="py-3 px-6 text-right text-gray-500">
                          {cat.avgDaysToFill != null ? `${cat.avgDaysToFill}d` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
