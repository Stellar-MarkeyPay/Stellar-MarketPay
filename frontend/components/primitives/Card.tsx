import React from "react";
import clsx from "clsx";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hoverable?: boolean;
  padded?: boolean;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export default function Card({
  hoverable = false,
  padded = true,
  header,
  footer,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-[rgba(251,191,36,0.12)] bg-ink-800 text-amber-100",
        "transition-all duration-200",
        padded ? "p-5 sm:p-6" : "",
        hoverable
          ? "hover:border-market-500/40 hover:bg-ink-700 hover:shadow-xl cursor-pointer"
          : "",
        className
      )}
      {...props}
    >
      {header && <div className="mb-4 pb-3 border-b border-market-500/10">{header}</div>}
      <div>{children}</div>
      {footer && <div className="mt-4 pt-3 border-t border-market-500/10">{footer}</div>}
    </div>
  );
}
