"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      message:
        error instanceof Error
          ? error.message
          : "The workspace could not start in this browser.",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tether Notes crashed while rendering", error, info.componentStack);
  }

  render() {
    if (this.state.message) {
      return (
        <main className="app-loading" role="alert">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span>Tether Notes</span>
          </div>
          <p className="boot-error">{this.state.message}</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => window.location.reload()}
          >
            Reload the workspace
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
