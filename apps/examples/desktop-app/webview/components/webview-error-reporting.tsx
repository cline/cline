"use client";

import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import {
	installWebviewErrorReporting,
	reportWebviewError,
} from "@/lib/client-telemetry";

class WebviewErrorBoundary extends Component<
	{ children: ReactNode },
	{ hasError: boolean }
> {
	state = { hasError: false };

	static getDerivedStateFromError(): { hasError: boolean } {
		return { hasError: true };
	}

	componentDidCatch(error: unknown, _info: ErrorInfo): void {
		// The boundary caught it, but the view is gone — that is fatal from
		// the user's perspective even though React contained the crash.
		reportWebviewError({
			operation: "react_error_boundary",
			error,
			severity: "fatal",
			handled: true,
		});
	}

	render(): ReactNode {
		if (this.state.hasError) {
			return (
				<div className="flex h-full min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
					<p className="text-lg font-semibold text-foreground">
						Something went wrong
					</p>
					<p className="max-w-md text-sm text-muted-foreground">
						Cline Code hit an unexpected error. Reload to continue — your
						sessions are safe.
					</p>
					<button
						className="rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
						onClick={() => window.location.reload()}
						type="button"
					>
						Reload
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

/**
 * Top-level client wrapper: installs the global webview error hooks and
 * catches render crashes in a React error boundary. All reports flow to the
 * sidecar through lib/client-telemetry.ts.
 */
export function WebviewErrorReporting({ children }: { children: ReactNode }) {
	useEffect(() => installWebviewErrorReporting(), []);
	return <WebviewErrorBoundary>{children}</WebviewErrorBoundary>;
}
