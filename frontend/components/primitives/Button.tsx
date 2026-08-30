import React from "react";
import clsx from "clsx";
import Spinner from "@/components/Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: "bg-market-500 hover:bg-market-400 text-ink-900 font-semibold focus:ring-market-400",
  secondary:
    "border border-market-500/30 hover:border-market-500/60 text-market-400 bg-market-500/5 hover:bg-market-500/10 font-medium focus:ring-market-400",
  ghost:
    "text-market-500 hover:bg-market-500/10 font-medium border-transparent focus:ring-market-400",
  danger:
    "bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 font-medium focus:ring-red-400",
  outline:
    "border border-[rgba(251,191,36,0.18)] hover:border-market-500/40 text-amber-100 bg-transparent font-medium focus:ring-market-400",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs min-h-[36px] rounded-lg gap-1.5",
  md: "px-4 sm:px-6 py-2.5 sm:py-3 text-sm min-h-[44px] rounded-xl gap-2",
  lg: "px-6 sm:px-8 py-3.5 sm:py-4 text-base min-h-[52px] rounded-2xl gap-2.5",
};

export default function Button({
  variant = "primary",
  size = "md",
  isLoading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled = false,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || isLoading}
      className={clsx(
        "inline-flex items-center justify-center transition-all duration-200",
        "focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-ink-900",
        "disabled:opacity-40 disabled:cursor-not-allowed select-none",
        variantStyles[variant],
        sizeStyles[size],
        fullWidth ? "w-full" : "",
        className
      )}
      {...props}
    >
      {isLoading ? (
        <Spinner
          className={clsx("animate-spin shrink-0", size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4")}
        />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      <span className="truncate">{children}</span>
      {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
}
