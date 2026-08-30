import React from "react";
import clsx from "clsx";

export type SkeletonVariant = "text" | "circle" | "rectangle" | "card";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
}

export default function Skeleton({
  variant = "text",
  width,
  height,
  rounded = "md",
  className,
  style,
  ...props
}: SkeletonProps) {
  const roundedClasses = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    full: "rounded-full",
  };

  if (variant === "circle") {
    return (
      <div
        className={clsx("bg-market-500/10 animate-pulse rounded-full shrink-0", className)}
        style={{
          width: width ?? "40px",
          height: height ?? width ?? "40px",
          ...style,
        }}
        {...props}
      />
    );
  }

  if (variant === "card") {
    return (
      <div
        className={clsx(
          "rounded-2xl border border-market-500/10 bg-ink-800 p-6 space-y-4 animate-pulse",
          className
        )}
        style={{ width, height, ...style }}
        {...props}
      >
        <div className="h-5 w-2/5 rounded-md bg-market-500/15" />
        <div className="space-y-2">
          <div className="h-3.5 w-full rounded bg-market-500/10" />
          <div className="h-3.5 w-4/5 rounded bg-market-500/10" />
        </div>
        <div className="h-8 w-1/3 rounded-xl bg-market-500/15" />
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "bg-market-500/10 animate-pulse",
        variant === "text" ? "h-4 w-full" : "",
        roundedClasses[rounded],
        className
      )}
      style={{
        width,
        height,
        ...style,
      }}
      {...props}
    />
  );
}
