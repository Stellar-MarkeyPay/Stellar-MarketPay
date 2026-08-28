/**
 * utils/format.ts
 * Shared formatting utilities for Stellar MarketPay.
 */

import { format, formatDistanceToNow } from "date-fns";
import { enUS, es, fr, pt } from "date-fns/locale";
import i18next from "../lib/i18n";
import type { Application, Availability, AvailabilityStatus, Job, JobStatus } from "@marketpay/shared-types";

function getDateLocale() {
  const lng = i18next?.language?.split("-")[0] || "en";
  switch (lng) {
    case "es":
      return es;
    case "fr":
      return fr;
    case "pt":
      return pt;
    case "en":
    default:
      return enUS;
  }
}

function getActiveLocaleString() {
  return i18next?.language || "en-US";
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function downloadCsv(filename: string, rows: string[][]): void {
  const lines = rows.map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Client-side CSV download for dashboard "Jobs Posted" export. */
export function exportJobsToCSV(jobs: Job[]): void {
  const header = [
    "id",
    "title",
    "status",
    "category",
    "budget",
    "skills",
    "applicantCount",
    "createdAt",
  ];
  const rows: string[][] = [header];
  for (const j of jobs) {
    rows.push([
      j.id,
      j.title,
      j.status,
      j.category,
      j.budget,
      j.skills.join("; "),
      String(j.applicantCount),
      j.createdAt,
    ]);
  }
  downloadCsv(`marketpay-jobs-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

/** Client-side CSV download for dashboard applications export. */
export function exportApplicationsToCSV(applications: Application[]): void {
  const header = ["id", "jobId", "status", "bidAmount", "proposal", "createdAt"];
  const rows: string[][] = [header];
  for (const a of applications) {
    rows.push([a.id, a.jobId, a.status, a.bidAmount, a.proposal, a.createdAt]);
  }
  downloadCsv(`marketpay-applications-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

/**
 * Formats XLM amounts consistently across the application.
 * Presentation rules:
 * - Uses the active user locale for number formatting (e.g., thousands separators and decimal points).
 * - Precision: Defaults to a maximum of 4 decimal places unless specified otherwise.
 * - Always appends " XLM" suffix.
 */
export function formatXLM(amount: string | number, decimals = 4): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "0 XLM";
  return `${new Intl.NumberFormat(getActiveLocaleString(), {
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(num)} XLM`;
}

export function timeAgo(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true, locale: getDateLocale() });
  } catch {
    return dateString;
  }
}

export function formatDate(dateString: string): string {
  try {
    return format(new Date(dateString), "PP", { locale: getDateLocale() });
  } catch {
    return dateString;
  }
}

export function formatDeadline(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  try {
    return format(date, "PP", { locale: getDateLocale() });
  } catch {
    return "";
  }
}

export function formatChartDate(dateValue: string | number | Date): string {
  try {
    return format(new Date(dateValue), "MMM dd", { locale: getDateLocale() });
  } catch {
    return String(dateValue);
  }
}

export type DeadlineState = "none" | "closing_soon" | "closed";

export function getDeadlineState(dateString?: string | null, now = Date.now()): DeadlineState {
  if (!dateString) return "none";

  const deadline = new Date(dateString);
  const deadlineTime = deadline.getTime();
  if (Number.isNaN(deadlineTime)) return "none";

  if (deadlineTime <= now) return "closed";
  if (deadlineTime - now <= 72 * 60 * 60 * 1000) return "closing_soon";

  return "none";
}

export function shortenAddress(address: string, chars = 6): string {
  if (!address || address.length < chars * 2) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function availabilityStatusLabel(status?: Availability["status"] | null): string {
  if (status === "available") return "Available";
  if (status === "busy") return "Busy";
  if (status === "unavailable") return "Unavailable";
  return "Unknown";
}

export function availabilitySummary(availability?: Availability | null): string {
  if (!availability) return "";

  const from = availability.availableFrom ? formatDate(availability.availableFrom) : "";
  const until = availability.availableUntil ? formatDate(availability.availableUntil) : "";

  if (from && until)
    return `${availabilityStatusLabel(availability.status)} from ${from} to ${until}`;
  if (from) return `${availabilityStatusLabel(availability.status)} from ${from}`;
  if (until) return `${availabilityStatusLabel(availability.status)} until ${until}`;
  return availabilityStatusLabel(availability.status);
}

export function availabilityBadgeClass(status?: Availability["status"] | null): string {
  if (status === "available") {
    return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  }
  if (status === "busy") {
    return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  }
  if (status === "unavailable") {
    return "bg-red-500/10 text-red-400 border-red-500/20";
  }
  return "bg-market-500/10 text-market-300 border-market-500/20";
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function statusLabel(status: JobStatus): string {
  return {
    open: "Open",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
    disputed: "Disputed",
  }[status];
}

export function statusClass(status: JobStatus): string {
  return {
    open: "badge-open",
    in_progress: "badge-progress",
    completed: "badge-complete",
    cancelled: "badge-cancelled",
    disputed: "badge-disputed",
  }[status];
}

export const JOB_CATEGORIES = [
  "Smart Contracts",
  "Frontend Development",
  "Backend Development",
  "UI/UX Design",
  "Technical Writing",
  "DevOps",
  "Security Audit",
  "Data Analysis",
  "Mobile Development",
  "Other",
];

export const CATEGORY_ICONS: Record<string, string> = {
  "Smart Contracts": "📜",
  "Frontend Development": "🎨",
  "Backend Development": "⚙️",
  "UI/UX Design": "🖌️",
  "Technical Writing": "✍️",
  DevOps: "🚀",
  "Security Audit": "🔒",
  "Data Analysis": "📊",
  "Mobile Development": "📱",
  Other: "📦",
};

export function categoryToSlug(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function slugToCategory(slug: string): string | undefined {
  return JOB_CATEGORIES.find((cat) => categoryToSlug(cat) === slug);
}

/**
 * Common Web3 and development skill suggestions for autocomplete.
 */
export const SKILL_SUGGESTIONS = [
  // Blockchain & Smart Contracts
  "Rust",
  "Soroban",
  "Stellar SDK",
  "Solidity",
  "Ethereum",
  "Smart Contracts",
  "Web3.js",
  "Ethers.js",
  "Hardhat",
  "Foundry",
  "Anchor",
  "Solana",
  "DeFi",
  "NFT",
  "Token Development",
  "Cryptography",
  // Frontend
  "React",
  "Next.js",
  "TypeScript",
  "JavaScript",
  "Vue.js",
  "Angular",
  "Tailwind CSS",
  "CSS",
  "HTML",
  "Redux",
  "Zustand",
  "React Query",
  // Backend
  "Node.js",
  "Express",
  "Python",
  "Go",
  "Rust",
  "PostgreSQL",
  "MongoDB",
  "GraphQL",
  "REST API",
  "Docker",
  "Kubernetes",
  "Redis",
  "AWS",
  "GCP",
  // Design
  "Figma",
  "UI Design",
  "UX Design",
  "Prototyping",
  "Wireframing",
  // DevOps & Security
  "CI/CD",
  "Linux",
  "Security Audit",
  "Penetration Testing",
  "DevOps",
  // Mobile
  "React Native",
  "Flutter",
  "iOS",
  "Android",
  // Other
  "Technical Writing",
  "Documentation",
  "Agile",
  "Scrum",
  "Git",
];

/**
 * Converts an XLM amount to a USD equivalent string.
 * Returns null if price is unavailable.
 */
export function formatMoney(amount: string | number, currency: string = "XLM"): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return `0 ${currency}`;
  const formatted = new Intl.NumberFormat(getActiveLocaleString(), {
    maximumFractionDigits: 4,
    useGrouping: true,
  }).format(num);
  return `${formatted} ${currency}`;
}

export function formatUSDEquivalent(
  amount: string | number,
  xlmPriceUsd: number | null,
  currency: string = "XLM"
): string | null {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return null;
  const usdFormatter = new Intl.NumberFormat(getActiveLocaleString(), {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  });
  if (currency.toUpperCase() === "USDC") {
    return `≈ ${usdFormatter.format(num)} USD`;
  }
  if (xlmPriceUsd === null) return null;
  const usdAmount = num * xlmPriceUsd;
  return `≈ ${usdFormatter.format(usdAmount)} USD`;
}

/**
 * Formats a price based on the active currency mode.
 * Returns the formatted string and optionally the USD equivalent.
 */
export function formatPrice(
  xlmAmount: string | number,
  xlmPriceUsd: number | null,
  currencyMode: "XLM" | "USD"
): { display: string; usdEquiv: string | null } {
  const num = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(num)) return { display: "0 XLM", usdEquiv: null };

  const locale = getActiveLocaleString();
  const usdFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  });
  const xlmFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 4,
    useGrouping: true,
  });

  const usdEquiv = xlmPriceUsd !== null ? usdFormatter.format(num * xlmPriceUsd) : null;

  if (currencyMode === "USD" && xlmPriceUsd !== null) {
    return {
      display: usdFormatter.format(num * xlmPriceUsd),
      usdEquiv: null,
    };
  }

  return {
    display: `${xlmFormatter.format(num)} XLM`,
    usdEquiv,
  };
}

/**
 * Calculates a monthly equivalent estimate for a given budget.
 * If no duration is provided, it assumes the budget is for a month of work.
 */
export function getMonthlyEstimate(
  xlmAmount: string | number,
  xlmPriceUsd: number | null
): string | null {
  if (xlmPriceUsd === null) return null;
  const num = typeof xlmAmount === "string" ? parseFloat(xlmAmount) : xlmAmount;
  if (isNaN(num)) return null;
  const locale = getActiveLocaleString();
  const usdFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  });
  return `${usdFormatter.format(num * xlmPriceUsd)}/mo est.`;
}

export interface ProgressData {
  percentage: number;
  daysRemaining: number;
  colorClass: string;
}

/**
 * Calculates job progress for in-progress jobs with a deadline.
 * Returns null if the job is not in progress or has no deadline.
 */
export function calculateJobProgress(job: Job): ProgressData | null {
  if (job.status !== "in_progress" || !job.deadline) return null;

  const start = new Date(job.updatedAt).getTime();
  const end = new Date(job.deadline).getTime();
  const now = Date.now();

  const total = end - start;
  if (total <= 0) {
    return {
      percentage: 100,
      daysRemaining: 0,
      colorClass: "bg-red-500",
    };
  }

  const elapsed = now - start;
  const percentage = Math.min(100, Math.max(0, (elapsed / total) * 100));

  const daysRemaining = Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));

  let colorClass = "bg-emerald-500"; // green
  if (percentage > 80) {
    colorClass = "bg-red-500";
  } else if (percentage >= 50) {
    colorClass = "bg-amber-500";
  }

  return { percentage, daysRemaining, colorClass };
}

export const POPULAR_SKILLS: string[] = [
  "JavaScript",
  "TypeScript",
  "Python",
  "React",
  "Node.js",
  "Solidity",
  "Rust",
  "Go",
  "AWS",
  "Docker",
  "Stellar",
  "Soroban",
  "Smart Contracts",
  "DeFi",
  "Web3",
  "PostgreSQL",
  "MongoDB",
  "GraphQL",
  "Next.js",
  "Tailwind CSS",
  "UI/UX Design",
  "Full Stack",
  "Smart Contract",
];
