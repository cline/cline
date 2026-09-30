"use client";

import type { ReactNode } from "react";

/** Current request context metrics, not accumulated session token traffic. */
export interface AgentContextUsageData {
	tokensIn: number;
	tokensOut: number;
	cacheReadTokens: number;
	contextWindow?: number;
}

export interface AgentContextUsagePresentation {
	/** Accessible name for the host-owned trigger. */
	triggerLabel: string;
	/** Decorative SVG; place inside the host's trigger without another wrapper. */
	ring: ReactNode;
	/** Popover body; the host owns the popover's positioning and interactions. */
	details: ReactNode;
}

export interface AgentContextUsageProps {
	usage: AgentContextUsageData;
	/** Optional host-formatted session cost, separate from current context usage. */
	costLabel?: ReactNode;
	children: (presentation: AgentContextUsagePresentation) => ReactNode;
}

/**
 * Desktop's context meter and details, composed into host-owned controls.
 * Produces no wrapper or trigger when usage/context metadata is unavailable.
 */
export function AgentContextUsage({
	usage,
	costLabel,
	children,
}: AgentContextUsageProps) {
	const contextWindow = usage.contextWindow;
	const totalTokens = usage.tokensIn + usage.tokensOut;
	if (totalTokens <= 0 || !contextWindow || contextWindow <= 0) {
		return null;
	}

	const ratio = Math.min(
		Math.max(totalTokens / Math.max(contextWindow, 1), 0),
		1,
	);
	const percent = Math.round(ratio * 100);
	const ringColorClass =
		ratio >= 0.75
			? "stroke-red-500"
			: ratio >= 0.5
				? "stroke-orange-500"
				: "stroke-cline-ui-primary";
	const contextUsageLabel = `${formatCompactTokens(totalTokens)} / ${formatCompactTokens(contextWindow)} (${percent}%)`;
	const cachedTokens = Math.min(usage.cacheReadTokens, usage.tokensIn);
	const uncachedInputTokens = Math.max(usage.tokensIn - cachedTokens, 0);
	const segmentScale =
		totalTokens > contextWindow ? contextWindow / totalTokens : 1;
	const segmentWidth = (tokens: number) =>
		`${(tokens / contextWindow) * segmentScale * 100}%`;
	const radius = 8.5;
	const circumference = 2 * Math.PI * radius;

	return children({
		triggerLabel: `Context window: ${totalTokens.toLocaleString()} of ${contextWindow.toLocaleString()} tokens used (${percent}%)`,
		ring: (
			<svg
				aria-hidden="true"
				className="-rotate-90 size-3.5"
				height="22"
				viewBox="0 0 22 22"
				width="22"
			>
				<circle
					className="stroke-cline-ui-muted-foreground/20"
					cx="11"
					cy="11"
					fill="none"
					r={radius}
					strokeWidth="4"
				/>
				<circle
					className={ringColorClass}
					cx="11"
					cy="11"
					fill="none"
					r={radius}
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - ratio)}
					strokeLinecap="round"
					strokeWidth="4"
				/>
			</svg>
		),
		details: (
			<div className="px-3 py-3">
				<div className="flex items-center justify-between gap-4 text-cline-ui-sm">
					<span className="text-cline-ui-muted-foreground">Context window</span>
					<span className="font-cline-ui-mono text-cline-ui-sm text-cline-ui-foreground">
						{contextUsageLabel}
					</span>
				</div>
				<div className="mt-2 flex h-1 overflow-hidden rounded-full bg-cline-ui-muted">
					<div
						aria-hidden="true"
						className="h-full shrink-0 bg-cline-ui-primary transition-[width] duration-120"
						data-token-kind="uncached-input"
						style={{ width: segmentWidth(uncachedInputTokens) }}
					/>
					<div
						aria-hidden="true"
						className="h-full shrink-0 bg-cline-ui-primary/60 transition-[background,width] duration-120"
						data-token-kind="cached-input"
						style={{
							backgroundImage:
								"linear-gradient(to right, var(--primary), color-mix(in srgb, var(--primary) 60%, transparent))",
							width: segmentWidth(cachedTokens),
						}}
					/>
					<div
						aria-hidden="true"
						className="h-full shrink-0 bg-blue-500 transition-[background,width] duration-120"
						data-token-kind="output"
						style={{
							backgroundImage:
								"linear-gradient(to right, color-mix(in srgb, var(--primary) 60%, transparent), var(--color-blue-500))",
							width: segmentWidth(usage.tokensOut),
						}}
					/>
				</div>
				<div className="mt-3 space-y-2 text-cline-ui-sm">
					<div className="flex items-center justify-between gap-4">
						<span className="text-cline-ui-muted-foreground">Input tokens</span>
						<span className="font-cline-ui-mono text-cline-ui-foreground">
							{usage.tokensIn.toLocaleString()}
						</span>
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-cline-ui-muted-foreground">
							Output tokens
						</span>
						<span className="font-cline-ui-mono text-cline-ui-foreground">
							{usage.tokensOut.toLocaleString()}
						</span>
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-cline-ui-muted-foreground">
							Cached tokens
						</span>
						<span className="font-cline-ui-mono text-cline-ui-foreground">
							{usage.cacheReadTokens.toLocaleString()}
						</span>
					</div>
					{costLabel || costLabel === 0 ? (
						<div className="flex items-center justify-between gap-4">
							<span className="text-cline-ui-muted-foreground">Cost</span>
							<span className="font-cline-ui-mono text-cline-ui-foreground">
								{costLabel}
							</span>
						</div>
					) : null}
				</div>
			</div>
		),
	});
}

function formatCompactTokens(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${formatCompactUnit(value / 1_000)}k`;
	}
	return value.toLocaleString();
}

function formatCompactUnit(value: number): string {
	return value.toFixed(1).replace(/\.0$/, "");
}
