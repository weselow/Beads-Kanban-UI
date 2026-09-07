"use client";

import { Component } from "react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Fallback UI label (e.g., "Kanban Board", "Bead Detail") */
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches render errors in child components.
 * Shows a user-friendly fallback with retry and reload buttons instead of crashing the whole page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`, error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-center">
          <div role="alert" className="text-sm text-danger">
            {this.props.label
              ? `${this.props.label} encountered an error`
              : "Something went wrong"}
          </div>
          {this.state.error && (
            <pre className="max-w-md text-xs text-t-muted truncate">
              {this.state.error.message}
            </pre>
          )}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={this.handleRetry}>
              Try again
            </Button>
            <Button variant="outline" size="sm" onClick={this.handleReload}>
              Reload page
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
