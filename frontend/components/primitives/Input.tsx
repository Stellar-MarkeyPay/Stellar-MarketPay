import React, { forwardRef } from "react";
import clsx from "clsx";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      helperText,
      error,
      leftIcon,
      rightIcon,
      fullWidth = true,
      className,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className={clsx("flex flex-col gap-1.5", fullWidth ? "w-full" : "")}>
        {label && (
          <label htmlFor={inputId} className="label">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3.5 text-amber-700 pointer-events-none shrink-0">
              {leftIcon}
            </span>
          )}
          <input
            id={inputId}
            ref={ref}
            disabled={disabled}
            className={clsx(
              "w-full rounded-xl bg-ink-700 border border-[rgba(251,191,36,0.18)] px-4 py-2.5 sm:py-3",
              "text-amber-100 placeholder-amber-900/50 text-sm font-body min-h-[44px]",
              "focus:outline-none focus:border-market-500/50 focus:ring-1 focus:ring-market-500/30",
              "disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200",
              leftIcon ? "pl-10" : "",
              rightIcon ? "pr-10" : "",
              error ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30" : "",
              className
            )}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3.5 text-amber-700 pointer-events-none shrink-0">
              {rightIcon}
            </span>
          )}
        </div>
        {error ? (
          <p className="text-xs text-red-400 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-amber-700">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
export default Input;
