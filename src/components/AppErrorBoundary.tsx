import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown screen error";
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown) {
    console.error("App crashed:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-background px-4 py-10">
        <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The app hit a screen error. Refreshing usually clears it.
          </p>
          {this.state.message ? (
            <p className="mt-3 rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
              {this.state.message}
            </p>
          ) : null}
          <Button className="mt-5" onClick={() => window.location.assign("/")}>
            Reload app
          </Button>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;
