import React, { Component, ErrorInfo, ReactNode } from "react";
import { reportError } from "@/lib/monitoring";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  isAppLevel?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      if (this.props.isAppLevel) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-ink-900 p-6">
            <div className="max-w-md w-full bg-white dark:bg-ink-800 rounded-xl shadow-lg border border-gray-100 dark:border-market-500/20 p-8 text-center space-y-6">
              <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Something went wrong</h2>
                <p className="text-gray-600 dark:text-gray-300">
                  We've encountered an unexpected issue. Our team has been notified.
                  Please try refreshing the page or navigating back.
                </p>
              </div>
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 px-4 bg-market-500 hover:bg-market-600 text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-market-500 focus:ring-offset-2 dark:focus:ring-offset-ink-900"
              >
                Reload Page
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="p-6 bg-white dark:bg-ink-800 rounded-xl border border-gray-200 dark:border-market-500/20 shadow-sm text-center">
          <div className="text-red-500 dark:text-red-400 mb-3">
            <svg className="w-10 h-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
            Failed to load this section
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            A temporary issue prevented this part of the page from displaying.
          </p>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-ink-700 dark:hover:bg-ink-600 text-gray-800 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-market-500"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
