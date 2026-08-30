import React from "react";
import clsx from "clsx";

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  change?: {
    value: string | number;
    trend: "up" | "down" | "neutral";
  };
  icon?: React.ReactNode;
  colorScheme?: "gold" | "green" | "blue" | "red" | "purple";
  className?: string;
}

const colorStyles = {
  gold: "border-market-500/20 bg-market-500/5 text-market-400",
  green: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
  blue: "border-blue-500/20 bg-blue-500/5 text-blue-400",
  red: "border-red-500/20 bg-red-500/5 text-red-400",
  purple: "border-purple-500/20 bg-purple-500/5 text-purple-400",
};

export default function StatCard({
  title,
  value,
  subtitle,
  change,
  icon,
  colorScheme = "gold",
  className,
}: StatCardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl border p-5 bg-ink-800 transition-all duration-200 hover:shadow-lg",
        colorStyles[colorScheme],
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">{title}</p>
        {icon && <span className="p-2 rounded-xl bg-ink-700/80 shrink-0">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="font-display text-2xl font-bold text-amber-100">{value}</p>
        {change && (
          <span
            className={clsx(
              "text-xs font-semibold px-2 py-0.5 rounded-full border",
              change.trend === "up"
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : change.trend === "down"
                  ? "bg-red-500/10 text-red-400 border-red-500/20"
                  : "bg-ink-700 text-amber-300 border-market-500/10"
            )}
          >
            {change.trend === "up" ? "↑" : change.trend === "down" ? "↓" : "•"} {change.value}
          </span>
        )}
      </div>
      {subtitle && <p className="text-xs text-amber-800 mt-1">{subtitle}</p>}
    </div>
  );
}
