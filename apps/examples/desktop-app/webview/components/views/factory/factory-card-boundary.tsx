"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FACTORY_UNREADABLE } from "@/lib/factory-copy";

/**
 * Keeps one card that cannot render (malformed stored data, say) from
 * replacing the whole app: the card's area says so and offers the way back;
 * the rail and the rest of the app keep working. Keyed by card, so opening
 * another card starts clean.
 */
export class FactoryCardBoundary extends Component<
	{ onBack: () => void; children: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error(
			"Factory card could not be shown",
			error,
			info.componentStack,
		);
	}

	render() {
		if (!this.state.failed) return this.props.children;
		return (
			<div
				role="alert"
				data-factory-card-error
				className="flex flex-col items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm"
			>
				<p className="flex items-center gap-2 font-medium">
					<AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
					{FACTORY_UNREADABLE.cardPage}
				</p>
				<Button size="sm" variant="outline" onClick={this.props.onBack}>
					<ArrowLeft className="mr-1.5 size-3.5" />
					Back to Factory
				</Button>
			</div>
		);
	}
}
