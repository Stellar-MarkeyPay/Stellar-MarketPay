import React from 'react';

export function reportError(error: Error, errorInfo?: React.ErrorInfo) {
  // In a real application, this would send to Sentry, Datadog, etc.
  console.error("Frontend Monitoring - Caught Error:", error);
  if (errorInfo) {
    console.error("Frontend Monitoring - Component Stack:", errorInfo.componentStack);
  }
}
