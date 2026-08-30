import React, { forwardRef } from "react";
import clsx from "clsx";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
  fullWidth?: boolean;
  maxLength?: number;
  showCharCount?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      helperText,
      error,
      fullWidth = true,
      maxLength,
      showCharCount = false,
      value,
      className,
      id,
      disabled,
      ...props
    },
    ref
  ) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);
    const charCount = typeof value === "string" ? value.length : 0;

    return (
      <div className={clsx("flex flex-col gap-1.5", fullWidth ? "w-full" : "")}>
        <div className="flex justify-between items-center">
          {label && (
            <label htmlFor={inputId} className="label mb-0">
              {label}
            </label>
          )}
          {showCharCount && maxLength && (
            <span className="text-[11px] font-mono text-amber-700">
              {charCount}/{maxLength}
            </span>
          )}
        </div>
        <textarea
          id={inputId}
          ref={ref}
          value={value}
          maxLength={maxLength}
          disabled={disabled}
          className={clsx(
            "w-full rounded-xl bg-ink-700 border border-[rgba(251,191,36,0.18)] px-4 py-3",
            "text-amber-100 placeholder-amber-900/50 text-sm font-body leading-relaxed min-h-[100px] resize-y",
            "focus:outline-none focus:border-market-500/50 focus:ring-1 focus:ring-market-500/30",
            "disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200",
            error ? "border-red-500/50 focus:border-red-500 focus:ring-red-500/30" : "",
            className
          )}
          {...props}
        />
        {error ? (
          <p className="text-xs text-red-400 font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-amber-700">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";
export default Textarea;
