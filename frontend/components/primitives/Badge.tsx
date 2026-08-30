import React from "react";
import clsx from "clsx";

export type BadgeVariant =
  "open" | "progress" | "complete" | "cancelled" | "disputed" | "gold" | "neutral";

export type BadgeSize = "sm" | "md";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  open: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  progress: "bg-amber-500/10 text-amber-300 border-amber-500/25",
  complete: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  disputed: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  gold: "bg-market-500/15 text-market-300 border-market-500/30",
  neutral: "bg-ink-700 text-amber-200 border-[rgba(251,191,36,0.12)]",
};

const dotColors: Record<BadgeVariant, string> = {
  open: "bg-emerald-400",
  progress: "bg-amber-400",
  complete: "bg-blue-400",
  cancelled: "bg-red-400",
  disputed: "bg-indigo-400",
  gold: "bg-market-400",
  neutral: "bg-amber-400",
};

export default function Badge({
  variant = "neutral",
  size = "sm",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border font-medium tracking-wide",
        size === "sm" ? "px-2.5 py-0.5 text-xs gap-1.5" : "px-3 py-1 text-sm gap-2",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {dot && <span className={clsx("w-1.5 h-1.5 rounded-full shrink-0", dotColors[variant])} />}
      {children}
    </span>
  );
}
